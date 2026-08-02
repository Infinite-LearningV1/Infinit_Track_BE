import { execFileSync } from 'node:child_process';

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

test('keeps parser-unknown opening intervals unknown instead of open', () => {
  expect(
    evaluateOpeningHoursCoverage({
      expression: 'Mo 08:00-17:00 unknown',
      scheduleDate: '2026-08-03',
      startTime: '08:00:00',
      endTime: '17:00:00'
    })
  ).toBeNull();
});

test('evaluates the WIB Sunday window correctly in a process initialized with a DST timezone', () => {
  const evaluatorUrl = new URL('../src/utils/wfaOpeningHours.js', import.meta.url).href;
  const script = `
    import { evaluateOpeningHoursCoverage } from ${JSON.stringify(evaluatorUrl)};
    console.log(evaluateOpeningHoursCoverage({
      expression: 'Su 08:00-17:00',
      scheduleDate: '2026-11-01',
      startTime: '08:00:00',
      endTime: '17:00:00'
    }));
  `;

  const output = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, TZ: 'America/New_York' }
  });

  expect(output.trim()).toBe('1');
});

test('evaluates a WIB spring-forward-gap window in a process initialized with a DST timezone', () => {
  const evaluatorUrl = new URL('../src/utils/wfaOpeningHours.js', import.meta.url).href;
  const script = `
    import { evaluateOpeningHoursCoverage } from ${JSON.stringify(evaluatorUrl)};
    console.log(evaluateOpeningHoursCoverage({
      expression: 'Su 00:00-24:00',
      scheduleDate: '2026-03-08',
      startTime: '02:30:00',
      endTime: '03:30:00'
    }));
  `;

  const output = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, TZ: 'America/New_York' }
  });

  expect(output.trim()).toBe('1');
});
