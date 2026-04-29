// Next.js instrumentation hook — runs once when the server starts.
// We use it to kick off the auto-reminder scheduler in the background.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startReminderScheduler } = await import("./src/lib/reminderScheduler");
    const intervalMin = parseInt(process.env.REMINDER_INTERVAL_MIN || "5");
    startReminderScheduler(intervalMin);
  }
}
