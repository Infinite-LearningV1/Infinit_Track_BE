# INF-270 Server-Authoritative WFA Policy and Reason Catalogs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the backend the authoritative owner of the global WFA radius, request reasons, rejection reasons, and booking reject semantics consumed by Android INF-265 and Management Web INF-271.

**Architecture:** Preserve the repository's current layer-first Express architecture. Reuse the existing `settings` table and operational settings service for radius, add focused Sequelize reason catalogs, and keep booking mutations in the existing booking controller while delegating settings/reason lookup to a focused WFA settings service.

**Tech Stack:** Node.js ESM, Express, express-validator, Sequelize 6, MySQL, Jest ESM, OpenAPI YAML.

**Design spec:** `docs/superpowers/specs/2026-07-28-inf-270-wfa-policy-and-reason-catalogs-design.md`

## Global Constraints

- Preserve `Route → middleware/validator → Controller → focused existing-layer service/helper → Sequelize Model → MySQL`.
- Do not add `src/modules`, repository, adapter, policy, mapper, base-controller, or v2 API layers.
- `bookings` remains the WFA request and approval source of truth.
- Do not use or redesign the legacy `wfa_requests` table.
- Store the global radius in the existing `settings` table as `wfa.request.radius_m` and expose it as `wfaRequestRadiusM`.
- All business date behavior uses `Asia/Jakarta`; canonical client date format is strict `YYYY-MM-DD`.
- Android must not control radius, user identity, status, timestamps, or suitability.
- Used reasons are deactivated; no hard-delete endpoint is added.
- Leave the existing `bookings.rejection_reason` column untouched and stop new code from writing it.
- Preserve existing auth-session validation, role guards, transactions, duplicate-booking rules, and nightly resolver semantics.
- During the compatibility window, accept but ignore legacy `radius`, `suitability_score`, and `suitability_label` request fields.
- Every task follows test-first development and ends in an independently reviewable commit.
- Implementation branch starts from `develop`; final delivery is a PR into `develop`.

---

## File Structure Map

### Create

```text
src/controllers/wfaSettings.controller.js
src/services/wfaSettings.service.js
src/middlewares/wfaSettings.validator.js
src/models/wfaRequestReason.model.js
src/models/wfaRejectionReason.model.js
src/models/migrations/20260728010000-add-wfa-request-policy.cjs
tests/wfaSettingsService.test.js
tests/wfaSettingsRoutesContract.test.js
tests/wfaRequestConfigContract.test.js
tests/bookingWfaPolicyContract.test.js
tests/bookingWfaRejectionContract.test.js
tests/bookingWfaProjectionContract.test.js
tests/openapiWfaPolicyContract.test.js
```

### Modify

```text
src/utils/settings.js
src/services/operationalSettings.service.js
src/middlewares/settings.validator.js
src/routes/settings.routes.js
src/routes/wfa.routes.js
src/routes/booking.routes.js
src/middlewares/validator.js
src/controllers/booking.controller.js
src/models/booking.model.js
src/models/index.js
docs/openapi.yaml
tests/operationalSettings.test.js
tests/settingsOperationalRoutesContract.test.js
tests/bookingsReadinessContract.test.js
tests/resolveWfaBookingsJobIdempotency.test.js
```

### Responsibilities

- `wfaSettings.service.js`: typed settings/reason reads and CRUD-lite catalog operations.
- `wfaSettings.controller.js`: HTTP response orchestration for request config and catalog endpoints.
- `wfaSettings.validator.js`: catalog body/path validation only.
- `booking.controller.js`: canonical create/approve/reject transaction orchestration.
- `settings.js` and `operationalSettings.service.js`: canonical operational radius mapping and mutation.
- reason models: relational catalog persistence.
- migration: additive schema, defaults, indexes, and FKs without legacy data deletion.

---

### Task 1: Add the Global WFA Radius to Existing Operational Settings

**Files:**
- Modify: `src/utils/settings.js`
- Modify: `src/services/operationalSettings.service.js`
- Modify: `src/middlewares/settings.validator.js`
- Modify: `tests/operationalSettings.test.js`
- Modify: `tests/settingsOperationalRoutesContract.test.js`

**Interfaces:**
- Produces: `wfaRequestRadiusM: number` in operational settings reads and patches.
- Produces: DB key `wfa.request.radius_m` with default `100`.
- Consumes: existing `Settings` model and operational settings transaction flow.

- [ ] **Step 1: Extend failing operational settings expectations**

Update `tests/operationalSettings.test.js` so all full settings fixtures include:

```js
{ setting_key: 'wfa.request.radius_m', setting_value: '100' }
```

and expected typed objects include:

```js
wfaRequestRadiusM: 100
```

Add focused assertions:

```js
expect(OPERATIONAL_SETTING_KEYS.wfaRequestRadiusM).toBe('wfa.request.radius_m');
expect(OPERATIONAL_SETTING_DEFAULTS.wfaRequestRadiusM).toBe(100);
expect(OPERATIONAL_SETTING_INTEGER_FIELDS).toContain('wfaRequestRadiusM');
expect(normalizeOperationalSettingValue('wfaRequestRadiusM', '150')).toBe(150);
expect(normalizeOperationalSettingValue('wfaRequestRadiusM', 0)).toBeNull();
```

