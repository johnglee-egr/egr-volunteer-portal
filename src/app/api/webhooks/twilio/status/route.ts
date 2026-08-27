import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateTwilioSignature, publicWebhookUrl, readTwilioForm } from "@/lib/twilio";

/**
 * Delivery status callback.
 *
 * sendSMS records status "sent" as soon as Twilio returns 2xx, but that only
 * means Twilio QUEUED the message. A disconnected number, a landline or a
 * carrier block all return 2xx and were being logged as a success. Twilio
 * reports the real outcome here, asynchronously, keyed by message SID.
 *
 * Twilio POSTs this automatically — the StatusCallback URL is set per-message
 * in sendSMS, so there is nothing to configure in the Console.
 */

// A message can end up here in a terminal failure state; these are the codes
// worth surfacing to the coordinator before festival day.
const KNOWN_ERRORS: Record<string, string> = {
  "30003": "Unreachable handset (off, or number no longer in service)",
  "30005": "Unknown destination — number does not exist",
  "30006": "Landline or unreachable carrier — cannot receive SMS",
  "30007": "Carrier filtered the message as spam",
  "30008": "Unknown delivery failure",
  "21610": "Recipient has replied STOP — you may not message them",
  "21614": "Not a valid mobile number",
};

export async function POST(req: Request) {
  const params = await readTwilioForm(req);
  const ok = validateTwilioSignature(
    req.headers.get("x-twilio-signature"),
    publicWebhookUrl("/api/webhooks/twilio/status"),
    params
  );
  if (!ok) {
    console.warn("[twilio status] rejected: bad or missing signature");
    return new NextResponse(null, { status: 403 });
  }

  const sid = params.MessageSid || params.SmsSid;
  const status = params.MessageStatus || params.SmsStatus || "";
  const errorCode = params.ErrorCode || null;
  if (!sid) return new NextResponse(null, { status: 204 });

  const existing = await prisma.notification.findUnique({ where: { providerSid: sid } });
  if (!existing) {
    // Message we didn't originate, or one sent before SID capture existed.
    console.log(`[twilio status] ${status} for untracked SID ${sid}`);
    return new NextResponse(null, { status: 204 });
  }

  const failed = status === "undelivered" || status === "failed";
  await prisma.notification.update({
    where: { providerSid: sid },
    data: {
      deliveryStatus: status,
      deliveredAt: status === "delivered" ? new Date() : null,
      errorCode,
      errorMessage: errorCode ? (KNOWN_ERRORS[errorCode] ?? `Twilio error ${errorCode}`) : null,
      // Keep the coarse status column honest too, so existing admin views that
      // read it stop reporting a hard bounce as "sent".
      status: failed ? "failed" : existing.status,
    },
  });

  // 21610 means the carrier is enforcing an opt-out we don't know about — sync it.
  if (errorCode === "21610") {
    const digitsOnly = (existing.recipient || "").replace(/\D/g, "").slice(-10);
    if (digitsOnly) {
      const all = await prisma.volunteer.findMany({ where: { phone: { not: null } } });
      const ids = all
        .filter((v) => (v.phone || "").replace(/\D/g, "").slice(-10) === digitsOnly)
        .map((v) => v.id);
      if (ids.length) {
        await prisma.volunteer.updateMany({
          where: { id: { in: ids } },
          data: { smsConsent: false, smsOptOutAt: new Date(), contactPref: "email" },
        });
        console.log(`[twilio status] 21610 → synced opt-out for ${ids.length} record(s)`);
      }
    }
  }

  return new NextResponse(null, { status: 204 });
}
