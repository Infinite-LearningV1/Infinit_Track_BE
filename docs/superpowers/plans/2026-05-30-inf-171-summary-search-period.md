# INF-171 Summary Search Period Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement backend summary report search and dashboard-native period query contract for INF-171.

**Architecture:** Extend the existing historical date-window utility to support canonical dashboard periods while preserving legacy aliases. Add a small summary-query utility for search alias resolution, then apply the resolved search term to summary report detail rows before pagination only. Update OpenAPI and reporting boundary docs to make the contract explicit.

**Tech Stack:** Node.js ESM, Express, Sequelize 6, Jest with `--experimental-vm-modules`, OpenAPI YAML, MySQL-compatible query semantics.

---

## File structure

- Modify: `src/utils/historicalDateWindow.js`
  - Owns accepted period names, validation, date-range rules, and effective date windows.
- Create: `tests/historicalDateWindow.test.js`
  - Unit tests for canonical periods, legacy periods, and rejected `all`.
- Create: `src/utils/summaryReportQuery.js`
  - Owns summary-report search field list and search alias precedence.
- Create: `tests/summaryReportQuery.test.js`
  - Unit tests for `q > search > query > keyword` and blank search behavior.
- Modify: `src/controllers/summary.controller.js`
  - Applies resolved summary search term to detail query only; preserves top-level summary query behavior.
- Modify: `tests/summaryReportContract.test.js`
  - Controller contract tests for periods, search-before-pagination, aliases, precedence, and summary-card non-filtering.
- Modify: `docs/openapi.yaml`
  - Documents canonical periods, deprecated period aliases, canonical `q`, deprecated search aliases, and rows-only search semantics.
- Modify: `tests/clientCriticalOpenApiContract.test.js`
  - Guards the OpenAPI summary report query contract.
- Modify: `docs/reporting-analytics-boundary.md`
  - Consumer guide for dashboard periods, `q`, and rows-only search behavior.
- Create: `docs/inf-171-evidence/RUN_2026-05-30.md`
  - Sanitized runtime smoke evidence after implementation.

---

### Task 1: Add historical period unit tests

**Files:**
- Create: `tests/historicalDateWindow.test.js`
- Modify: none

- [ ] **Step 1: Write the failing test file**

Create `tests/historicalDateWindow.test.js` with this complete content:

```js
import { jest } from '@jest/globals';

const mockGetJakartaDateString = jest.fn(() => '2026-05-30');

jest.unstable_mockModule('../src/utils/geofence.js', () => ({
  getJakartaDateString: mockGetJakartaDateString
}));

const {
  HISTORICAL_WINDOW_PERIODS,
  buildEffectiveWindow,
  validateHistoricalDateWindowQuery
} = await import('../src/utils/historicalDateWindow.js');

const windowDates = (input) => {
  const window = buildEffectiveWindow(input);
  return {
    startDateStr: window.startDateStr,
    endDateStr: window.endDateStr
  };
};

describe('historical date window dashboard periods', () => {
  beforeEach(() => {
    mockGetJakartaDateString.mockReturnValue('2026-05-30');
  });

  test('documents accepted canonical and legacy period values', () => {
    expect(HISTORICAL_WINDOW_PERIODS).toEqual([
      'daily',
      'weekly',
      'monthly',
      'range',
      '30d',
      'current_month',
      'custom'
    ]);
    expect(HISTORICAL_WINDOW_PERIODS).not.toContain('all');
  });

  test('builds daily as today-only in Jakarta date', () => {
    expect(windowDates({ period: 'daily' })).toEqual({
      startDateStr: '2026-05-30',
      endDateStr: '2026-05-30'
    });
  });

  test('builds weekly as rolling 7 days including today', () => {
    expect(windowDates({ period: 'weekly' })).toEqual({
      startDateStr: '2026-05-24',
      endDateStr: '2026-05-30'
    });
  });

  test('builds monthly as rolling 30 days including today', () => {
    expect(windowDates({ period: 'monthly' })).toEqual({
      startDateStr: '2026-05-01',
      endDateStr: '2026-05-30'
    });
  });

  test('keeps 30d as a deprecated alias for monthly', () => {
    expect(windowDates({ period: '30d' })).toEqual({
      startDateStr: '2026-05-01',
      endDateStr: '2026-05-30'
    });
  });

  test('keeps current_month as a legacy calendar-month period', () => {
    mockGetJakartaDateString.mockReturnValue('2026-05-15');

    expect(windowDates({ period: 'current_month' })).toEqual({
      startDateStr: '2026-05-01',
      endDateStr: '2026-05-15'
    });
  });

  test('builds range from explicit from and to boundaries', () => {
    expect(
      windowDates({ period: 'range', from: '2026-05-03', to: '2026-05-09' })
    ).toEqual({
      startDateStr: '2026-05-03',
      endDateStr: '2026-05-09'
    });
  });

  test('keeps custom as a deprecated alias for range', () => {
    expect(
      windowDates({ period: 'custom', from: '2026-05-03', to: '2026-05-09' })
    ).toEqual({
      startDateStr: '2026-05-03',
      endDateStr: '2026-05-09'
    });
  });

  test('rejects all as unsupported', () => {
    expect(validateHistoricalDateWindowQuery({ period: 'all' })).toBe(
      'Parameter period harus berupa: daily, weekly, monthly, range, 30d, current_month, atau custom'
    );
  });

  test('requires from and to for range or custom', () => {
    expect(validateHistoricalDateWindowQuery({ period: 'range', from: '2026-05-01' })).toBe(
      'Parameter from dan to wajib diisi saat period=range atau custom'
    );
    expect(validateHistoricalDateWindowQuery({ period: 'custom', to: '2026-05-31' })).toBe(
      'Parameter from dan to wajib diisi saat period=range atau custom'
    );
  });

  test('keeps range maximum at 31 days', () => {
    expect(
      validateHistoricalDateWindowQuery({
        period: 'range',
        from: '2026-05-01',
        to: '2026-06-01'
      })
    ).toBe('Rentang tanggal custom maksimal 31 hari');
  });
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run:

```bash
npm test -- --testPathPattern=historicalDateWindow
```

Expected: FAIL because `daily`, `weekly`, `monthly`, and `range` are not accepted by `HISTORICAL_WINDOW_PERIODS` yet, and `all` currently receives the old accepted-values message.

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/historicalDateWindow.test.js
git commit -m "test: define summary period window contract"
```