- [ ] **Step 2: Run focused settings tests and verify failure**

Run:

```bash
npm test -- --runInBand tests/operationalSettings.test.js tests/settingsOperationalRoutesContract.test.js
```

Expected: FAIL because `wfaRequestRadiusM` is not yet registered.

- [ ] **Step 3: Register the WFA radius in the existing settings map**

Modify `src/utils/settings.js`:

```js
export const OPERATIONAL_SETTING_KEYS = {
  geofenceRadiusDefaultM: 'attendance.geofence.radius_default_m',
  autoCheckoutIdleMin: 'attendance.auto_checkout.idle_min',
  autoCheckoutTBufferMin: 'attendance.auto_checkout.tbuffer_min',
  lateCheckoutToleranceMin: 'attendance.auto_checkout.late_tolerance_min',
  defaultShiftEnd: 'checkout.fallback_time',
  wfaRequestRadiusM: 'wfa.request.radius_m'
};

export const OPERATIONAL_SETTING_DEFAULTS = {
  geofenceRadiusDefaultM: 100,
  autoCheckoutIdleMin: 10,
  autoCheckoutTBufferMin: 30,
  lateCheckoutToleranceMin: 15,
  defaultShiftEnd: '17:00:00',
  wfaRequestRadiusM: 100
};

export const OPERATIONAL_SETTING_INTEGER_FIELDS = Object.freeze([
  'geofenceRadiusDefaultM',
  'autoCheckoutIdleMin',
  'autoCheckoutTBufferMin',
  'lateCheckoutToleranceMin',
  'wfaRequestRadiusM'
]);
```

Do not add a separate settings access path.

- [ ] **Step 4: Verify existing operational patch validation accepts the field**

Add a route-contract assertion that this payload reaches the existing patch handler:

```js
{
  wfaRequestRadiusM: 150
}
```

and invalid values such as `0`, `-1`, and non-integers return `400`.

Only modify `settings.validator.js` when its explicit allow-list does not already derive from `OPERATIONAL_SETTING_FIELDS`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- --runInBand tests/operationalSettings.test.js tests/settingsOperationalRoutesContract.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit the settings contract**

```bash
git add src/utils/settings.js src/services/operationalSettings.service.js src/middlewares/settings.validator.js tests/operationalSettings.test.js tests/settingsOperationalRoutesContract.test.js
git commit -m "feat: add global WFA radius setting"
```

---

### Task 2: Add Reason Catalog Schema and Booking Columns

**Files:**
- Create: `src/models/migrations/20260728010000-add-wfa-request-policy.cjs`
- Create: `src/models/wfaRequestReason.model.js`
- Create: `src/models/wfaRejectionReason.model.js`
- Modify: `src/models/booking.model.js`
- Modify: `src/models/index.js`
- Create: `tests/wfaSettingsService.test.js`

**Interfaces:**
- Produces: Sequelize models `WfaRequestReason` and `WfaRejectionReason`.
- Produces: Booking associations `request_reason` and `rejection_reason_detail`.
- Produces booking fields: `request_reason_id`, `request_other_reason`, `rejection_reason_id`, `rejection_note`, `radius_snapshot`.
- Preserves: legacy `Booking.rejection_reason`.

- [ ] **Step 1: Write failing model/export contract tests**

Create `tests/wfaSettingsService.test.js` with an initial model-shape test using dynamic imports or source-contract assertions consistent with existing model tests:

```js
expect(models).toHaveProperty('WfaRequestReason');
expect(models).toHaveProperty('WfaRejectionReason');
expect(models.Booking.rawAttributes).toHaveProperty('request_reason_id');
expect(models.Booking.rawAttributes).toHaveProperty('rejection_reason_id');
expect(models.Booking.rawAttributes).toHaveProperty('radius_snapshot');
expect(models.Booking.rawAttributes).toHaveProperty('rejection_reason');
```

Also assert association aliases:

```js
expect(models.Booking.associations).toHaveProperty('request_reason');
expect(models.Booking.associations).toHaveProperty('rejection_reason_detail');
```

- [ ] **Step 2: Run the model test and verify failure**

```bash
npm test -- --runInBand tests/wfaSettingsService.test.js
```

Expected: FAIL because models and fields do not exist.

- [ ] **Step 3: Implement the request reason model**

Create `src/models/wfaRequestReason.model.js`:

```js
import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const WfaRequestReason = sequelize.define(
  'WfaRequestReason',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    label: { type: DataTypes.STRING(120), allowNull: false },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    is_other: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false }
  },
  {
    tableName: 'wfa_request_reasons',
    timestamps: false
  }
);

export default WfaRequestReason;
```

- [ ] **Step 4: Implement the rejection reason model**

Create `src/models/wfaRejectionReason.model.js` with the same fields and table name `wfa_rejection_reasons`.

- [ ] **Step 5: Add booking fields without removing the legacy field**

Modify `src/models/booking.model.js`:

