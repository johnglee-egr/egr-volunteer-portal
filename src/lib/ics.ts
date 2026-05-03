/**
 * Minimal ICS (iCalendar) generator for volunteer shift calendar events.
 * No external dependencies — pure string formatting.
 * Compliant with RFC 5545: CRLF line endings, 75-octet line folding, trailing CRLF.
 */

import { fmt12 } from "./formatters";

function padTwo(n: number) {
  return String(n).padStart(2, "0");
}

function toICSDateTime(date: Date): string {
  // UTC format: YYYYMMDDTHHMMSSZ
  return (
    date.getUTCFullYear() +
    padTwo(date.getUTCMonth() + 1) +
    padTwo(date.getUTCDate()) +
    "T" +
    padTwo(date.getUTCHours()) +
    padTwo(date.getUTCMinutes()) +
    "00Z"
  );
}

/** Escape special characters per RFC 5545 §3.3.11 */
function esc(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/**
 * Fold long content lines per RFC 5545 §3.1.
 * Lines longer than 75 octets must be split with CRLF + a single space.
 */
function foldLine(line: string): string {
  const LIMIT = 75;
  if (line.length <= LIMIT) return line;
  const parts: string[] = [];
  let pos = 0;
  while (pos < line.length) {
    if (pos === 0) {
      parts.push(line.slice(0, LIMIT));
      pos = LIMIT;
    } else {
      // Continuation lines: 1 char indent + 74 chars of content
      parts.push(" " + line.slice(pos, pos + 74));
      pos += 74;
    }
  }
  return parts.join("\r\n");
}

export interface ICSEvent {
  uid: string;
  summary: string;
  description: string;
  location?: string;
  dtStart: Date;
  dtEnd: Date;
}

export function generateICS(event: ICSEvent): string {
  const now = toICSDateTime(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//EGR Harvest + Beer Festival//Volunteer Portal//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${toICSDateTime(event.dtStart)}`,
    `DTEND:${toICSDateTime(event.dtEnd)}`,
    `SUMMARY:${esc(event.summary)}`,
    `DESCRIPTION:${esc(event.description)}`,
    ...(event.location ? [`LOCATION:${esc(event.location)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  // RFC 5545 §3.1: each line terminated by CRLF, including the last
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/**
 * Build an ICSEvent from a volunteer assignment's shift data.
 * shift.date is stored as UTC-midnight in Postgres; startTime/endTime are "HH:MM" strings.
 */
export function buildShiftEvent(
  assignmentId: string,
  shift: { title: string; date: Date; startTime: string; endTime: string },
  volunteerName: string,
  portalUrl: string
): ICSEvent {
  const [startH, startM] = shift.startTime.split(":").map(Number);
  const [endH, endM] = shift.endTime.split(":").map(Number);

  const dtStart = new Date(
    Date.UTC(
      shift.date.getUTCFullYear(), shift.date.getUTCMonth(), shift.date.getUTCDate(),
      startH, startM, 0, 0
    )
  );
  let dtEnd = new Date(
    Date.UTC(
      shift.date.getUTCFullYear(), shift.date.getUTCMonth(), shift.date.getUTCDate(),
      endH, endM, 0, 0
    )
  );

  // Handle overnight shifts: if end <= start, the shift crosses midnight
  if (dtEnd <= dtStart) {
    dtEnd = new Date(dtEnd.getTime() + 86_400_000); // add one day
  }

  const dateStr = new Date(
    Date.UTC(shift.date.getUTCFullYear(), shift.date.getUTCMonth(), shift.date.getUTCDate())
  ).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
    timeZone: "UTC",
  });

  const description = [
    `Hi ${volunteerName}!`,
    "",
    `You're volunteering for: ${shift.title}`,
    `Date: ${dateStr}`,
    `Time: ${fmt12(shift.startTime)} – ${fmt12(shift.endTime)}`,
    "",
    `See your full schedule: ${portalUrl}`,
  ].join("\n");

  return {
    uid: `volunteer-shift-${assignmentId}@egrharvestfest.com`,
    summary: `Volunteer: ${shift.title} — EGR Harvest + Beer Festival`,
    description,
    location: "East Grand Rapids, MI",
    dtStart,
    dtEnd,
  };
}

/**
 * Build a "Add to Google Calendar" URL for a shift event.
 */
export function buildGoogleCalendarUrl(event: ICSEvent): string {
  // Remove fractional seconds from ISO string for Google Calendar compatibility
  const fmt = (d: Date) =>
    d.toISOString().replace(/\.\d+Z$/, "Z").replace(/[-:]/g, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.summary,
    dates: `${fmt(event.dtStart)}/${fmt(event.dtEnd)}`,
    details: event.description,
    ...(event.location ? { location: event.location } : {}),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
