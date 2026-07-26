import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

/**
 * Route-level authorization contract for every prefix not already covered
 * (INF-252 Phase 0b).
 *
 * usersRouteContract.test.js covers /api/users, attendanceRouteContract covers
 * /api/attendance, and bookingsReadinessContract covers /api/bookings. This
 * file closes the remaining seven route files, completing the authorization
 * matrix for the whole API.
 *
 * Controllers are mocked. What is asserted is which middleware chain a route
 * declares -- who may reach the handler, and who is refused before it runs.
 * That is the property most at risk of silent drift when routes move into
 * feature modules.
 */

const handlersFor = (names) =>
  Object.fromEntries(
    names.map((name) => [name, (req, res) => res.status(200).json({ route: name })])
  );

const passThroughChain = [(req, res, next) => next()];
const passThrough = (req, res, next) => next();

/**
 * Mounts one route file with its controller and validators mocked.
 * `extraMocks` maps module path -> factory, for validators that differ per file.
 */
const mountRoute = async ({
  routeFile,
  controllerPath,
  controllerExports,
  extraMocks = {},
  prefix,
  role = 'Admin',
  verifyTokenImpl
}) => {
  jest.resetModules();

  jest.unstable_mockModule(controllerPath, () => handlersFor(controllerExports));

  jest.unstable_mockModule('../src/middlewares/authJwt.js', () => ({
    verifyToken:
      verifyTokenImpl ||
      ((req, res, next) => {
        req.user = { id: 42, role_name: role };
        next();
      })
  }));

  jest.unstable_mockModule('../src/middlewares/roleGuard.js', () => ({
    default: (allowedRoles) => (req, res, next) => {
      if (!allowedRoles.includes(req.user.role_name)) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      next();
    }
  }));

  for (const [path, factory] of Object.entries(extraMocks)) {
    jest.unstable_mockModule(path, factory);
  }

  const { default: routes } = await import(routeFile);
  const app = express();
  app.use(express.json());
  app.use(prefix, routes);
  return app;
};

const validatorMock = () => ({
  loginValidation: passThroughChain,
  dashboardAnalyticsValidation: passThroughChain,
  disciplineFahpValidation: passThroughChain,
  fuzzyAhpDashboardRecapValidation: passThroughChain,
  wfaFahpValidation: passThroughChain,
  validate: passThrough
});

const securityMock = () => ({
  loginRateLimit: passThrough
});

const settingsValidatorMock = () => ({
  operationalSettingsPatchValidation: passThroughChain
});

/** One entry per remaining route file. */
const MODULES = {
  auth: {
    routeFile: '../src/routes/auth.routes.js',
    controllerPath: '../src/controllers/auth.controller.js',
    controllerExports: ['login', 'refresh', 'logout', 'getCurrentUser'],
    extraMocks: {
      '../src/middlewares/validator.js': validatorMock,
      '../src/middlewares/security.js': securityMock
    },
    prefix: '/api/auth'
  },
  wfa: {
    routeFile: '../src/routes/wfa.routes.js',
    controllerPath: '../src/controllers/wfa.controller.js',
    controllerExports: ['getWfaRecommendations', 'getWfaAhpConfig', 'testFuzzyAhp'],
    prefix: '/api/wfa'
  },
  summary: {
    routeFile: '../src/routes/summary.routes.js',
    controllerPath: '../src/controllers/summary.controller.js',
    controllerExports: [
      'getDashboardAnalytics',
      'getSummaryReport',
      'getSummaryReportPdf',
      'getSummaryReportExcel'
    ],
    extraMocks: { '../src/middlewares/validator.js': validatorMock },
    prefix: '/api/summary'
  },
  discipline: {
    routeFile: '../src/routes/discipline.routes.js',
    controllerPath: '../src/controllers/discipline.controller.js',
    controllerExports: [
      'getUserDisciplineIndex',
      'getAllDisciplineIndices',
      'getDisciplineConfig',
      'testDisciplineAhp'
    ],
    prefix: '/api/discipline'
  },
  analysis: {
    routeFile: '../src/routes/analysis.routes.js',
    controllerPath: '../src/controllers/analysis.controller.js',
    controllerExports: [
      'getFuzzyAhpAnalysis',
      'getDisciplineFahp',
      'getWfaFahp',
      'getSmartAcFahp',
      'getFuzzyAhpDashboardRecap'
    ],
    extraMocks: { '../src/middlewares/validator.js': validatorMock },
    prefix: '/api/analysis'
  },
  settings: {
    routeFile: '../src/routes/settings.routes.js',
    controllerPath: '../src/controllers/settings.controller.js',
    controllerExports: ['getOperationalSettings', 'patchOperationalSettings'],
    extraMocks: { '../src/middlewares/settings.validator.js': settingsValidatorMock },
    prefix: '/api/settings'
  },
  referenceData: {
    routeFile: '../src/routes/referenceData.routes.js',
    controllerPath: '../src/controllers/referenceData.controller.js',
    controllerExports: ['getRoles', 'getPrograms', 'getPositions', 'getDivisions'],
    prefix: '/api'
  }
};

const app = (moduleKey, opts = {}) => mountRoute({ ...MODULES[moduleKey], ...opts });