```js
request_reason_id: {
  type: DataTypes.INTEGER,
  allowNull: true,
  references: { model: 'wfa_request_reasons', key: 'id' }
},
request_other_reason: {
  type: DataTypes.TEXT,
  allowNull: true
},
rejection_reason_id: {
  type: DataTypes.INTEGER,
  allowNull: true,
  references: { model: 'wfa_rejection_reasons', key: 'id' }
},
rejection_note: {
  type: DataTypes.TEXT,
  allowNull: true
},
radius_snapshot: {
  type: DataTypes.INTEGER,
  allowNull: true
}
```

Keep the existing `rejection_reason` definition unchanged.

- [ ] **Step 6: Register models and associations**

Modify `src/models/index.js`:

```js
import WfaRequestReason from './wfaRequestReason.model.js';
import WfaRejectionReason from './wfaRejectionReason.model.js';
```

Add:

```js
Booking.belongsTo(WfaRequestReason, {
  foreignKey: 'request_reason_id',
  as: 'request_reason'
});

Booking.belongsTo(WfaRejectionReason, {
  foreignKey: 'rejection_reason_id',
  as: 'rejection_reason_detail'
});

WfaRequestReason.hasMany(Booking, {
  foreignKey: 'request_reason_id',
  as: 'bookings'
});

WfaRejectionReason.hasMany(Booking, {
  foreignKey: 'rejection_reason_id',
  as: 'bookings'
});
```

Export both models.

- [ ] **Step 7: Write the additive migration**

Create `src/models/migrations/20260728010000-add-wfa-request-policy.cjs`.

`up` must:

1. insert `wfa.request.radius_m = 100` only when absent;
2. create both catalog tables;
3. insert the approved default rows with deterministic sort orders `10`, `20`, `30`, `999`;
4. add all five nullable booking columns;
5. add indexes for both reason FKs;
6. add `RESTRICT` foreign keys;
7. leave `rejection_reason` untouched.

Default request rows:

```js
[
  ['Pertemuan dengan klien', true, false, 10],
  ['Pekerjaan lapangan', true, false, 20],
  ['Perjalanan bisnis', true, false, 30],
  ['Lainnya', true, true, 999]
]
```

Default rejection rows:

```js
[
  ['Lokasi tidak memenuhi ketentuan', true, false, 10],
  ['Tanggal tidak dapat disetujui', true, false, 20],
  ['Alasan tidak sesuai kebijakan', true, false, 30],
  ['Data pengajuan belum lengkap', true, false, 40],
  ['Lainnya', true, true, 999]
]
```

`down` may remove only the columns/tables/setting introduced by this migration. It must never remove the legacy `rejection_reason` column.

- [ ] **Step 8: Run model tests and migration status**

```bash
npm test -- --runInBand tests/wfaSettingsService.test.js
npm run migrate:status
```

Expected: tests PASS; migration status lists the new migration as pending before execution.

- [ ] **Step 9: Run migration against a disposable test database**

```bash
npm run migrate
npm run migrate:status
```

Expected: migration succeeds, new tables/columns exist, legacy bookings remain readable.

- [ ] **Step 10: Commit schema and models**

```bash
git add src/models/migrations/20260728010000-add-wfa-request-policy.cjs src/models/wfaRequestReason.model.js src/models/wfaRejectionReason.model.js src/models/booking.model.js src/models/index.js tests/wfaSettingsService.test.js
git commit -m "feat: add WFA reason catalogs and booking policy fields"
```

---

### Task 3: Implement WFA Settings Service and Catalog Invariants

**Files:**
- Create: `src/services/wfaSettings.service.js`
- Modify: `tests/wfaSettingsService.test.js`

**Interfaces:**
- Produces: `readWfaRequestConfig(transaction = null)`.
- Produces: `resolveActiveWfaRequestReason({ reasonId, otherReasonText, transaction })`.
- Produces: `resolveActiveWfaRejectionReason({ reasonId, note, transaction })`.
- Produces: `listWfaReasons({ catalog, includeInactive, transaction })`.
- Produces: `createWfaReason({ catalog, payload, transaction })`.
- Produces: `updateWfaReason({ catalog, id, payload, transaction })`.

- [ ] **Step 1: Add failing service behavior tests**

Mock `Settings`, `WfaRequestReason`, and `WfaRejectionReason` through `../src/models/index.js`.

Add tests for:

```js
await expect(readWfaRequestConfig()).resolves.toEqual({
  radiusMeters: 100,
  reasons: [
    { id: 1, label: 'Pertemuan dengan klien', isOther: false, sortOrder: 10 }
  ]
});
```

Add failure tests:

```js
await expect(
  resolveActiveWfaRequestReason({ reasonId: 99, otherReasonText: null })
).rejects.toMatchObject({
  status: 400,
  code: 'WFA_REQUEST_REASON_NOT_FOUND'
});
```

```js
await expect(
  resolveActiveWfaRequestReason({ reasonId: 4, otherReasonText: '   ' })
).rejects.toMatchObject({
  status: 400,
  code: 'WFA_OTHER_REASON_REQUIRED'
});
```

```js
await expect(
  resolveActiveWfaRejectionReason({ reasonId: 5, note: '' })
).rejects.toMatchObject({
  status: 400,
  code: 'REJECTION_NOTE_REQUIRED'
});
```

Add a catalog invariant test proving a second `is_other=true` row fails with `WFA_REASON_CATALOG_CONFLICT`.