---

### Task 2: Implement canonical dashboard periods

**Files:**
- Modify: `src/utils/historicalDateWindow.js`
- Test: `tests/historicalDateWindow.test.js`

- [ ] **Step 1: Replace accepted period constants and add helper constants**

In `src/utils/historicalDateWindow.js`, replace the period constant section with:

```js
export const HISTORICAL_WINDOW_PERIODS = [
  'daily',
  'weekly',
  'monthly',
  'range',
  '30d',
  'current_month',
  'custom'
];
export const HISTORICAL_WINDOW_MAX_CUSTOM_DAYS = 31;

const RANGE_PERIODS = new Set(['range', 'custom']);
const PERIOD_VALIDATION_MESSAGE =
  'Parameter period harus berupa: daily, weekly, monthly, range, 30d, current_month, atau custom';
const RANGE_BOUNDARY_MESSAGE = 'Parameter from dan to wajib diisi saat period=range atau custom';
```

- [ ] **Step 2: Replace `validateHistoricalDateWindowQuery`**

Replace the whole `validateHistoricalDateWindowQuery` function with:

```js
export const validateHistoricalDateWindowQuery = ({ period = 'monthly', from = null, to = null } = {}) => {
  if (!HISTORICAL_WINDOW_PERIODS.includes(period)) {
    return PERIOD_VALIDATION_MESSAGE;
  }

  if (from && !parseIsoDateUtcStrict(from)) {
    return 'Parameter from harus menggunakan format YYYY-MM-DD';
  }

  if (to && !parseIsoDateUtcStrict(to)) {
    return 'Parameter to harus menggunakan format YYYY-MM-DD';
  }

  if (!RANGE_PERIODS.has(period)) {
    return null;
  }

  if (!from || !to) {
    return RANGE_BOUNDARY_MESSAGE;
  }

  const fromDate = parseIsoDateUtcStrict(from);
  const toDate = parseIsoDateUtcStrict(to);

  if (!fromDate || !toDate) {
    return null;
  }

  if (fromDate.getTime() > toDate.getTime()) {
    return 'Parameter from tidak boleh lebih besar dari to';
  }

  const rangeDays = Math.floor((toDate.getTime() - fromDate.getTime()) / MS_PER_DAY) + 1;
  if (rangeDays > HISTORICAL_WINDOW_MAX_CUSTOM_DAYS) {
    return 'Rentang tanggal custom maksimal 31 hari';
  }

  return null;
};
```

- [ ] **Step 3: Replace `buildEffectiveWindow`**

Replace the whole `buildEffectiveWindow` function with:

```js
export const buildEffectiveWindow = ({ period = 'monthly', from = null, to = null } = {}) => {
  const validationMessage = validateHistoricalDateWindowQuery({ period, from, to });
  if (validationMessage) {
    throw new Error(validationMessage);
  }

  const todayDate = getJakartaDateString();
  const todayUtc = parseDateOnlyUtc(todayDate);

  if (RANGE_PERIODS.has(period)) {
    const startDate = parseDateOnlyUtc(from);
    const endDate = parseDateOnlyUtc(to);

    return {
      startDate,
      endDate,
      startDateStr: from,
      endDateStr: to
    };
  }

  if (period === 'current_month') {
    const startDate = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), 1));
    return {
      startDate,
      endDate: todayUtc,
      startDateStr: formatDateOnly(startDate),
      endDateStr: todayDate
    };
  }

  if (period === 'daily') {
    return {
      startDate: todayUtc,
      endDate: todayUtc,
      startDateStr: todayDate,
      endDateStr: todayDate
    };
  }

  const daysBack = period === 'weekly' ? 6 : 29;
  const startDate = addUtcDays(todayUtc, -daysBack);
  return {
    startDate,
    endDate: todayUtc,
    startDateStr: formatDateOnly(startDate),
    endDateStr: todayDate
  };
};
```

- [ ] **Step 4: Run historical window tests**

Run:

```bash
npm test -- --testPathPattern=historicalDateWindow
```

Expected: PASS.

- [ ] **Step 5: Run summary report contract tests to expose expected downstream failures**

Run:

```bash
npm test -- --testPathPattern=summaryReportContract
```

Expected: FAIL because existing tests expect the old validation message for invalid legacy period values. Task 5 updates those expectations.

- [ ] **Step 6: Commit canonical period implementation**

```bash
git add src/utils/historicalDateWindow.js tests/historicalDateWindow.test.js
git commit -m "feat: add dashboard summary period windows"
```

---

### Task 3: Add summary search query utility tests

**Files:**
- Create: `tests/summaryReportQuery.test.js`
- Create in Task 4: `src/utils/summaryReportQuery.js`

- [ ] **Step 1: Write failing utility tests**

Create `tests/summaryReportQuery.test.js` with:

```js
const {
  SUMMARY_REPORT_SEARCH_FIELDS,
  resolveSummarySearchTerm
} = await import('../src/utils/summaryReportQuery.js');

describe('summary report search query helpers', () => {
  test('defines searchable fields for summary report rows', () => {
    expect(SUMMARY_REPORT_SEARCH_FIELDS).toEqual([
      '$user.full_name$',
      '$user.nip_nim$',
      '$user.email$',
      '$user.role.role_name$',
      '$status.attendance_status_name$',
      '$attendance_category.category_name$'
    ]);
  });

  test('uses q as canonical search parameter', () => {
    expect(resolveSummarySearchTerm({ q: '  Nico  ' })).toEqual({
      term: 'Nico',
      source: 'q'
    });
  });

  test('falls back through deprecated aliases', () => {
    expect(resolveSummarySearchTerm({ search: 'Rina' })).toEqual({
      term: 'Rina',
      source: 'search'
    });
    expect(resolveSummarySearchTerm({ query: 'late' })).toEqual({
      term: 'late',
      source: 'query'
    });
    expect(resolveSummarySearchTerm({ keyword: 'wfo' })).toEqual({
      term: 'wfo',
      source: 'keyword'
    });
  });

  test('uses q over all deprecated aliases', () => {
    expect(
      resolveSummarySearchTerm({
        q: 'Canonical',
        search: 'SearchAlias',
        query: 'QueryAlias',
        keyword: 'KeywordAlias'
      })
    ).toEqual({
      term: 'Canonical',
      source: 'q'
    });
  });

  test('skips blank values and keeps precedence for next non-blank alias', () => {
    expect(resolveSummarySearchTerm({ q: '   ', search: 'SearchAlias' })).toEqual({
      term: 'SearchAlias',
      source: 'search'
    });
  });

  test('returns null term when no search value is provided', () => {
    expect(resolveSummarySearchTerm({})).toEqual({ term: null, source: null });
    expect(resolveSummarySearchTerm({ q: '   ' })).toEqual({ term: null, source: null });
  });

  test('uses the first string value from array query params', () => {
    expect(resolveSummarySearchTerm({ q: ['  ', 'ArrayValue'] })).toEqual({
      term: 'ArrayValue',
      source: 'q'
    });
  });
});
```

- [ ] **Step 2: Run utility tests to verify failure**

Run:

```bash
npm test -- --testPathPattern=summaryReportQuery
```

Expected: FAIL because `src/utils/summaryReportQuery.js` does not exist.

- [ ] **Step 3: Commit failing tests**

```bash
git add tests/summaryReportQuery.test.js
git commit -m "test: define summary report search query helpers"
```

