const previousTimezone = process.env.TZ;
process.env.TZ = 'Asia/Jakarta';

const { evaluateOpeningHoursCoverage } = await import('../src/utils/wfaOpeningHours.js');

afterAll(() => {
  if (previousTimezone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = previousTimezone;
  }
});

test.each([
  ['Mo-Su 07:00-18:00', 1],
  ['Mo-Su 09:00-18:00', 0],
  ['Mo-Su 07:00-16:00', 0],
  ['Mo-Su 07:00-10:00,11:00-18:00', 0],
  [null, null],
  ['not-valid-opening-hours', null]
])('evaluates full configured window for %p', (expression, expected) => {
  expect(
    evaluateOpeningHoursCoverage({
      expression,
      scheduleDate: '2026-08-03',
      startTime: '08:00:00',
      endTime: '17:00:00'
    })
  ).toBe(expected);
});

test('evaluates an overnight configured window against the Monday opening interval', () => {
  expect(
    evaluateOpeningHoursCoverage({
      expression: 'Mo 20:00-02:00',
      scheduleDate: '2026-08-03',
      startTime: '21:00:00',
      endTime: '01:00:00'
    })
  ).toBe(1);
});