- [ ] **Step 2: Run the service test and verify failure**

```bash
npm test -- --runInBand tests/wfaSettingsService.test.js
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement stable service errors**

Inside `src/services/wfaSettings.service.js`:

```js
const createWfaError = ({ status = 400, code, message, field = null }) => {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = field ? [{ field, code }] : [];
  return error;
};
```

Do not introduce a global error rewrite.

- [ ] **Step 4: Implement catalog model selection**

```js
const getCatalogModel = (catalog) => {
  if (catalog === 'request') return WfaRequestReason;
  if (catalog === 'rejection') return WfaRejectionReason;
  throw createWfaError({
    code: 'WFA_REASON_CATALOG_CONFLICT',
    message: 'Katalog alasan WFA tidak valid.'
  });
};
```

- [ ] **Step 5: Implement employee config read**

Use `getOperationalSettingsStrict(transaction)` and `WfaRequestReason.findAll`:

```js
export const readWfaRequestConfig = async (transaction = null) => {
  const [settings, reasons] = await Promise.all([
    getOperationalSettingsStrict(transaction),
    WfaRequestReason.findAll({
      where: { is_active: true },
      order: [['sort_order', 'ASC'], ['id', 'ASC']],
      transaction
    })
  ]);

  return {
    radiusMeters: settings.wfaRequestRadiusM,
    reasons: reasons.map((reason) => ({
      id: reason.id,
      label: reason.label,
      isOther: Boolean(reason.is_other),
      sortOrder: reason.sort_order
    }))
  };
};
```

Map strict settings integrity errors to:

```text
status = 500
code = WFA_CONFIG_UNAVAILABLE
```

without exposing raw DB details.

- [ ] **Step 6: Implement active request reason resolution**

Required return shape:

```js
{
  reason,
  normalizedOtherReason: reason.is_other ? trimmedOtherText : null
}
```

Rules:

- missing ID → `WFA_REQUEST_REASON_REQUIRED`;
- not found → `WFA_REQUEST_REASON_NOT_FOUND`;
- inactive → `WFA_REQUEST_REASON_NOT_ACTIVE`;
- Other with blank text → `WFA_OTHER_REASON_REQUIRED`;
- non-Other normalizes supplied Other text to null.

- [ ] **Step 7: Implement active rejection reason resolution**

Required return shape:

```js
{
  reason,
  normalizedNote: trimmedNote || null
}
```

Rules:

- missing ID → `REJECTION_REASON_REQUIRED`;
- not found → `REJECTION_REASON_NOT_FOUND`;
- inactive → `REJECTION_REASON_NOT_ACTIVE`;
- Other with blank note → `REJECTION_NOTE_REQUIRED`.

- [ ] **Step 8: Implement catalog list/create/update**

Validation at the service boundary:

```text
label: trimmed, 1..120 chars
sort_order: integer >= 0
is_active: boolean when supplied
is_other: boolean only on create
PATCH fields: label, is_active, sort_order only
```

Before creating an `is_other=true` row, query for any existing Other row in that catalog and fail with `WFA_REASON_CATALOG_CONFLICT`.

Do not implement delete.

- [ ] **Step 9: Run service tests**

```bash
npm test -- --runInBand tests/wfaSettingsService.test.js
```

Expected: PASS.

- [ ] **Step 10: Commit the service**

```bash
git add src/services/wfaSettings.service.js tests/wfaSettingsService.test.js
git commit -m "feat: add WFA settings and reason catalog service"
```

---

### Task 4: Add Employee Config and Management Catalog Routes

**Files:**
- Create: `src/controllers/wfaSettings.controller.js`
- Create: `src/middlewares/wfaSettings.validator.js`
- Modify: `src/routes/wfa.routes.js`
- Modify: `src/routes/settings.routes.js`
- Create: `tests/wfaSettingsRoutesContract.test.js`
- Create: `tests/wfaRequestConfigContract.test.js`

**Interfaces:**
- Produces: `GET /api/wfa/request-config`.
- Produces: management CRUD-lite routes under `/api/settings/wfa`.
- Consumes: service functions from Task 3.

- [ ] **Step 1: Write failing route composition tests**

Create route-contract tests that assert:

```text
GET /api/wfa/request-config
→ verifyToken
→ getWfaRequestConfig
```

and:

```text
GET/POST/PATCH /api/settings/wfa/request-reasons
GET/POST/PATCH /api/settings/wfa/rejection-reasons
→ verifyToken
→ roleGuard(['Admin', 'Management'])
→ validator on POST/PATCH
→ controller
```

Assert no DELETE route exists.

- [ ] **Step 2: Write failing controller response tests**

Mock `readWfaRequestConfig()` and expect:

```js
{
  success: true,
  data: {
    radius_meters: 100,
    reasons: [
      {
        id: 1,
        label: 'Pertemuan dengan klien',
        is_other: false,
        sort_order: 10
      }
    ]
  }
}
```

- [ ] **Step 3: Run route/controller tests and verify failure**

```bash
npm test -- --runInBand tests/wfaSettingsRoutesContract.test.js tests/wfaRequestConfigContract.test.js
```

Expected: FAIL because routes/controllers do not exist.

- [ ] **Step 4: Implement catalog validators**

Create `src/middlewares/wfaSettings.validator.js` using `express-validator` and the repository's existing `validate` middleware pattern.

Create exports:

```js
export const createWfaReasonValidation = [...];
export const updateWfaReasonValidation = [...];
export const wfaReasonIdValidation = [...];
```

POST accepts:

```text
label required string max 120
is_other optional boolean
sort_order optional integer min 0
```

PATCH accepts at least one of:

```text
label
is_active
sort_order
```

PATCH rejects `is_other` changes.

- [ ] **Step 5: Implement thin controllers**

Create exports in `src/controllers/wfaSettings.controller.js`:

```js
getWfaRequestConfig
listWfaRequestReasons
createWfaRequestReason
updateWfaRequestReason
listWfaRejectionReasons
createWfaRejectionReason
updateWfaRejectionReason
```

Each controller:

- calls one service function;
- maps domain/service output to snake_case HTTP fields;
- returns `next(error)` on failure;
- does not query Sequelize directly.

- [ ] **Step 6: Mount the employee route**

Modify `src/routes/wfa.routes.js` after `router.use(verifyToken)`:

```js
router.get('/request-config', getWfaRequestConfig);
```

Keep recommendation/AHP routes unchanged.

- [ ] **Step 7: Mount management catalog routes**

Modify `src/routes/settings.routes.js`:

```js
router.get(
  '/wfa/request-reasons',
  roleGuard(['Admin', 'Management']),
  listWfaRequestReasons
);
router.post(
  '/wfa/request-reasons',
  roleGuard(['Admin', 'Management']),
  createWfaReasonValidation,
  validate,
  createWfaRequestReason
);
router.patch(
  '/wfa/request-reasons/:id',
  roleGuard(['Admin', 'Management']),
  wfaReasonIdValidation,
  updateWfaReasonValidation,
  validate,
  updateWfaRequestReason
);
```

Add equivalent rejection reason routes.

- [ ] **Step 8: Run route/controller tests**

```bash
npm test -- --runInBand tests/wfaSettingsRoutesContract.test.js tests/wfaRequestConfigContract.test.js
```

Expected: PASS.

- [ ] **Step 9: Commit routes and controllers**

```bash
git add src/controllers/wfaSettings.controller.js src/middlewares/wfaSettings.validator.js src/routes/wfa.routes.js src/routes/settings.routes.js tests/wfaSettingsRoutesContract.test.js tests/wfaRequestConfigContract.test.js
git commit -m "feat: expose WFA request config and reason management routes"
```

---

### Task 5: Harden Booking Creation with Server-Owned Policy

**Files:**
- Modify: `src/middlewares/validator.js`
- Modify: `src/routes/booking.routes.js`
- Modify: `src/controllers/booking.controller.js`
- Create: `tests/bookingWfaPolicyContract.test.js`
- Modify: `tests/bookingsReadinessContract.test.js`

**Interfaces:**
- Consumes: `readWfaRequestConfig` and `resolveActiveWfaRequestReason` from Task 3.
- Produces: canonical `POST /api/bookings` request/response contract.
- Produces: server-owned location radius and booking `radius_snapshot`.

- [ ] **Step 1: Write failing validator contract tests**

Test valid canonical payload:

```js
{
  schedule_date: '2026-08-10',
  request_reason_id: 1,
  request_other_reason: null,
  notes: 'Pertemuan project',
  latitude: -0.9,
  longitude: 119.87,
  description: 'Lokasi klien'
}
```

Test failures:

```text
10-08-2026 → INVALID_SCHEDULE_DATE
08-10-2026 → INVALID_SCHEDULE_DATE
missing request_reason_id → WFA_REQUEST_REASON_REQUIRED
invalid latitude/longitude → E_VALIDATION
```

Keep compatibility fields accepted by validation:

```text
radius
suitability_score
suitability_label
```

but do not make them required or authoritative.

- [ ] **Step 2: Write failing controller behavior tests**

Mock service/model calls and prove:

```js
expect(Location.create).toHaveBeenCalledWith(
  expect.objectContaining({ radius: 150 }),
  expect.any(Object)
);