---

### Task 4: Implement summary search query utility

**Files:**
- Create: `src/utils/summaryReportQuery.js`
- Test: `tests/summaryReportQuery.test.js`

- [ ] **Step 1: Create utility implementation**

Create `src/utils/summaryReportQuery.js` with:

```js
export const SUMMARY_REPORT_SEARCH_FIELDS = [
  '$user.full_name$',
  '$user.nip_nim$',
  '$user.email$',
  '$user.role.role_name$',
  '$status.attendance_status_name$',
  '$attendance_category.category_name$'
];

const SUMMARY_SEARCH_PARAM_PRECEDENCE = ['q', 'search', 'query', 'keyword'];

const firstStringValue = (value) => {
  if (Array.isArray(value)) {
    return value.find((item) => typeof item === 'string') ?? null;
  }

  return typeof value === 'string' ? value : null;
};

export const resolveSummarySearchTerm = (query = {}) => {
  for (const key of SUMMARY_SEARCH_PARAM_PRECEDENCE) {
    const value = firstStringValue(query[key]);
    const trimmed = value?.trim();

    if (trimmed) {
      return { term: trimmed, source: key };
    }
  }

  return { term: null, source: null };
};

export default {
  SUMMARY_REPORT_SEARCH_FIELDS,
  resolveSummarySearchTerm
};
```

- [ ] **Step 2: Run utility tests**

Run:

```bash
npm test -- --testPathPattern=summaryReportQuery
```

Expected: PASS.

- [ ] **Step 3: Commit utility implementation**

```bash
git add src/utils/summaryReportQuery.js tests/summaryReportQuery.test.js
git commit -m "feat: resolve summary report search aliases"
```

---

### Task 5: Add summary controller contract tests for periods and search

**Files:**
- Modify: `tests/summaryReportContract.test.js`
- Modify in Task 6: `src/controllers/summary.controller.js`

- [ ] **Step 1: Add Sequelize Op import**

At the top of `tests/summaryReportContract.test.js`, after the Jest import, add:

```js
import { Op } from 'sequelize';
```

- [ ] **Step 2: Add query-option helper functions after `buildRes`**

After the `buildRes` function, add:

```js
const getDetailQueryOptions = () => mockAttendanceFindAndCountAll.mock.calls[0][0];

const getSearchConditions = (queryOptions) => {
  const andConditions = queryOptions.where[Op.and];
  const searchWrapper = andConditions.find((condition) => condition[Op.or]);
  return searchWrapper[Op.or];
};

const expectSearchTerm = (queryOptions, expectedTerm) => {
  const searchConditions = getSearchConditions(queryOptions);

  expect(searchConditions).toEqual(
    expect.arrayContaining([
      { '$user.full_name$': { [Op.like]: `%${expectedTerm}%` } },
      { '$user.nip_nim$': { [Op.like]: `%${expectedTerm}%` } },
      { '$user.email$': { [Op.like]: `%${expectedTerm}%` } },
      { '$user.role.role_name$': { [Op.like]: `%${expectedTerm}%` } },
      { '$status.attendance_status_name$': { [Op.like]: `%${expectedTerm}%` } },
      { '$attendance_category.category_name$': { [Op.like]: `%${expectedTerm}%` } }
    ])
  );
};
```

- [ ] **Step 3: Update old invalid-period expected message**

In the test named `rejects legacy report period values with the dashboard analytics period contract`, change the request period from `daily` to `all`, change the test name to:

```js
it('rejects all report periods because unlimited dashboard summary reports are unsupported', async () => {
```

Change the expected message to:

```js
message: 'Parameter period harus berupa: daily, weekly, monthly, range, 30d, current_month, atau custom'
```

- [ ] **Step 4: Add canonical period tests before the custom boundary test**

Add these tests before `rejects custom report periods without both date boundaries`:

```js
  it.each([
    ['daily'],
    ['weekly'],
    ['monthly'],
    ['range']
  ])('accepts canonical dashboard report period %s', async (period) => {
    const req = {
      query: {
        period,
        from: period === 'range' ? '2026-05-01' : undefined,
        to: period === 'range' ? '2026-05-07' : undefined,
        page: '1',
        limit: '10'
      }
    };
    const res = buildRes();
    const next = jest.fn();

    await getSummaryReport(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockAttendanceFindAndCountAll).toHaveBeenCalled();
  });

  it('rejects range report periods without both date boundaries', async () => {
    const req = { query: { period: 'range', from: '2026-05-01', page: '1', limit: '10' } };
    const res = buildRes();
    const next = jest.fn();

    await getSummaryReport(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockAttendanceFindAll).not.toHaveBeenCalled();
    expect(mockAttendanceFindAndCountAll).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: 'E_VALIDATION',
      message: 'Parameter from dan to wajib diisi saat period=range atau custom'
    });
  });
```

