// ── Shared formatting utilities ───────────────────────────────────────────────

/** Format a 24h "HH:MM" string to "h:MM AM/PM" */
export function fmt12(t: string): string {
  if (!t) return "";
  const [hStr, mStr] = t.split(":");
  let h = parseInt(hStr);
  const m = mStr || "00";
  const ampm = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m} ${ampm}`;
}

/** Auto-format a phone input as xxx-xxx-xxxx while typing */
export function fmtPhoneInput(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Format a stored phone string as (xxx) xxx-xxxx for display */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const d = digits.startsWith("1") && digits.length === 11 ? digits.slice(1) : digits;
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return phone;
}

/** Normalize a phone number to (xxx) xxx-xxxx for storage, or return as-is if unrecognized */
export function normalizePhone(phone: string): string {
  return formatPhone(phone);
}

/** Strip all non-digit characters — use for format-agnostic phone comparison */
export function phoneDigits(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return d.startsWith("1") && d.length === 11 ? d.slice(1) : d;
}

/**
 * Format a shift/festival date for display.
 *
 * Dates are stored as UTC midnight (e.g. 2026-10-10T00:00:00.000Z) because they
 * represent a calendar day, not an instant. Rendering that with the browser's
 * local timezone shifts it backwards in every timezone west of UTC — a Saturday
 * Oct 10 festival displayed as "Friday, October 9" to US volunteers. Forcing
 * UTC keeps the calendar day intact everywhere.
 */
export function fmtShiftDate(
  date: string | Date,
  opts: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric" }
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}