/** [module, method, path, controller] — endpoints restricted to Admin and Management. */
const PRIVILEGED = [
  ['summary', 'get', '/api/summary/dashboard-analytics', 'getDashboardAnalytics'],
  ['summary', 'get', '/api/summary/reports', 'getSummaryReport'],
  ['summary', 'get', '/api/summary/reports/pdf', 'getSummaryReportPdf'],
  ['summary', 'get', '/api/summary/reports/excel', 'getSummaryReportExcel'],
  ['analysis', 'get', '/api/analysis/fuzzy-ahp', 'getFuzzyAhpAnalysis'],
  ['analysis', 'get', '/api/analysis/fuzzy-ahp/discipline', 'getDisciplineFahp'],
  ['analysis', 'get', '/api/analysis/fuzzy-ahp/wfa', 'getWfaFahp'],
  ['analysis', 'get', '/api/analysis/fuzzy-ahp/smart-ac', 'getSmartAcFahp'],
  ['analysis', 'get', '/api/analysis/fuzzy-ahp/dashboard', 'getFuzzyAhpDashboardRecap'],
  ['settings', 'get', '/api/settings/operational', 'getOperationalSettings'],
  ['settings', 'patch', '/api/settings/operational', 'patchOperationalSettings'],
  ['referenceData', 'get', '/api/roles', 'getRoles'],
  ['referenceData', 'get', '/api/programs', 'getPrograms'],
  ['referenceData', 'get', '/api/positions', 'getPositions'],
  ['referenceData', 'get', '/api/divisions', 'getDivisions'],
  ['wfa', 'post', '/api/wfa/test-ahp', 'testFuzzyAhp'],
  ['discipline', 'post', '/api/discipline/test-ahp', 'testDisciplineAhp']
];

/** Endpoints any authenticated user may reach. */
const AUTHENTICATED_ONLY = [
  ['auth', 'get', '/api/auth/me', 'getCurrentUser'],
  ['wfa', 'get', '/api/wfa/recommendations', 'getWfaRecommendations'],
  ['wfa', 'get', '/api/wfa/ahp-config', 'getWfaAhpConfig'],
  ['discipline', 'get', '/api/discipline/user/9', 'getUserDisciplineIndex'],
  ['discipline', 'get', '/api/discipline/all', 'getAllDisciplineIndices'],
  ['discipline', 'get', '/api/discipline/config', 'getDisciplineConfig']
];

/** Endpoints deliberately reachable without any token. */
const PUBLIC = [
  ['auth', 'post', '/api/auth/login', 'login'],
  ['auth', 'post', '/api/auth/refresh', 'refresh'],
  ['auth', 'post', '/api/auth/logout', 'logout']
];

describe('privileged routes', () => {
  test.each(PRIVILEGED)('%s: %s %s reaches its controller for an Admin', async (
    mod,
    method,
    path,
    route
  ) => {
    const server = await app(mod, { role: 'Admin' });
    await request(server)[method](path).send({}).expect(200, { route });
  });

  test.each(PRIVILEGED)('%s: %s %s reaches its controller for Management', async (
    mod,
    method,
    path,
    route
  ) => {
    const server = await app(mod, { role: 'Management' });
    await request(server)[method](path).send({}).expect(200, { route });
  });

  test.each(PRIVILEGED)('%s: %s %s is refused for a plain User', async (mod, method, path) => {
    const server = await app(mod, { role: 'User' });
    await request(server)[method](path).send({}).expect(403);
  });
});

describe('authenticated-only routes', () => {
  test.each(AUTHENTICATED_ONLY)('%s: %s %s reaches its controller for a plain User', async (
    mod,
    method,
    path,
    route
  ) => {
    const server = await app(mod, { role: 'User' });
    await request(server)[method](path).send({}).expect(200, { route });
  });
});

describe('unauthenticated access', () => {
  const reject401 = (req, res) => res.status(401).json({ success: false, message: 'Unauthorized' });

  test.each([...PRIVILEGED, ...AUTHENTICATED_ONLY])(
    '%s: %s %s is refused without a token',
    async (mod, method, path) => {
      const server = await app(mod, { verifyTokenImpl: reject401 });
      await request(server)[method](path).send({}).expect(401);
    }
  );

  test.each(PUBLIC)('%s: %s %s stays reachable without a token', async (
    mod,
    method,
    path,
    route
  ) => {
    const server = await app(mod, { verifyTokenImpl: reject401 });
    await request(server)[method](path).send({}).expect(200, { route });
  });
});

describe('discipline authorization is enforced in the controller, not the route', () => {
  /**
   * Documented as F10. Three of the four /api/discipline routes carry no
   * roleGuard, so a plain User reaches the handler and is refused inside it
   * (discipline.controller.js:26-30, 163, 307). Only test-ahp uses middleware.
   *
   * Authorization is not missing -- it is enforced in two different places
   * depending on the route. The migrated module should move it to the route.
   */
  test.each([
    ['/api/discipline/user/9', 'getUserDisciplineIndex'],
    ['/api/discipline/all', 'getAllDisciplineIndices'],
    ['/api/discipline/config', 'getDisciplineConfig']
  ])('%s reaches the controller even for a plain User', async (path, route) => {
    const server = await app('discipline', { role: 'User' });
    await request(server).get(path).expect(200, { route });
  });

  it('guards only test-ahp at the route layer', async () => {
    const server = await app('discipline', { role: 'User' });
    await request(server).post('/api/discipline/test-ahp').send({}).expect(403);
  });
});
