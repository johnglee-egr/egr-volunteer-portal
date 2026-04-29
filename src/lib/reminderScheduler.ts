import { prisma } from "./db";
import { sendReminder } from "./notifications";

// How many minutes ahead of a shift to fire each reminder type.
// 24h = 1 day before, 2h = right before they need to leave home.
const WINDOW_24H_MIN = 24 * 60; // 1440
const WINDOW_2H_MIN = 2 * 60;   // 120

// Tolerance: each reminder fires when shift starts within [target - 60min, target]
const TOLERANCE_MIN = 60;

interface ProcessResult {
  scanned: number;
  sent24h: number;
  sent2h: number;
  errors: number;
}

/**
 * Scan all confirmed assignments for shifts coming up; send reminders for any
 * that hit the 24h or 2h windows and haven't been notified yet.
 * Idempotent — flips reminded24h / reminded2h once sent so reruns are no-ops.
 */
export async function processReminders(now: Date = new Date()): Promise<ProcessResult> {
  const result: ProcessResult = { scanned: 0, sent24h: 0, sent2h: 0, errors: 0 };

  // Pull confirmed assignments that still need at least one reminder
  const assignments = await prisma.assignment.findMany({
    where: {
      status: "confirmed",
      OR: [{ reminded24h: false }, { reminded2h: false }],
    },
    include: { volunteer: true, shift: true },
  });

  for (const a of assignments) {
    result.scanned++;
    const minutesUntil = minutesUntilShift(a.shift.date, a.shift.startTime, now);
    if (minutesUntil === null) continue;
    if (minutesUntil < -TOLERANCE_MIN) continue; // shift is well in the past

    // 24h reminder window: shift starts in [WINDOW_24H_MIN - TOLERANCE, WINDOW_24H_MIN]
    if (
      !a.reminded24h &&
      minutesUntil <= WINDOW_24H_MIN &&
      minutesUntil > WINDOW_2H_MIN // don't double-fire if they're closer than 2h
    ) {
      try {
        await sendReminder(a.volunteer, a.shift);
        await prisma.assignment.update({ where: { id: a.id }, data: { reminded24h: true } });
        result.sent24h++;
      } catch (e) {
        console.error("[reminder 24h] failed", e);
        result.errors++;
      }
      continue;
    }

    // 2h reminder
    if (
      !a.reminded2h &&
      minutesUntil <= WINDOW_2H_MIN &&
      minutesUntil >= -TOLERANCE_MIN
    ) {
      try {
        await sendReminder(a.volunteer, a.shift);
        // mark both — if 24h was missed we count the 2h as the only one
        await prisma.assignment.update({
          where: { id: a.id },
          data: { reminded2h: true, reminded24h: true },
        });
        result.sent2h++;
      } catch (e) {
        console.error("[reminder 2h] failed", e);
        result.errors++;
      }
    }
  }

  return result;
}

function minutesUntilShift(date: Date, startTime: string, now: Date): number | null {
  // shift.date is a Date stored as midnight local; startTime is "HH:MM" 24h
  const [hStr, mStr] = startTime.split(":");
  const h = parseInt(hStr);
  const m = parseInt(mStr || "0");
  if (isNaN(h) || isNaN(m)) return null;
  const start = new Date(date);
  start.setHours(h, m, 0, 0);
  return Math.round((start.getTime() - now.getTime()) / 60000);
}

// ── Long-running scheduler for instrumentation.ts ────────────────────────────
let started = false;
export function startReminderScheduler(intervalMin = 5): void {
  if (started) return;
  started = true;
  console.log(`[reminders] scheduler started, interval=${intervalMin}min`);
  // Run once shortly after boot, then on the interval
  setTimeout(() => { processReminders().catch((e) => console.error("[reminders] error", e)); }, 5000);
  setInterval(() => {
    processReminders()
      .then((r) => {
        if (r.sent24h || r.sent2h || r.errors) {
          console.log(`[reminders] sent24h=${r.sent24h} sent2h=${r.sent2h} errors=${r.errors}`);
        }
      })
      .catch((e) => console.error("[reminders] error", e));
  }, intervalMin * 60 * 1000);
}
