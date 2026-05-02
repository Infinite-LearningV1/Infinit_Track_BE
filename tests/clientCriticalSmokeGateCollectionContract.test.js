import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

describe('client-critical smoke gate collection contract', () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const collectionPath = path.join(__dirname, '..', 'postman', 'client-critical-smoke-gate.collection.json');
  const collection = JSON.parse(fs.readFileSync(collectionPath, 'utf8'));

  const findItemByName = (items, name) => {
    for (const item of items || []) {
      if (item.name === name) return item;
      if (item.item) {
        const nested = findItemByName(item.item, name);
        if (nested) return nested;
      }
    }
    return null;
  };

  const getItem = (name) => {
    const item = findItemByName(collection.item, name);
    expect(item).toBeTruthy();
    return item;
  };

  const getEventExec = (name, listen) => {
    const exec = getItem(name).event?.find((event) => event.listen === listen)?.script?.exec;
    expect(Array.isArray(exec)).toBe(true);
    return exec;
  };

  const getExec = (name) => getEventExec(name, 'test');

  const getPreRequestExec = (name) => getEventExec(name, 'prerequest');

  const getRawUrl = (name) => {
    const rawUrl = getItem(name).request?.url?.raw;
    expect(typeof rawUrl).toBe('string');
    return rawUrl;
  };

  const getRawBody = (name) => {
    const rawBody = getItem(name).request?.body?.raw;
    expect(typeof rawBody).toBe('string');
    return rawBody;
  };

  test('new booking seed does not reroute malformed 201 success into cleanup fallback', () => {
    const exec = getExec('Create Booking - New');
    const script = exec.join('\n');

    expect(script).toContain("pm.test('status is 201', () => pm.response.to.have.status(201));");
    expect(script).toContain("pm.test('booking create contract is strict', () => {");
    expect(script).not.toContain("if (!body.data || typeof body.data.booking_id !== 'number') {");
    expect(script).not.toContain("pm.execution.setNextRequest('Delete Attendance - WFA New Fixture Cleanup');");
  });

  test('WFA new-booking check-in keeps the happy path strict but explicitly skips the known live operational-window blocker', () => {
    const exec = getExec('Check In - WFA New Booking');
    const script = exec.join('\n');

    expect(script).not.toContain("body.message === 'Booking tidak berlaku untuk hari ini.'");
    expect(script).not.toContain("WFA new booking happy path is skipped when DB bridge is absent");
    expect(script).toContain("const operationalWindowMessage = 'Check-in hanya bisa dilakukan pada jam 07:00 - 22:00.';");
    expect(script).toContain("const isOperationalWindowBlock =");
    expect(script).toContain("pm.test('WFA new booking check-in is skipped only for the known live operational window blocker', () => {");
    expect(script).toContain("pm.execution.setNextRequest('Check In - Missing category_id');");
    expect(script).toContain("pm.test('status is 201', () => pm.response.to.have.status(201));");
    expect(script).toContain("pm.test('WFA new booking check-in contract is strict after DB bridge', () => {");
  });

  test('Management login seeds WFA coordinates for downstream booking and attendance requests', () => {
    const script = getExec('Login - Management').join('\n');

    expect(script).toContain("pm.environment.set('managementToken', body.data.token);");
    expect(script).toContain("pm.environment.set('managementWfaLatitude', String(body.data.location.latitude));");
    expect(script).toContain("pm.environment.set('managementWfaLongitude', String(body.data.location.longitude));");
    expect(script).toContain("pm.environment.set('managementWfaRadius', String(body.data.location.radius));");
  });

  test('wrong-password login accepts runtime validation details while keeping the auth failure contract strict', () => {
    const script = getExec('Login - Wrong Password').join('\n');

    expect(script).toContain("pm.expect(body.success).to.eql(false);");
    expect(script).toContain("pm.expect(body.code).to.eql('E_LOGIN');");
    expect(script).toContain("pm.expect(body.message).to.eql('Password salah');");
    expect(script).toContain("if (body.errors !== undefined) {");
    expect(script).toContain("pm.expect(body.errors).to.be.an('array');");
    expect(script).not.toContain("pm.expect(Object.keys(body).sort()).to.eql(['code', 'message', 'success']);");
  });

  test('existing approved booking cleanup and residue tracking stay on management fixture id', () => {
    const createScript = getExec('Create Booking - Existing Seed').join('\n');
    const approveScript = getExec('Approve Booking - Existing Seed').join('\n');
    const wrongUserRawBody = getRawBody('Check In - WFA Wrong User Booking');
    const cleanupScript = getExec('Delete Booking - Existing Seed').join('\n');
    const cleanupRawUrl = getRawUrl('Delete Booking - Existing Seed');
    const residueScript = getExec('Booking History - Management residue check').join('\n');

    expect(createScript).toContain("pm.environment.set('existingManagementBookingId', String(body.data.booking_id));");
    expect(createScript).not.toContain("pm.environment.set('existingBookingId', String(body.data.booking_id));");
    expect(approveScript).toContain("pm.environment.get('existingManagementBookingId')");
    expect(approveScript).not.toContain("pm.environment.get('existingBookingId')");
    expect(wrongUserRawBody).toContain('{{existingManagementBookingId}}');
    expect(wrongUserRawBody).not.toContain('{{existingBookingId}}');
    expect(cleanupScript).toContain("pm.environment.set('existingManagementBookingId', '');");
    expect(cleanupScript).not.toContain("pm.environment.set('existingBookingId', '');");
    expect(cleanupRawUrl).toContain('{{existingManagementBookingId}}');
    expect(cleanupRawUrl).not.toContain('{{existingBookingId}}');
    expect(residueScript).toContain("pm.environment.get('existingManagementBookingId')");
    expect(residueScript).not.toContain("pm.environment.get('existingBookingId')");
  });

  test('known-conflict skip paths require allowlisted backend messages instead of generic 400/404 failures', () => {
    const approveScript = getExec('Approve Booking - New').join('\n');
    const newCheckInScript = getExec('Check In - WFA New Booking').join('\n');
    const unapprovedScript = getExec('Check In - WFA Unapproved Booking').join('\n');

    expect(approveScript).toContain('pm.expect(knownConflictMessages).to.include(body.message)');
    expect(newCheckInScript).toContain('pm.expect(knownConflictMessages).to.include(body.message)');
    expect(unapprovedScript).toContain('pm.expect(knownConflictMessages).to.include(body.message)');

    expect(approveScript).not.toContain("pm.expect([404, 400]).to.include(pm.response.code);");
    expect(newCheckInScript).not.toContain("pm.expect([400, 404]).to.include(pm.response.code);");
    expect(unapprovedScript).not.toContain("pm.expect([400, 404]).to.include(pm.response.code);");
  });

  test('create booking known-conflict detection accepts validator aggregate payloads without cascading downstream', () => {
    const script = getExec('Create Booking - New').join('\n');

    expect(script).toContain("const knownConflictByErrors = Array.isArray(body.errors)");
    expect(script).toContain("knownConflictMessages.includes(error && error.message)");
    expect(script).toContain("const knownConflict = pm.response.code === 409");
    expect(script).toContain("pm.execution.setNextRequest('Check In - Missing category_id');");
  });

  test('approved future-dated WFA booking does not cascade into same-day attendance requests', () => {
    const approveScript = getExec('Approve Booking - New').join('\n');
    const checkOutPreRequestScript = getPreRequestExec('Check Out - WFA New Booking').join('\n');

    expect(approveScript).toContain("pm.test('new booking approval contract is strict', () => {");
    expect(approveScript).toContain("pm.expect(body.data.status).to.eql('approved');");
    expect(approveScript).toContain(
      "  pm.test('new booking approval contract is strict', () => {\n" +
        "    pm.expect(body.success).to.eql(true);\n" +
        "    pm.expect(body.message).to.eql('Booking berhasil di-approved.');\n" +
        "    pm.expect(body.data.booking_id).to.eql(Number(pm.environment.get('newBookingId')));\n" +
        "    pm.expect(body.data.status).to.eql('approved');\n" +
        "  });\n" +
        "  pm.execution.setNextRequest('Check In - Missing category_id');\n" +
        "}"
    );
    expect(approveScript).not.toContain("pm.execution.setNextRequest('Check In - WFA New Booking');");

    expect(checkOutPreRequestScript).toContain("if (!pm.environment.get('newAttendanceId')) {");
    expect(checkOutPreRequestScript).toContain('pm.execution.skipRequest();');
  });

  test('unapproved WFA seed conflict detection accepts validator aggregate payloads and skips the dependent malformed request branch', () => {
    const script = getExec('Create Booking - Unapproved WFA Negative Seed').join('\n');

    expect(script).toContain("const knownPendingSeedConflictByErrors = Array.isArray(body.errors)");
    expect(script).toContain("knownPendingSeedConflictMessages.includes(error && error.message)");
    expect(script).toContain("const knownPendingSeedConflict = pm.response.code === 409");
    expect(script).toContain("pm.execution.setNextRequest('Check In - WFA Wrong User Booking');");
  });

  test('existing approved booking seed conflict handling stays narrow and does not let the approval branch crash on an empty fixture id', () => {
    const createScript = getExec('Create Booking - Existing Seed').join('\n');
    const approveScript = getExec('Approve Booking - Existing Seed').join('\n');

    expect(createScript).toContain("pm.environment.set('existingManagementBookingSkipReason', '');");
    expect(createScript).toContain("const knownExistingSeedConflictByErrors = Array.isArray(body.errors)");
    expect(createScript).toContain("knownExistingSeedConflictMessages.includes(error && error.message)");
    expect(createScript).toContain("const knownExistingSeedConflict = pm.response.code === 409");
    expect(createScript).toContain("pm.environment.set('existingManagementBookingId', '');");
    expect(createScript).toContain("pm.environment.set('existingManagementBookingSkipReason', 'known-conflict');");
    expect(createScript).not.toContain("pm.execution.setNextRequest('Create Booking - New');");

    expect(approveScript).toContain("const hasExistingSeedBooking = Boolean(pm.environment.get('existingManagementBookingId'));");
    expect(approveScript).toContain("const expectedKnownConflictSkip = pm.environment.get('existingManagementBookingSkipReason') === 'known-conflict';");
    expect(approveScript).toContain("if (!hasExistingSeedBooking && expectedKnownConflictSkip) {");
    expect(approveScript).toContain("pm.test('existing seed booking approval is skipped only after a known existing-seed conflict', () => {");
    expect(approveScript).toContain("pm.expect(pm.response.code).to.eql(404);");
    expect(approveScript).not.toContain("const body = pm.response.json();\npm.test('existing seed booking approval is skipped only after a known existing-seed conflict'");
  });

  test('WFA negative check-in branches allow the exact live time-window blocker without falling back to generic 400 handling', () => {
    const missingBookingScript = getExec('Check In - WFA without booking_id (Management clean identity)').join('\n');
    const invalidBookingScript = getExec('Check In - WFA Invalid Booking ID').join('\n');
    const wrongUserScript = getExec('Check In - WFA Wrong User Booking').join('\n');

    expect(missingBookingScript).toContain("const allowedMessages = ['Booking ID wajib untuk WFA.', 'Check-in hanya bisa dilakukan pada jam 07:00 - 22:00.'];");
    expect(invalidBookingScript).toContain("const allowedMessages = ['Booking tidak ditemukan.', 'Check-in hanya bisa dilakukan pada jam 07:00 - 22:00.'];");
    expect(wrongUserScript).toContain("const hasExistingSeedBooking = Boolean(pm.environment.get('existingManagementBookingId'));");
    expect(wrongUserScript).toContain("const expectedExistingSeedConflictSkip = pm.environment.get('existingManagementBookingSkipReason') === 'known-conflict';");
    expect(wrongUserScript).toContain("pm.test('WFA wrong-user booking negative is skipped only after a known existing-seed conflict', () => {");
    expect(wrongUserScript).toContain("const allowedMessages = ['Booking tidak valid untuk user ini.', 'Check-in hanya bisa dilakukan pada jam 07:00 - 22:00.'];");

    expect(missingBookingScript).not.toContain("pm.expect([400, 404]).to.include(pm.response.code);");
    expect(invalidBookingScript).not.toContain("pm.expect([400, 404]).to.include(pm.response.code);");
    expect(wrongUserScript).not.toContain("pm.expect([400, 404]).to.include(pm.response.code);");
    expect(wrongUserScript).toContain("pm.expect(body.message).to.eql('Booking ID harus berupa angka positif');");
  });

  test('WFA checkout success messages align with backend runtime without a trailing period', () => {
    const existingScript = getExec('Check Out - WFA Existing Booking').join('\n');
    const newScript = getExec('Check Out - WFA New Booking').join('\n');

    expect(existingScript).toContain("pm.expect(body.message).to.eql('Check-out berhasil');");
    expect(newScript).toContain("pm.expect(body.message).to.eql('Check-out berhasil');");
    expect(existingScript).not.toContain("pm.expect(body.message).to.eql('Check-out berhasil.');");
    expect(newScript).not.toContain("pm.expect(body.message).to.eql('Check-out berhasil.');");
  });

  test('status-today readiness checks keep is_holiday strict while holiday-blocked paths still execute check-in assertions', () => {
    const wfoScript = getExec('Status Today - Employee (WFO seed)').join('\n');
    const wfhScript = getExec('Status Today - Internship (WFH seed)').join('\n');
    const wfoCheckInScript = getExec('Check In - Employee WFO').join('\n');
    const wfhCheckInScript = getExec('Check In - Internship WFH').join('\n');

    expect(wfoScript).toContain("pm.expect(body.data.is_holiday).to.be.a('boolean');");
    expect(wfhScript).toContain("pm.expect(body.data.is_holiday).to.be.a('boolean');");
    expect(wfoScript).toContain("Boolean(body.data.is_holiday && body.data.is_holiday.length)");
    expect(wfhScript).toContain("Boolean(body.data.is_holiday && body.data.is_holiday.length)");

    expect(wfoScript).not.toContain("Array.isArray(body.data.is_holiday)");
    expect(wfhScript).not.toContain("Array.isArray(body.data.is_holiday)");
    expect(wfoScript).not.toContain("pm.execution.setNextRequest('Status Today - Internship (WFH seed)');");
    expect(wfhScript).not.toContain("pm.execution.setNextRequest('Status Today - Management before WFA Existing Booking');");

    expect(wfoCheckInScript).toContain("pm.test('WFO holiday skip keeps the live readiness contract strict', () => {");
    expect(wfhCheckInScript).toContain("pm.test('WFH holiday skip keeps the live readiness contract strict', () => {");
  });

  test('cleanup requests still target concrete fixture ids instead of relying on empty-id delete calls as normal control flow', () => {
    const existingAttendanceCleanupUrl = getRawUrl('Delete Attendance - WFA Existing Fixture Cleanup');
    const newAttendanceCleanupUrl = getRawUrl('Delete Attendance - WFA New Fixture Cleanup');
    const newBookingCleanupUrl = getRawUrl('Delete Booking - New');
    const existingBookingCleanupUrl = getRawUrl('Delete Booking - Existing Seed');
    const unapprovedBookingCleanupUrl = getRawUrl('Delete Booking - Unapproved Negative Seed');
    const existingPreflightScript = getExec('Status Today - Management before WFA Existing Booking').join('\n');
    const newHappyPathScript = getExec('Check Out - WFA New Booking').join('\n');
    const existingAttendanceCleanupPreRequest = getPreRequestExec('Delete Attendance - WFA Existing Fixture Cleanup').join('\n');
    const newAttendanceCleanupPreRequest = getPreRequestExec('Delete Attendance - WFA New Fixture Cleanup').join('\n');
    const existingBookingCleanupPreRequest = getPreRequestExec('Delete Booking - Existing Seed').join('\n');
    const newBookingCleanupPreRequest = getPreRequestExec('Delete Booking - New').join('\n');
    const unapprovedBookingCleanupPreRequest = getPreRequestExec('Delete Booking - Unapproved Negative Seed').join('\n');
    const existingBookingCleanupScript = getExec('Delete Booking - Existing Seed').join('\n');
    const newBookingCleanupScript = getExec('Delete Booking - New').join('\n');
    const unapprovedBookingCleanupScript = getExec('Delete Booking - Unapproved Negative Seed').join('\n');

    expect(existingAttendanceCleanupUrl).toContain('{{existingAttendanceId}}');
    expect(newAttendanceCleanupUrl).toContain('{{newAttendanceId}}');
    expect(newBookingCleanupUrl).toContain('{{newBookingId}}');
    expect(existingBookingCleanupUrl).toContain('{{existingManagementBookingId}}');
    expect(unapprovedBookingCleanupUrl).toContain('{{unapprovedBookingId}}');

    expect(existingPreflightScript).toContain("if (!pm.environment.get('existingManagementBookingId')) {");
    expect(existingPreflightScript).toContain("pm.environment.set('existingAttendanceId', '');");
    expect(existingPreflightScript).toContain("pm.execution.setNextRequest('Create Booking - New');");

    expect(newHappyPathScript).not.toContain("pm.execution.setNextRequest('Delete Attendance - WFA New Fixture Cleanup');");

    expect(existingAttendanceCleanupPreRequest).toContain("if (!pm.environment.get('existingAttendanceId')) {");
    expect(existingAttendanceCleanupPreRequest).toContain("pm.execution.skipRequest();");
    expect(newAttendanceCleanupPreRequest).toContain("if (!pm.environment.get('newAttendanceId')) {");
    expect(newAttendanceCleanupPreRequest).toContain("pm.execution.skipRequest();");
    expect(existingBookingCleanupPreRequest).toContain("if (!pm.environment.get('existingManagementBookingId')) {");
    expect(existingBookingCleanupPreRequest).toContain("pm.execution.skipRequest();");
    expect(newBookingCleanupPreRequest).toContain("if (!pm.environment.get('newBookingId')) {");
    expect(newBookingCleanupPreRequest).toContain("pm.execution.skipRequest();");
    expect(unapprovedBookingCleanupPreRequest).toContain("if (!pm.environment.get('unapprovedBookingId')) {");
    expect(unapprovedBookingCleanupPreRequest).toContain("pm.execution.skipRequest();");

    expect(existingBookingCleanupScript).toContain("pm.expect([200, 404, 409]).to.include(pm.response.code)");
    expect(newBookingCleanupScript).toContain("pm.expect([200, 404, 409]).to.include(pm.response.code)");
    expect(unapprovedBookingCleanupScript).toContain("pm.expect([200, 404, 409]).to.include(pm.response.code)");
  });
});
