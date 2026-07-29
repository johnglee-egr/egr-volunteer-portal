import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Self-service SMS consent for A2P 10DLC.
 *
 * This is intentionally the ONLY route that can set smsConsent = true. Carrier
 * rules require the subscriber's own affirmative opt-in, so a team captain
 * supplying a teammate's phone number must never enroll that person — the
 * teammate has to come here themselves from their own dashboard.
 *
 * Unauthenticated, matching the rest of the volunteer-facing API (which
 * identifies people by name + phone lookup rather than a session).
 */
export async function POST(req: NextRequest) {
  const { volunteerId, smsConsent, smsConsentText } = await req.json();

  if (!volunteerId) {
    return NextResponse.json({ error: "Volunteer ID required" }, { status: 400 });
  }

  const volunteer = await prisma.volunteer.findUnique({ where: { id: volunteerId } });
  if (!volunteer) {
    return NextResponse.json({ error: "Volunteer not found" }, { status: 404 });
  }

  if (smsConsent === true) {
    if (!volunteer.phone) {
      return NextResponse.json(
        { error: "Add a phone number to your profile before turning on text reminders." },
        { status: 400 }
      );
    }
    const updated = await prisma.volunteer.update({
      where: { id: volunteerId },
      data: {
        smsConsent: true,
        smsConsentAt: new Date(),
        smsConsentText: smsConsentText || null,
        // Opting back in clears any previous STOP
        smsOptOutAt: null,
        contactPref: volunteer.email ? "both" : "sms",
      },
    });
    return NextResponse.json({ ok: true, smsConsent: updated.smsConsent, smsConsentAt: updated.smsConsentAt });
  }

  // Opting out — keep the consent history but stamp the revocation so the
  // sender gate blocks future messages.
  const updated = await prisma.volunteer.update({
    where: { id: volunteerId },
    data: {
      smsConsent: false,
      smsOptOutAt: new Date(),
      contactPref: "email",
    },
  });
  return NextResponse.json({ ok: true, smsConsent: updated.smsConsent, smsOptOutAt: updated.smsOptOutAt });
}
