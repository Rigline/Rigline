/** A log line's time as a person reads it: local, with its offset. */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** `2026-09-28 09:56:52.334 +10:00`, for `ms` in a zone `offsetMinutes` east of UTC. */
export function localTimeAt(ms: number, offsetMinutes: number): string {
  const shifted = new Date(ms + offsetMinutes * 60_000).toISOString();
  const abs = Math.abs(offsetMinutes);
  const offset = `${offsetMinutes < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return `${shifted.slice(0, 10)} ${shifted.slice(11, 23)} ${offset}`;
}

export function localTime(at: Date = new Date()): string {
  return localTimeAt(at.getTime(), -at.getTimezoneOffset());
}
