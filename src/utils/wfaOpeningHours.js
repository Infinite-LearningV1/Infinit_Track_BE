import OpeningHours from 'opening_hours';

const WIB_OFFSET = '+07:00';
const DAY_MS = 24 * 60 * 60 * 1000;

const buildInstant = (date, time) => new Date(`${date}T${time}${WIB_OFFSET}`);

const toWibWallClock = (date) => new Date(date.getTime() + (date.getTimezoneOffset() + 7 * 60) * 60 * 1000);

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
    const start = buildInstant(scheduleDate, startTime);
    let end = buildInstant(scheduleDate, endTime);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    if (end <= start) end = new Date(end.getTime() + DAY_MS);

    const parserStart = toWibWallClock(start);
    const parserEnd = toWibWallClock(end);
    const intervals = new OpeningHours(expression).getOpenIntervals(parserStart, parserEnd);
    const mergedIntervals = mergeContiguousIntervals(intervals);

    return mergedIntervals.some(([from, to]) => from <= parserStart && to >= parserEnd) ? 1 : 0;
  } catch (_error) {
    return null;
  }
};
