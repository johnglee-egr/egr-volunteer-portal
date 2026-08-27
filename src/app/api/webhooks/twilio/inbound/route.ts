import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { phoneDigits } from "@/lib/formatters";
import { validateTwilioSignature, publicWebhookUrl, readTwilioForm } from "@/lib/twilio";

/**
 * Inbound SMS webhook — records opt-outs and opt-ins.
 *
 * Twilio blocks STOP'd numbers at their end automatically, but nothing told
 * this database about it. Without this route smsOptOutAt could only ever be set
 * by someone clicking "No thanks" in the portal, so a volunteer who texted STOP
 * still showed as "texts on" to their captain and to the admin — reachable in
 * the UI, silently unreachable in reality.
 *
 * Configure in Twilio: Phone Numbers → your number → Messaging → "A message
 * comes in" → Webhook → POST → https://<portal>/api/webhooks/twilio/inbound
 */

// Twilio's standard opt-out / opt-in / help keywords.
const STOP_WORDS  = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"]);
const START_WORDS = new Set(["start", "yes", "unstop"]);
const HELP_WORDS  = new Set(["help", "info"]);

// TwiML — Twilio auto-replies to STOP/HELP itself for registered campaigns, so
// we stay silent to avoid sending a duplicate message.
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
const xml = (body: string, status = 200) =>
  new NextResponse(body, { status, headers: { "Content-Type": "text/xml" } });

export async function POST(req: Request) {
  const params = await readTwilioForm(req);
  const ok = validateTwilioSignature(
    req.headers.get("x-twilio-signature"),
    publicWebhookUrl("/api/webhooks/twilio/inbound"),
    params
  );
  if (!ok) {
    console.warn("[twilio inbound] rejected: bad or missing signature");
    return xml("<Response></Response>", 403);
  }

  const from = params.From || "";
  const keyword = (params.Body || "").trim().toLowerCase().replace(/[^a-z]/g, "");
  const digits = phoneDigits(from);

  if (!digits) return xml(EMPTY_TWIML);

  // Match on digits so stored formatting never matters. A number can belong to
  // more than one volunteer record, so update every match.
  const all = await prisma.volunteer.findMany({ where: { phone: { not: null } } });
  const matches = all.filter((v) => v.phone && phoneDigits(v.phone) === digits);

  if (matches.length === 0) {
    console.log(`[twilio inbound] ${keyword || "(no keyword)"} from unknown number`);
    return xml(EMPTY_TWIML);
  }

  const ids = matches.map((v) => v.id);

  if (STOP_WORDS.has(keyword)) {
    await prisma.volunteer.updateMany({
      where: { id: { in: ids } },
      // Keep smsConsentAt/Text as the historical record of what they agreed to;
      // smsOptOutAt is what the send path checks.
      data: { smsConsent: false, smsOptOutAt: new Date(), contactPref: "email" },
    });
    console.log(`[twilio inbound] STOP → opted out ${ids.length} record(s)`);
  } else if (START_WORDS.has(keyword)) {
    await prisma.volunteer.updateMany({
      where: { id: { in: ids } },
      data: { smsConsent: true, smsConsentAt: new Date(), smsOptOutAt: null },
    });
    console.log(`[twilio inbound] START → opted in ${ids.length} record(s)`);
  } else if (HELP_WORDS.has(keyword)) {
    console.log(`[twilio inbound] HELP from ${ids.length} known record(s)`);
  }

  // Log every inbound message so the admin has a record of replies.
  await prisma.notification.create({
    data: {
      type: "sms-inbound",
      recipient: from,
      message: params.Body || "",
      status: "received",
      sentAt: new Date(),
      providerSid: params.MessageSid || null,
    },
  });

  return xml(EMPTY_TWIML);
}
