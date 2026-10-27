// Posting-time math for the weekly schedule, shared by the preview (browser) and the
// server so both compute the same dates. All dates are "YYYY-MM-DD" in New York.

const TIME_ZONE = "America/New_York";
const POST_HOUR = 12;

/** "YYYY-MM-DD" for a moment, in New York. */
export function easternDate(at: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** The date n days after a "YYYY-MM-DD" date. */
export function addDays(date: string, n: number) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The default posting time, "HH:MM" in New York. */
export const DEFAULT_POST_TIME = `${String(POST_HOUR).padStart(2, "0")}:00`;

/** "HH:MM" (24 hour) for a moment, in New York. */
export function easternTime(at: Date) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}

/**
 * The UTC moment for a New York date and "HH:MM" time, across daylight saving changes.
 * Null for a time that doesn't exist that day (the hour skipped when clocks spring forward).
 */
export function easternToUtc(date: string, time: string): Date | null {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  if ([y, m, d, hh, mm].some((n) => !Number.isFinite(n))) return null;
  // New York is 4 hours behind UTC in daylight time and 5 in standard time.
  for (const offset of [4, 5]) {
    const at = new Date(Date.UTC(y, m - 1, d, hh + offset, mm));
    if (easternDate(at) === date && easternTime(at) === time) return at;
  }
  return null;
}

/** The UTC moment it's noon in New York on a date. */
export function noonEastern(date: string) {
  const at = easternToUtc(date, DEFAULT_POST_TIME);
  if (!at) throw new Error(`Couldn't find noon Eastern on ${date}`);
  return at;
}

/** The user's local zone, shown next to Eastern times. */
export const LOCAL_TIME_ZONE = "America/Denver";

/** e.g. "10:00 AM MT" for a moment, in the user's local (Mountain) time. */
export function localTimeLabel(at: Date) {
  const time = new Intl.DateTimeFormat("en-US", { timeZone: LOCAL_TIME_ZONE, hour: "numeric", minute: "2-digit" }).format(at);
  const sameDay = easternDate(at) === new Intl.DateTimeFormat("en-CA", { timeZone: LOCAL_TIME_ZONE }).format(at);
  const day = sameDay ? "" : ` ${new Intl.DateTimeFormat("en-US", { timeZone: LOCAL_TIME_ZONE, weekday: "short" }).format(at)}`;
  return `${time}${day} MT`;
}

/** The first Sunday strictly after a date. */
export function nextSundayAfter(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(date, day === 0 ? 7 : 7 - day);
}

/** Tomorrow in New York: the earliest day a week can start. */
export function tomorrowEastern(now = new Date()) {
  return addDays(easternDate(now), 1);
}

/**
 * Default start for a new schedule: the next Sunday after the last scheduled post, or
 * after today when nothing is scheduled.
 */
export function defaultStartDate(bookedDates: string[], now = new Date()) {
  const last = [...bookedDates].sort().at(-1);
  const base = last && last > easternDate(now) ? last : easternDate(now);
  return nextSundayAfter(base);
}

/** One noon-Eastern slot per day from startDate, skipping days that already have a post. */
export function slotsFrom(startDate: string, count: number, bookedDates: Iterable<string>) {
  const booked = new Set(bookedDates);
  const slots: Date[] = [];
  for (let date = startDate; slots.length < count; date = addDays(date, 1)) {
    if (!booked.has(date)) slots.push(noonEastern(date));
  }
  return slots;
}
