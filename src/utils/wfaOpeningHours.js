import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

class UtcCalendarDate extends Date {
  constructor(...args) {
    if (args.length >= 2) {
      const [year, month, day = 1, hours = 0, minutes = 0, seconds = 0, milliseconds = 0] = args;
      super(Date.UTC(year, month, day, hours, minutes, seconds, milliseconds));
      return;
    }

    super(...args);
  }

  getFullYear() {
    return super.getUTCFullYear();
  }

  getMonth() {
    return super.getUTCMonth();
  }

  getDate() {
    return super.getUTCDate();
  }

  getDay() {
    return super.getUTCDay();
  }

  getHours() {
    return super.getUTCHours();
  }

  getMinutes() {
    return super.getUTCMinutes();
  }

  getSeconds() {
    return super.getUTCSeconds();
  }

  getTimezoneOffset() {
    return 0;
  }

  setDate(...args) {
    return super.setUTCDate(...args);
  }

  setHours(...args) {
    return super.setUTCHours(...args);
  }
}

const loadUtcCalendarOpeningHours = () => {
  const requireFromHere = createRequire(import.meta.url);
  const entryPath = requireFromHere.resolve('opening_hours');
  const moduleRecord = { exports: {} };

  runInNewContext(
    readFileSync(entryPath, 'utf8'),
    {
      Date: UtcCalendarDate,
      console,
      exports: moduleRecord.exports,
      module: moduleRecord,
      require: requireFromHere
    },
    { filename: entryPath }
  );

  return moduleRecord.exports;
};

const OpeningHours = loadUtcCalendarOpeningHours();

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/;

const parseWibCivilDate = (date) => {
  const dateMatch = typeof date === 'string' ? date.match(DATE_PATTERN) : null;
  if (!dateMatch) return null;

  const [year, month, day] = dateMatch.slice(1).map(Number);
  const validator = new Date(Date.UTC(year, month - 1, day));
  if (
    validator.getUTCFullYear() !== year ||
    validator.getUTCMonth() !== month - 1 ||
    validator.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
};

const parseTime = (time) => {
  const timeMatch = typeof time === 'string' ? time.match(TIME_PATTERN) : null;
  return timeMatch ? timeMatch.slice(1).map(Number) : null;
};

const addCivilDays = ({ year, month, day }, days) => {
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: result.getUTCFullYear(),
    month: result.getUTCMonth() + 1,
    day: result.getUTCDate()
  };
};

const buildUtcCalendarDate = (civilDate, time) => {
  const timeParts = parseTime(time);
  if (!civilDate || !timeParts) return new Date(Number.NaN);

  const { year, month, day } = civilDate;
  const [hours, minutes, seconds] = timeParts;
  const result = new UtcCalendarDate(year, month - 1, day, hours, minutes, seconds);

  if (
    result.getFullYear() !== year ||
    result.getMonth() !== month - 1 ||
    result.getDate() !== day ||
    result.getHours() !== hours ||
    result.getMinutes() !== minutes ||
    result.getSeconds() !== seconds
  ) {
    return new Date(Number.NaN);
  }

  return result;
};

const buildWindow = (civilDate, startTime, endTime) => {
  const start = buildUtcCalendarDate(civilDate, startTime);
  const end = buildUtcCalendarDate(civilDate, endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  if (end <= start) {
    const nextDate = addCivilDays(civilDate, 1);
    const overnightEnd = buildUtcCalendarDate(nextDate, endTime);
    if (Number.isNaN(overnightEnd.getTime())) return null;
    return { start, end: overnightEnd };
  }

  return { start, end };
};

const mergeContiguousIntervals = (intervals) => {
  return intervals
    .filter(([from, to]) => from instanceof Date && to instanceof Date)
    .sort(([leftFrom], [rightFrom]) => leftFrom - rightFrom)
    .reduce((merged, [from, to]) => {
      const previous = merged.at(-1);

      if (previous && previous[1].getTime() === from.getTime()) {
        previous[1] = to;
      } else {
        merged.push([from, to]);
      }

      return merged;
    }, []);
};

export const evaluateOpeningHoursCoverage = ({ expression, scheduleDate, startTime, endTime }) => {
  if (typeof expression !== 'string' || expression.trim() === '') return null;

  try {
    const civilDate = parseWibCivilDate(scheduleDate);
    const openingHours = new OpeningHours(expression);
    if (!civilDate) return null;

    // The isolated parser uses UTC-backed calendar methods. Its dates therefore
    // represent WIB civil values exactly without inheriting host DST behavior.
    const window = buildWindow(civilDate, startTime, endTime);
    if (!window) return null;

    const { start, end } = window;
    const intervals = openingHours.getOpenIntervals(start, end);
    const hasUnknownCoverage = intervals.some(
      ([from, to, unknown]) => unknown === true && from < end && to > start
    );
    if (hasUnknownCoverage) return null;

    const mergedIntervals = mergeContiguousIntervals(intervals.filter(([, , unknown]) => unknown !== true));

    return mergedIntervals.some(([from, to]) => from <= start && to >= end) ? 1 : 0;
  } catch (_error) {
    return null;
  }
};
