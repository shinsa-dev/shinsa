import { describe, expect, it } from 'bun:test';
import {
  formatAge,
  formatClock,
  formatDay,
  formatDuration,
  formatMoment,
  formatSince,
  formatSpan,
  formatTimeAgo,
  formatUntil,
  resolveEndOfDay,
  resolveMinute,
} from '@/lib/format/time.ts';

const NOW = Date.UTC(2026, 9, 22, 14, 0);
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const LONG_AGO = Date.UTC(2026, 9, 1, 12, 0);

describe('formatAge', () => {
  it('says just now for the first 45 seconds and for times in the future', () => {
    expect(formatAge(NOW, NOW)).toBe('just now');
    expect(formatAge(NOW - 44 * SECOND, NOW)).toBe('just now');
    expect(formatAge(NOW + 5 * MINUTE, NOW)).toBe('just now');
  });

  it('counts minutes, hours and days in their short form', () => {
    expect(formatAge(NOW - 45 * SECOND, NOW)).toBe('1m');
    expect(formatAge(NOW - 59 * MINUTE, NOW)).toBe('59m');
    expect(formatAge(NOW - 60 * MINUTE, NOW)).toBe('1h');
    expect(formatAge(NOW - 23 * HOUR, NOW)).toBe('23h');
    expect(formatAge(NOW - 24 * HOUR, NOW)).toBe('1d');
    expect(formatAge(NOW - 13 * DAY, NOW)).toBe('13d');
  });

  it('shows the date once two weeks have passed', () => {
    expect(formatAge(LONG_AGO, NOW)).toBe('Oct 1');
  });

  it('reads the clock when no now is given', () => {
    expect(formatAge(Date.now())).toBe('just now');
  });
});

describe('formatTimeAgo', () => {
  it('reads as a sentence start', () => {
    expect(formatTimeAgo(NOW, NOW)).toBe('Just now');
    expect(formatTimeAgo(NOW - 2 * HOUR, NOW)).toBe('2h ago');
    expect(formatTimeAgo(Date.now())).toBe('Just now');
  });

  it('shows an old date on its own, not as an age', () => {
    expect(formatTimeAgo(LONG_AGO, NOW)).toBe('Oct 1');
  });
});

describe('formatSince', () => {
  it('puts the age after the prefix in lower case', () => {
    expect(formatSince('Started', NOW, NOW)).toBe('Started just now');
    expect(formatSince('Opened', NOW - 5 * MINUTE, NOW)).toBe('Opened 5m ago');
    expect(formatSince('started', Date.now())).toBe('started just now');
  });

  it('keeps the month capitalised for an old date', () => {
    expect(formatSince('Added', LONG_AGO, NOW)).toBe('Added on Oct 1');
  });
});

describe('formatUntil', () => {
  it('counts down to a moment ahead in the same short form as an age', () => {
    expect(formatUntil('Resets', NOW + 3 * HOUR, NOW)).toBe('Resets in 3h');
    expect(formatUntil('Checks again', NOW + 12 * MINUTE, NOW)).toBe('Checks again in 12m');
    expect(formatUntil('Resets', NOW + 20 * SECOND, NOW)).toBe('Resets in under a minute');
    expect(formatUntil('Resets', Date.now())).toBe('Resets in under a minute');
  });

  it('names the date of the moment itself once it is two weeks away', () => {
    expect(formatUntil('Resets', NOW + 30 * DAY, NOW)).toBe('Resets on Nov 21');
  });
});

describe('formatMoment', () => {
  const noon = new Date(2026, 9, 22, 12, 0).getTime();

  it('reads the clock today, the weekday this week, and the date further out', () => {
    expect(formatMoment(new Date(2026, 9, 22, 15, 40).getTime(), noon)).toBe('3:40 PM');
    expect(formatMoment(new Date(2026, 9, 23, 9, 0).getTime(), noon)).toBe('Fri 9:00 AM');
    expect(formatMoment(new Date(2026, 9, 28, 9, 0).getTime(), noon)).toBe('Wed 9:00 AM');
    expect(formatMoment(new Date(2026, 9, 29, 9, 0).getTime(), noon)).toBe('Oct 29, 9:00 AM');
    expect(formatMoment(new Date(2026, 9, 21, 9, 0).getTime(), noon)).toBe('Oct 21, 9:00 AM');
    expect(formatMoment(Date.now() + 1000)).toMatch(/\d:\d{2} [AP]M$/);
  });
});

describe('formatDuration', () => {
  it('rounds to at least one second', () => {
    expect(formatDuration(0)).toBe('1s');
    expect(formatDuration(42 * SECOND)).toBe('42s');
  });

  it('switches to minutes and then hours with the remaining minutes', () => {
    expect(formatDuration(3 * MINUTE + 20 * SECOND)).toBe('3m');
    expect(formatDuration(2 * HOUR)).toBe('2h');
    expect(formatDuration(2 * HOUR + 5 * MINUTE)).toBe('2h 5m');
  });
});

describe('formatSpan', () => {
  it('is empty under a minute', () => {
    expect(formatSpan(NOW - 20 * SECOND, NOW)).toBeNull();
    expect(formatSpan(Date.now())).toBeNull();
  });

  it('spells out minutes, hours and days agreeing with their number', () => {
    expect(formatSpan(NOW - MINUTE, NOW)).toBe('1 minute');
    expect(formatSpan(NOW - 5 * MINUTE, NOW)).toBe('5 minutes');
    expect(formatSpan(NOW - HOUR, NOW)).toBe('1 hour');
    expect(formatSpan(NOW - 3 * HOUR, NOW)).toBe('3 hours');
    expect(formatSpan(NOW - DAY, NOW)).toBe('1 day');
    expect(formatSpan(NOW - 9 * DAY, NOW)).toBe('9 days');
  });
});

describe('exact moments', () => {
  it('formats the day with weekday and year, and the clock with hours and minutes', () => {
    const at = new Date(2026, 9, 22, 14, 14).getTime();
    expect(formatDay(at)).toBe('Thu, Oct 22, 2026');
    expect(formatClock(at)).toBe('2:14 PM');
  });

  it('counts whole minutes since the epoch', () => {
    expect(resolveMinute(NOW + 59 * SECOND)).toBe(NOW / MINUTE);
    expect(resolveMinute()).toBe(Math.floor(Date.now() / MINUTE));
  });

  it('ends the day at 23:59 local time', () => {
    const end = new Date(resolveEndOfDay(new Date(2026, 9, 22, 9, 30).getTime()));
    expect([end.getDate(), end.getHours(), end.getMinutes()]).toEqual([22, 23, 59]);
    expect(new Date(resolveEndOfDay()).getHours()).toBe(23);
  });
});