expect(Booking.create).toHaveBeenCalledWith(
  expect.objectContaining({
    request_reason_id: 1,
    request_other_reason: null,
    radius_snapshot: 150,
    status: 3
  }),
  expect.any(Object)
);
```

Send `radius: 9999` in the test payload and prove it is not persisted.

Send fake suitability inputs and prove the controller uses server-calculated values.

- [ ] **Step 3: Run booking policy tests and verify failure**

```bash
npm test -- --runInBand tests/bookingWfaPolicyContract.test.js tests/bookingsReadinessContract.test.js
```

Expected: FAIL because the current controller trusts client radius and does not require a reason.

- [ ] **Step 4: Enforce strict ISO date validation**

Update `createBookingValidation` in `src/middlewares/validator.js`:

```js
body('schedule_date')
  .isString()
  .matches(/^\d{4}-\d{2}-\d{2}$/)
  .withMessage('schedule_date harus menggunakan format YYYY-MM-DD');

body('request_reason_id')
  .isInt({ min: 1 })
  .withMessage('request_reason_id wajib diisi');
```

Keep latitude/longitude numeric range validation and existing notes/description limits.

- [ ] **Step 5: Replace ambiguous date parsing in `createBooking`**

Use one strict parser path:

```js
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
if (!isoDatePattern.test(schedule_date)) {
  return res.status(400).json({
    success: false,
    code: 'INVALID_SCHEDULE_DATE',
    message: 'Tanggal WFA harus menggunakan format YYYY-MM-DD.',
    errors: [{ field: 'schedule_date', code: 'INVALID_SCHEDULE_DATE' }]
  });
}
```

Validate calendar correctness by round-tripping year/month/day rather than relying on permissive JavaScript parsing.

Use WIB today semantics from the repository's existing settings/date helper rather than Android/client time.

- [ ] **Step 6: Resolve server configuration and request reason inside the existing transaction**

At the start of the existing booking transaction:

```js
const { radiusMeters } = await readWfaRequestConfig(transaction);
const { reason, normalizedOtherReason } = await resolveActiveWfaRequestReason({
  reasonId: request_reason_id,
  otherReasonText: request_other_reason,
  transaction
});
```

Do not read `radius` from the request body for persistence.

- [ ] **Step 7: Preserve existing duplicate and suitability logic**

Keep:

```text
past/same-day rejection
duplicate pending/approved detection
server status pending
server timestamps
Location reuse/creation
server suitability calculation
```

Remove the branch that trusts client-supplied `suitability_score` and `suitability_label`. Always calculate or resolve suitability server-side.

- [ ] **Step 8: Persist server-owned fields**

Location creation/reuse must use `radiusMeters` for new location radius.

Booking creation must include:

```js
request_reason_id: reason.id,
request_other_reason: normalizedOtherReason,
radius_snapshot: radiusMeters
```

Normalize optional notes to the existing non-null model requirement:

```js
notes: typeof notes === 'string' ? notes.trim() : ''
```

- [ ] **Step 9: Return backend-confirmed result data**

Return:

```js
{
  success: true,
  message: 'Booking WFA berhasil dibuat.',
  data: {
    booking_id,
    schedule_date,
    status: 'pending',
    request_reason: {
      id: reason.id,
      label: reason.label,
      is_other: Boolean(reason.is_other),
      other_text: normalizedOtherReason
    },
    location: {
      location_id,
      latitude,
      longitude,
      radius: radiusMeters,
      description
    },
    radius_snapshot: radiusMeters,
    suitability_score,
    suitability_label,
    created_at
  }
}
```

Do not return raw Sequelize instances.

- [ ] **Step 10: Run booking creation tests**

```bash
npm test -- --runInBand tests/bookingWfaPolicyContract.test.js tests/bookingsReadinessContract.test.js
```

Expected: PASS.

- [ ] **Step 11: Commit booking creation hardening**

```bash
git add src/middlewares/validator.js src/routes/booking.routes.js src/controllers/booking.controller.js tests/bookingWfaPolicyContract.test.js tests/bookingsReadinessContract.test.js
git commit -m "feat: enforce server-owned WFA booking policy"
```

---

### Task 6: Require Explicit Rejection Reasons for Management Decisions

**Files:**
- Modify: `src/middlewares/validator.js`
- Modify: `src/controllers/booking.controller.js`
- Create: `tests/bookingWfaRejectionContract.test.js`

**Interfaces:**
- Consumes: `resolveActiveWfaRejectionReason` from Task 3.
- Produces: typed Management reject contract on `PATCH /api/bookings/:id`.
- Preserves: approval without rejection fields and automated resolver behavior.

- [ ] **Step 1: Write failing rejection contract tests**

Cover:

```text
approved without reason → success
rejected without reason → REJECTION_REASON_REQUIRED
rejected with missing reason → REJECTION_REASON_NOT_FOUND
rejected with inactive reason → REJECTION_REASON_NOT_ACTIVE
rejected with Other and blank note → REJECTION_NOTE_REQUIRED
rejected with normal reason and no note → success
rejected with Other and note → success
```

Assert persisted fields:

```js
expect(booking.update).toHaveBeenCalledWith(
  expect.objectContaining({
    status: 2,
    rejection_reason_id: 5,
    rejection_note: 'Keterangan khusus',
    approved_by: 9,
    processed_at: expect.any(Date)
  }),
  expect.any(Object)
);
```

- [ ] **Step 2: Run rejection tests and verify failure**

```bash
npm test -- --runInBand tests/bookingWfaRejectionContract.test.js
```

Expected: FAIL because the current handler reads only `status`.

- [ ] **Step 3: Extend status validation**

Update the existing status validator so:

```text
status=approved → rejection fields optional and ignored
status=rejected → rejection_reason_id integer >= 1
rejection_note optional string max 500 at HTTP boundary
```

Conditional Other validation remains in the service because it requires database state.

- [ ] **Step 4: Resolve rejection reason only for rejection**

Inside the existing transaction:

```js
let rejectionDecision = {
  reason: null,
  normalizedNote: null
};

