import OpeningHours from 'opening_hours';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/;

const buildWibWallClock = (date, time) => {
  const dateMatch = typeof date === 'string' ? date.match(DATE_PATTERN) : null;
  const timeMatch = typeof time === 'string' ? time.match(TIME_PATTERN) : null;

  if (!dateMatch || !timeMatch) return new Date(Number.NaN);

  const [year, month, day] = dateMatch.slice(1).map(Number);
  const [hours, minutes, seconds] = timeMatch.slice(1).map(Number);
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
    const start = buildWibWallClock(scheduleDate, startTime);
    const end = buildWibWallClock(scheduleDate, endTime);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    if (end <= start) end.setDate(end.getDate() + 1);

    const intervals = new OpeningHours(expression).getOpenIntervals(start, end);
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