- [ ] **Step 5: Add search contract tests before the final closing `});`**

Add these tests near the end of the describe block:

```js
  it('applies canonical q search to report rows before pagination without filtering period-wide summary queries', async () => {
    const req = { query: { period: 'monthly', q: 'Rina', page: '1', limit: '10' } };
    const res = buildRes();
    const next = jest.fn();

    await getSummaryReport(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockAttendanceFindAll.mock.calls[0][0].where).toEqual({
      attendance_date: expect.any(Object)
    });
    expect(mockAttendanceFindAll.mock.calls[1][0].where).toEqual({
      attendance_date: expect.any(Object)
    });

    const queryOptions = getDetailQueryOptions();
    expect(queryOptions.distinct).toBe(true);
    expectSearchTerm(queryOptions, 'Rina');

    const payload = res.json.mock.calls[0][0];
    expect(payload.summary).toEqual({
      total_ontime: 1,
      total_late: 0,
      total_early: 0,
      total_alpha: 0,
      total_wfo: 1,
      total_wfh: 0,
      total_wfa: 0
    });
  });

  it.each([
    ['search', 'SearchAlias'],
    ['query', 'QueryAlias'],
    ['keyword', 'KeywordAlias']
  ])('applies deprecated %s search alias when q is absent', async (paramName, value) => {
    const req = { query: { period: 'monthly', [paramName]: value, page: '1', limit: '10' } };
    const res = buildRes();
    const next = jest.fn();

    await getSummaryReport(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expectSearchTerm(getDetailQueryOptions(), value);
  });

  it('uses q over deprecated search aliases when multiple aliases are present', async () => {
    const req = {
      query: {
        period: 'monthly',
        q: 'Canonical',
        search: 'SearchAlias',
        query: 'QueryAlias',
        keyword: 'KeywordAlias',
        page: '1',
        limit: '10'
      }
    };
    const res = buildRes();
    const next = jest.fn();

    await getSummaryReport(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expectSearchTerm(getDetailQueryOptions(), 'Canonical');
  });

  it('treats blank q as no search filter', async () => {
    const req = { query: { period: 'monthly', q: '   ', page: '1', limit: '10' } };
    const res = buildRes();
    const next = jest.fn();

    await getSummaryReport(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const queryOptions = getDetailQueryOptions();
    expect(queryOptions.where[Op.and]).toBeUndefined();
  });
```

- [ ] **Step 6: Run summary controller tests to verify failure**

Run:

```bash
npm test -- --testPathPattern=summaryReportContract
```

Expected: FAIL because `getSummaryReport` does not resolve search aliases, does not apply search fields, and does not set `distinct: true` yet.

- [ ] **Step 7: Commit failing controller tests**

```bash
git add tests/summaryReportContract.test.js
git commit -m "test: define summary search and period controller contract"
```

---

### Task 6: Implement summary controller search and period integration

**Files:**
- Modify: `src/controllers/summary.controller.js`
- Test: `tests/summaryReportContract.test.js`

- [ ] **Step 1: Add imports**

In `src/controllers/summary.controller.js`, add these imports near the other utility imports:

```js
import { applySearch } from '../utils/searchHelper.js';
import {
  resolveSummarySearchTerm,
  SUMMARY_REPORT_SEARCH_FIELDS
} from '../utils/summaryReportQuery.js';
```

- [ ] **Step 2: Resolve search term in `getSummaryReport`**

After the existing query destructuring line:

```js
const { period = '30d', from = null, to = null, page = 1, limit = 10 } = req.query;
```

add:

```js
const { term: summarySearchTerm } = resolveSummarySearchTerm(req.query);
```

- [ ] **Step 3: Replace inline `findAndCountAll` options with `detailQueryOptions`**

Replace the current `const attendanceData = await Attendance.findAndCountAll({ ... });` block with:

```js
    const detailQueryOptions = {
      where: whereClause,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id_users', 'full_name', 'email', 'nip_nim'],
          include: [
            {
              model: Role,
              as: 'role',
              attributes: ['role_name']
            }
          ]
        },
        {
          model: Location,
          as: 'location',
          attributes: ['location_id', 'description', 'latitude', 'longitude'],
          required: false,
          include: [
            {
              model: AttendanceCategory,
              as: 'attendance_category',
              attributes: ['category_name']
            }
          ]
        },
        {
          model: AttendanceCategory,
          as: 'attendance_category',
          attributes: ['category_name']
        },
        {
          model: AttendanceStatus,
          as: 'status',
          attributes: ['attendance_status_name']
        }
      ],
      order: [
        ['attendance_date', 'DESC'],
        ['time_in', 'DESC']
      ],
      limit: parseInt(limit),
      offset: offset,
      distinct: true
    };

    if (summarySearchTerm) {
      applySearch(detailQueryOptions, summarySearchTerm, SUMMARY_REPORT_SEARCH_FIELDS);
    }

    const attendanceData = await Attendance.findAndCountAll(detailQueryOptions);
```

- [ ] **Step 4: Run focused controller tests**

Run:

```bash
npm test -- --testPathPattern=summaryReportContract
```

Expected: PASS.

- [ ] **Step 5: Run related focused tests**

Run:

```bash
npm test -- --testPathPattern=summarySettingsCache
npm test -- --testPathPattern=summaryDashboardAnalyticsRoute
```

Expected: PASS. These guard nearby summary/report route behavior and settings preload behavior.

- [ ] **Step 6: Commit implementation**

```bash
git add src/controllers/summary.controller.js src/utils/summaryReportQuery.js tests/summaryReportContract.test.js
git commit -m "feat: apply summary report search before pagination"
```

---

### Task 7: Update OpenAPI contract tests

**Files:**
- Modify: `tests/clientCriticalOpenApiContract.test.js`
- Modify in Task 8: `docs/openapi.yaml`

- [ ] **Step 1: Update expected summary report parameter assertions**

In the test named `documents canonical and deprecated summary report routes against the same shared schema`, replace the `expectedPeriodParameter` definition with:

```js
    const expectedPeriodParameter = expect.objectContaining({
      name: 'period',
      schema: expect.objectContaining({
        type: 'string',
        enum: ['daily', 'weekly', 'monthly', 'range', '30d', 'current_month', 'custom'],
        default: 'monthly'
      })
    });
```

- [ ] **Step 2: Add search parameter assertions**

In the same test, after `expectedToParameter`, add:

```js
    const expectedQParameter = expect.objectContaining({
      name: 'q',
      deprecated: false,
      schema: expect.objectContaining({ type: 'string' })
    });
    const expectedDeprecatedSearchAliases = ['search', 'query', 'keyword'].map((name) =>
      expect.objectContaining({
        name,
        deprecated: true,
        schema: expect.objectContaining({ type: 'string' })
      })
    );
```

Then replace the canonical and legacy parameter assertions with:

```js
    expect(canonicalOperation.parameters).toEqual(
      expect.arrayContaining([
        expectedPeriodParameter,
        expectedFromParameter,
        expectedToParameter,
        expectedQParameter,
        ...expectedDeprecatedSearchAliases
      ])
    );
    expect(legacyOperation.parameters).toEqual(
      expect.arrayContaining([
        expectedPeriodParameter,
        expectedFromParameter,
        expectedToParameter,
        expectedQParameter,
        ...expectedDeprecatedSearchAliases
      ])
    );
    expect(canonicalOperation.parameters.find((param) => param.name === 'period').schema.enum).not.toContain(
      'all'
    );
```

- [ ] **Step 3: Update validation message expectations**

In the same test, replace both expected `.toContain('30d, current_month, atau custom')` assertions with:

```js
    expect(canonicalOperation.responses['400'].content['application/json'].schema.properties.message.example).toContain(
      'daily, weekly, monthly, range, 30d, current_month, atau custom'
    );
    expect(legacyOperation.responses['400'].content['application/json'].schema.properties.message.example).toContain(
      'daily, weekly, monthly, range, 30d, current_month, atau custom'
    );
```

- [ ] **Step 4: Run OpenAPI contract test to verify failure**

Run:

```bash
npm test -- --testPathPattern=clientCriticalOpenApiContract
```

Expected: FAIL because `docs/openapi.yaml` does not yet document the new period enum or search params.

- [ ] **Step 5: Commit failing OpenAPI test**

```bash
git add tests/clientCriticalOpenApiContract.test.js
git commit -m "test: document summary query contract in OpenAPI"
```

---

### Task 8: Update OpenAPI YAML and reporting boundary docs

**Files:**
- Modify: `docs/openapi.yaml`
- Modify: `docs/reporting-analytics-boundary.md`
- Test: `tests/clientCriticalOpenApiContract.test.js`

- [ ] **Step 1: Update `/api/summary/reports` period parameter**

In `docs/openapi.yaml`, under `/api/summary/reports` parameters, replace the period parameter block with:

```yaml
        - in: query
          name: period
          schema:
            type: string
            enum: [daily, weekly, monthly, range, 30d, current_month, custom]
            default: monthly
          description: Dashboard/report window. Canonical values are `daily` (today), `weekly` (rolling 7 days), `monthly` (rolling 30 days), and `range` with `from`/`to`. Legacy values `30d`, `current_month`, and `custom` remain temporarily supported. `all` is not supported.
```

- [ ] **Step 2: Add search params to `/api/summary/reports`**

After the `limit` parameter for `/api/summary/reports`, add:

```yaml
        - in: query
          name: q
          deprecated: false
          schema:
            type: string
            example: nico
          description: Canonical free-text search for report rows. Applies before pagination to `report.data` and `report.pagination` only; top-level `summary` remains period-wide.
        - in: query
          name: search
          deprecated: true
          schema:
            type: string
            example: nico
          description: Deprecated alias for `q`. If multiple aliases are provided, precedence is `q`, then `search`, then `query`, then `keyword`.
        - in: query
          name: query
          deprecated: true
          schema:
            type: string
            example: nico
          description: Deprecated alias for `q`. Prefer `q` for new clients.
        - in: query
          name: keyword
          deprecated: true
          schema:
            type: string
            example: nico
          description: Deprecated alias for `q`. Prefer `q` for new clients.
```

- [ ] **Step 3: Update `/api/summary` alias parameters the same way**

Apply the same period replacement and search parameter additions under `/api/summary`.

- [ ] **Step 4: Update 400 message examples**

For both `/api/summary/reports` and `/api/summary`, set the invalid period message example to:

```yaml
                    example: Parameter period harus berupa: daily, weekly, monthly, range, 30d, current_month, atau custom
```

- [ ] **Step 5: Update `docs/reporting-analytics-boundary.md`**

In the endpoint decision matrix row for `GET /api/summary/reports`, replace the period sentence with:

```markdown
Uses dashboard-native report window semantics: `period=daily`, `period=weekly`, `period=monthly`, or `period=range` with `from`/`to`. Legacy `30d`, `current_month`, and `custom` remain temporarily supported for backend compatibility.
```

In Consumer rules, add these bullets:

```markdown
- Use `q` as the canonical free-text search parameter for `/api/summary/reports` rows.
- Treat `search`, `query`, and `keyword` as deprecated compatibility aliases for `q`.
- Do not use `period=all` for `/api/summary/reports`; use `daily`, `weekly`, `monthly`, or `range`.
- Search filters `report.data` and `report.pagination` only; top-level `summary` remains period-wide.
```

- [ ] **Step 6: Run OpenAPI contract tests**

Run:

```bash
npm test -- --testPathPattern=clientCriticalOpenApiContract
```

Expected: PASS.

- [ ] **Step 7: Commit docs update**

```bash
git add docs/openapi.yaml docs/reporting-analytics-boundary.md tests/clientCriticalOpenApiContract.test.js
git commit -m "docs: document summary search period contract"
```

---

### Task 9: Add sanitized runtime evidence template and run verification

**Files:**
- Create: `docs/inf-171-evidence/RUN_2026-05-30.md`
- Modify: none

- [ ] **Step 1: Create evidence directory before runtime smoke**

Run:

```bash
mkdir -p docs/inf-171-evidence
```

On Windows PowerShell, use:

```powershell
if (-not (Test-Path "docs\inf-171-evidence")) { New-Item -ItemType Directory -Path "docs\inf-171-evidence" -Force | Out-Null }
```

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm test -- --testPathPattern=historicalDateWindow
npm test -- --testPathPattern=summaryReportQuery
npm test -- --testPathPattern=summaryReportContract
npm test -- --testPathPattern=clientCriticalOpenApiContract
```

Expected: all PASS.

- [ ] **Step 4: Run full test suite**

Run:

```bash
npm test
```

Expected: all suites PASS.

- [ ] **Step 5: Run runtime smoke with privileged token**

Use an Admin or Management bearer token. Do not store the token. Capture only sanitized output for:

```bash
GET /api/summary/reports
GET /api/summary/reports?q=nico
GET /api/summary/reports?search=nico
GET /api/summary/reports?query=nico
GET /api/summary/reports?keyword=nico
GET /api/summary/reports?period=daily
GET /api/summary/reports?period=weekly
GET /api/summary/reports?period=monthly
GET /api/summary/reports?period=range&from=2026-05-01&to=2026-05-07
GET /api/summary/reports?period=all
```

Expected:

- baseline returns 200.
- `q=nico` returns 200 and changes row pagination compared with baseline when dataset has matching rows.
- aliases return the same filtered result as `q=nico`.
- canonical periods return 200.
- `period=range` returns 200.
- `period=all` returns 400 `E_VALIDATION`.

- [ ] **Step 6: Write sanitized evidence file**

Create `docs/inf-171-evidence/RUN_2026-05-30.md` with this structure and fill it only with sanitized runtime values:

```markdown
# INF-171 summary search period runtime evidence — 2026-05-30