if (status === 'rejected') {
  rejectionDecision = await resolveActiveWfaRejectionReason({
    reasonId: req.body.rejection_reason_id,
    note: req.body.rejection_note,
    transaction
  });
}
```

- [ ] **Step 5: Persist approval and rejection fields explicitly**

Approval update:

```js
{
  status: 1,
  rejection_reason_id: null,
  rejection_note: null,
  approved_by: req.user.id,
  processed_at: new Date()
}
```

Rejection update:

```js
{
  status: 2,
  rejection_reason_id: rejectionDecision.reason.id,
  rejection_note: rejectionDecision.normalizedNote,
  approved_by: req.user.id,
  processed_at: new Date()
}
```

Do not write the legacy `rejection_reason` column.

- [ ] **Step 6: Extend the update response**

For rejected bookings return:

```js
rejection_reason: {
  id: rejectionDecision.reason.id,
  label: rejectionDecision.reason.label,
  is_other: Boolean(rejectionDecision.reason.is_other),
  note: rejectionDecision.normalizedNote
}
```

For approved bookings return `rejection_reason: null`.

- [ ] **Step 7: Run rejection tests**

```bash
npm test -- --runInBand tests/bookingWfaRejectionContract.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit reject semantics**

```bash
git add src/middlewares/validator.js src/controllers/booking.controller.js tests/bookingWfaRejectionContract.test.js
git commit -m "feat: require WFA rejection reasons"
```

