import { NextRequest, NextResponse } from "next/server";
import { processReminders } from "@/lib/reminderScheduler";

// Manual trigger / external cron endpoint.
// Optionally protect with REMINDER_CRON_SECRET (header X-Cron-Secret).
export async function POST(req: NextRequest) {
  const secret = process.env.REMINDER_CRON_SECRET;
  if (secret) {
    const provided = req.headers.get("x-cron-secret");
    if (provided !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  const result = await processReminders();
  return NextResponse.json(result);
}

// Allow GET for ease of triggering manually from a browser
export async function GET(req: NextRequest) {
  return POST(req);
}