## Sanitization

- No token, cookie, database password, or `.env` value is stored here.
- Full names, emails, and NIP/NIM values are redacted.
- Evidence stores HTTP status, public envelope fields, pagination counts, and non-PII row fingerprints only.

## Smoke results

| Case | Expected | Actual | Observation |
| --- | ---: | ---: | --- |
| Baseline | 200 | 200 | Baseline report reachable. |
| `q=nico` | 200 | 200 | Rows and pagination reflect search-filtered result. |
| `search=nico` | 200 | 200 | Deprecated alias matches canonical search behavior. |
| `query=nico` | 200 | 200 | Deprecated alias matches canonical search behavior. |
| `keyword=nico` | 200 | 200 | Deprecated alias matches canonical search behavior. |
| `period=daily` | 200 | 200 | Accepted canonical dashboard period. |
| `period=weekly` | 200 | 200 | Accepted canonical dashboard period. |
| `period=monthly` | 200 | 200 | Accepted canonical dashboard period. |
| `period=range&from=2026-05-01&to=2026-05-07` | 200 | 200 | Accepted explicit range period. |
| `period=all` | 400 | 400 | Rejected unsupported all-time period. |

## Raw sanitized output

```json
[]
```
```

Replace the empty JSON array with sanitized command output.

- [ ] **Step 7: Commit evidence**

```bash
git add -f docs/inf-171-evidence/RUN_2026-05-30.md
git commit -m "test: capture INF-171 runtime evidence"
```

---

### Task 10: Final review and PR preparation

**Files:**
- No required file changes

- [ ] **Step 1: Inspect final diff**

Run:

```bash
git status --short --branch
git log --oneline --decorate -8
git diff origin/develop...HEAD --stat
```

Expected:

- branch is `feature/inf-171-summary-search-period-contract`.
- only INF-171 files are changed.
- no unstaged implementation files remain.

- [ ] **Step 2: Run final verification commands**

Run:

```bash
npm run lint
npm test
```

Expected: PASS.

- [ ] **Step 3: Prepare PR notes**

Use this PR body:

```markdown
## Summary

Implements INF-171 dashboard summary query contract alignment:

- Adds canonical dashboard periods: `daily`, `weekly`, `monthly`, `range`.
- Rejects unsupported `period=all`.
- Preserves legacy compatibility for `30d`, `current_month`, and `custom`.
- Adds canonical summary row search param `q`.
- Supports deprecated search aliases `search`, `query`, and `keyword` with precedence `q > search > query > keyword`.
- Applies search to `report.data` and `report.pagination` only; top-level `summary` remains period-wide.

## Impact

API-significant change to `GET /api/summary/reports` and deprecated alias `GET /api/summary`.

`period=all` is intentionally rejected. FE should migrate dashboard calls to `daily`, `weekly`, `monthly`, or `range`.

## Risk

- Dashboard consumers may expect search to filter cards; docs clarify rows-only behavior.
- Joined search can affect count semantics; implementation uses `distinct: true` and tests cover query options.
- `monthly` is rolling 30 days, while legacy `current_month` remains calendar-month behavior.

## Verification

- [ ] `npm run lint`
- [ ] `npm test`
- [ ] focused summary/search/OpenAPI tests
- [ ] sanitized runtime smoke in `docs/inf-171-evidence/RUN_2026-05-30.md`

## Docs/ADR

DOCS/ADR UPDATE REQUIRED.

Updated:
- `docs/openapi.yaml`
- `docs/reporting-analytics-boundary.md`
- design spec under `docs/superpowers/specs/`
```

- [ ] **Step 4: Stop for review before push**

Report final status to the user and ask whether to push/create PR. Do not push without explicit user approval.

---

## Self-review checklist

- Spec coverage: tasks cover canonical periods, `all` rejection, search aliases, rows-only filtering, OpenAPI, docs, tests, runtime smoke, and PR notes.
- Red-flag scan: this plan contains no incomplete task sections or deferred implementation markers.
- Type/name consistency: period names are `daily`, `weekly`, `monthly`, `range`, `30d`, `current_month`, `custom`; search params are `q`, `search`, `query`, `keyword`; helper names are `SUMMARY_REPORT_SEARCH_FIELDS` and `resolveSummarySearchTerm`.