---

### Task 7: Update Booking Read Projections and Protect Nightly Resolver Behavior

**Files:**
- Modify: `src/controllers/booking.controller.js`
- Create: `tests/bookingWfaProjectionContract.test.js`
- Modify: `tests/resolveWfaBookingsJobIdempotency.test.js`

**Interfaces:**
- Produces: null-safe request/rejection reason and radius snapshot projections for create/list/history/update responses.
- Preserves: automated expiry rejection with null human reason.

- [ ] **Step 1: Write failing projection tests**

New booking expectation:

```js
expect(projectedBooking).toMatchObject({
  request_reason: {
    id: 1,
    label: 'Pertemuan dengan klien',
    is_other: false,
    other_text: null
  },
  rejection_reason: null,
  radius_snapshot: 100
});
```

Rejected booking expectation:

```js
expect(projectedBooking.rejection_reason).toEqual({
  id: 2,
  label: 'Lokasi tidak memenuhi ketentuan',
  is_other: false,
  note: 'Di luar area operasional'
});
```

Legacy row expectation:

```js
expect(projectedBooking).toMatchObject({
  request_reason: null,
  rejection_reason: null,
  radius_snapshot: 100
});
```

where `100` is a read-only fallback from `location.radius` because the legacy row has null `radius_snapshot`.

- [ ] **Step 2: Run projection tests and verify failure**

```bash
npm test -- --runInBand tests/bookingWfaProjectionContract.test.js
```

Expected: FAIL because current read projections do not include the new associations.

- [ ] **Step 3: Add reason associations to booking queries**

For create/list/history/detail/update refetches, include:

```js
{
  model: WfaRequestReason,
  as: 'request_reason',
  attributes: ['id', 'label', 'is_other']
},
{
  model: WfaRejectionReason,
  as: 'rejection_reason_detail',
  attributes: ['id', 'label', 'is_other']
}
```

Use model imports from `src/models/index.js`.

- [ ] **Step 4: Add one focused projection helper inside the controller file**

Do not create a mapper layer. Add a local helper:

```js
const projectWfaReasonData = (booking) => ({
  request_reason: booking.request_reason
    ? {
        id: booking.request_reason.id,
        label: booking.request_reason.label,
        is_other: Boolean(booking.request_reason.is_other),
        other_text: booking.request_other_reason || null
      }
    : null,
  rejection_reason: booking.rejection_reason_detail
    ? {
        id: booking.rejection_reason_detail.id,
        label: booking.rejection_reason_detail.label,
        is_other: Boolean(booking.rejection_reason_detail.is_other),
        note: booking.rejection_note || null
      }
    : null,
  radius_snapshot: booking.radius_snapshot ?? booking.location?.radius ?? null
});
```

Apply it consistently without replacing unrelated response fields.

- [ ] **Step 5: Add nightly resolver regression assertions**

Extend `tests/resolveWfaBookingsJobIdempotency.test.js` to assert system expiry rejection still calls:

```js
booking.update(
  expect.objectContaining({
    status: 2,
    approved_by: null
  })
);
```

and does not require or fabricate `rejection_reason_id`.

- [ ] **Step 6: Run projection and resolver tests**

```bash
npm test -- --runInBand tests/bookingWfaProjectionContract.test.js tests/resolveWfaBookingsJobIdempotency.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit projections and regression protection**

```bash
git add src/controllers/booking.controller.js tests/bookingWfaProjectionContract.test.js tests/resolveWfaBookingsJobIdempotency.test.js
git commit -m "feat: expose WFA policy data in booking responses"
```

---

### Task 8: Document OpenAPI Contract and Complete Verification

**Files:**
- Modify: `docs/openapi.yaml`
- Create: `tests/openapiWfaPolicyContract.test.js`
- Verify: all implementation files from Tasks 1–7

**Interfaces:**
- Produces: OpenAPI as the documented contract for Android and Management Web.
- Produces: final lint/test/migration/runtime evidence.

- [ ] **Step 1: Write failing OpenAPI source-contract tests**

Create `tests/openapiWfaPolicyContract.test.js` asserting the YAML contains:

```text
/api/wfa/request-config
/api/settings/wfa/request-reasons
/api/settings/wfa/request-reasons/{id}
/api/settings/wfa/rejection-reasons
/api/settings/wfa/rejection-reasons/{id}
wfaRequestRadiusM
request_reason_id
request_other_reason
rejection_reason_id
rejection_note
radius_snapshot
```

Assert canonical booking schema does not declare these fields as authoritative request properties:

```text
radius
suitability_score
suitability_label
user_id
status
```

- [ ] **Step 2: Run the OpenAPI test and verify failure**

```bash
npm test -- --runInBand tests/openapiWfaPolicyContract.test.js
```

Expected: FAIL because the contract is not documented.

- [ ] **Step 3: Document operational settings radius**

Extend the existing operational settings schemas with:

```yaml
wfaRequestRadiusM:
  type: integer
  minimum: 1
  example: 100
