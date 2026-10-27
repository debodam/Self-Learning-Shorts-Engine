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

/** The UTC moment it's noon in New York on a date, across daylight saving changes. */
export function noonEastern(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  // Noon Eastern is 16:00 UTC in daylight time and 17:00 UTC in standard time.
  for (const utcHour of [POST_HOUR + 4, POST_HOUR + 5]) {
    const at = new Date(Date.UTC(y, m - 1, d, utcHour));
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", hourCycle: "h23" }).format(at));
    if (hour === POST_HOUR) return at;
  }
  throw new Error(`Couldn't find noon Eastern on ${date}`);
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
