import OpeningHours from 'opening_hours';

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

const buildHostLocalDate = (civilDate, time) => {
  const timeParts = parseTime(time);
  if (!civilDate || !timeParts) return new Date(Number.NaN);

  const { year, month, day } = civilDate;
  const [hours, minutes, seconds] = timeParts;
  const result = new Date(year, month - 1, day, hours, minutes, seconds);

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
  const start = buildHostLocalDate(civilDate, startTime);
  const end = buildHostLocalDate(civilDate, endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  if (end <= start) {
    const nextDate = addCivilDays(civilDate, 1);
    const overnightEnd = buildHostLocalDate(nextDate, endTime);
    if (Number.isNaN(overnightEnd.getTime())) return null;
    return { start, end: overnightEnd };
  }

  return { start, end };
};

const isTransitionFreeHostDay = (civilDate) => {
  const midnight = buildHostLocalDate(civilDate, '00:00:00');
  const nextMidnight = buildHostLocalDate(addCivilDays(civilDate, 1), '00:00:00');
  return midnight.getTimezoneOffset() === nextMidnight.getTimezoneOffset();
};

const findWeekStableProxyWindow = ({ civilDate, startTime, endTime }) => {
  for (let weeks = 0; weeks <= 53; weeks += 1) {
    for (const direction of weeks === 0 ? [0] : [1, -1]) {
      const candidate = addCivilDays(civilDate, direction * weeks * 7);
      const window = buildWindow(candidate, startTime, endTime);
      const endDate = addCivilDays(candidate, endTime <= startTime ? 1 : 0);

      if (
        window &&
        isTransitionFreeHostDay(candidate) &&
        isTransitionFreeHostDay(endDate)
      ) {
        return window;
      }
    }
  }

  return null;
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
    if (!civilDate || !openingHours.isWeekStable()) return null;

    // opening_hours has no timezone override. A transition-free same-weekday
    // proxy keeps the WIB civil schedule intact without host DST gaps/overlaps.
    const window = findWeekStableProxyWindow({ civilDate, startTime, endTime });
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