```

- [ ] **Step 4: Document employee request config**

Add `GET /api/wfa/request-config` with:

```text
Bearer auth
200 config response
401 session failure
500 WFA_CONFIG_UNAVAILABLE
```

- [ ] **Step 5: Document reason catalog routes**

Document GET/POST/PATCH for both catalogs, Admin/Management authorization, payload validation, response schemas, and no DELETE operation.

- [ ] **Step 6: Update booking create and status schemas**

Document strict ISO date, required `request_reason_id`, conditional Other text, server-owned radius, and rejection reason payload.

Document stable error codes from the design spec.

- [ ] **Step 7: Run focused contract tests**

```bash
npm test -- --runInBand \
  tests/operationalSettings.test.js \
  tests/settingsOperationalRoutesContract.test.js \
  tests/wfaSettingsService.test.js \
  tests/wfaSettingsRoutesContract.test.js \
  tests/wfaRequestConfigContract.test.js \
  tests/bookingWfaPolicyContract.test.js \
  tests/bookingWfaRejectionContract.test.js \
  tests/bookingWfaProjectionContract.test.js \
  tests/resolveWfaBookingsJobIdempotency.test.js \
  tests/openapiWfaPolicyContract.test.js
```

Expected: PASS.

- [ ] **Step 8: Run full static and test verification**

```bash
npm run lint
npm test
npm run migrate:status
git diff --check
```

Expected: all commands PASS. If an unrelated baseline test fails, capture the exact pre-existing failure and prove all INF-270 focused tests pass.

- [ ] **Step 9: Run test-database migration verification**

On a disposable MySQL database:

```bash
npm run migrate
npm run migrate:status
```

Verify:

```text
wfa.request.radius_m exists with value 100
both catalog tables contain defaults
bookings has five new nullable fields
legacy rejection_reason still exists
existing booking rows remain readable
```

- [ ] **Step 10: Run authenticated API smoke verification**

Capture request/response evidence for:

```text
GET /api/wfa/request-config
PATCH /api/settings/operational with wfaRequestRadiusM
GET/POST/PATCH request reasons
GET/POST/PATCH rejection reasons
POST /api/bookings normal reason
POST /api/bookings Other reason
POST /api/bookings with radius=9999 proving persisted radius uses settings
PATCH approve
PATCH reject normal reason
PATCH reject Other with note
negative auth and RBAC cases
```

Use disposable booking/catalog data and remove or deactivate smoke rows after verification.

- [ ] **Step 11: Review sensitive-area impact**

Confirm explicitly in PR notes:

```text
attendance final state unchanged
auth/session middleware unchanged
role semantics reused
nightly resolver behavior unchanged
WIB date behavior verified
OpenAPI updated
migration risk documented
Android/Web rollout coordination documented
```

- [ ] **Step 12: Commit documentation and final test contract**

```bash
git add docs/openapi.yaml tests/openapiWfaPolicyContract.test.js
git commit -m "docs: publish WFA policy API contract"
```

- [ ] **Step 13: Open the implementation PR**

Open a PR from the implementation feature branch into `develop` with:

```text
Primary Linear issue: INF-270
Architecture impact
Database migration impact
API contract changes
Compatibility behavior
Focused and full test output
Migration evidence
Authenticated smoke evidence
Android INF-265 dependency note
Web INF-271 dependency note
```

Do not mark INF-270 Done until runtime evidence and contract review are attached.

---

## Plan Self-Review

### Spec coverage

- Global radius through existing settings: Task 1 and Task 2 migration.
- Typed request/rejection catalogs: Tasks 2–4.
- Employee request config: Task 4.
- Server-authoritative booking creation: Task 5.
- Required Management rejection reason: Task 6.
- Backward-compatible read projections: Task 7.
- Nightly resolver preservation: Task 7.
- OpenAPI, migration, tests, and smoke evidence: Task 8.

### Type consistency

The plan consistently uses:

```text
wfaRequestRadiusM ↔ wfa.request.radius_m
request_reason_id ↔ WfaRequestReason
rejection_reason_id ↔ WfaRejectionReason
request_reason association alias
rejection_reason_detail association alias
radius_snapshot
```

### Scope boundary

The plan does not include modular MVC migration, legacy table cleanup, reason hard deletion, Android/Web implementation, idempotency keys, or attendance/scheduler redesign.
