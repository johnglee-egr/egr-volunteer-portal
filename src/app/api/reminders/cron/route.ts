import { NextRequest, NextResponse } from "next/server";
import { processReminders } from "@/lib/reminderScheduler";
import { isAdmin } from "@/lib/auth";

// Manual trigger / external cron endpoint.
// Protected by REMINDER_CRON_SECRET header OR an active admin session.
// If neither is configured, the endpoint is locked — "fail closed".
export async function POST(req: NextRequest) {
  const secret = process.env.REMINDER_CRON_SECRET;

  if (secret) {
    // External cron (Vercel Cron, cURL, etc.) — validate the shared secret
    const provided = req.headers.get("x-cron-secret");
    if (provided !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else {
    // No secret configured — fall back to requiring an active admin session
    const authed = await isAdmin();
    if (!authed) {
      return NextResponse.json(
        { error: "Set REMINDER_CRON_SECRET env var or log in as admin to trigger reminders." },
        { status: 401 }
      );
    }
  }

  const result = await processReminders();
  return NextResponse.json(result);
}
