import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildShiftEvent, generateICS } from "@/lib/ics";

/**
 * Public endpoint — no auth required.
 * Returns an .ics file for the given assignment so volunteers can add
 * their shift directly to Google Calendar, Apple Calendar, Outlook, etc.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  const { assignmentId } = await params;

  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId, status: "confirmed" },
    include: { volunteer: true, shift: true },
  });

  if (!assignment) {
    return NextResponse.json({ error: "Assignment not found or not confirmed" }, { status: 404 });
  }

  const portalUrl = process.env.NEXT_PUBLIC_FESTIVAL_SITE_URL
    ? `${process.env.NEXT_PUBLIC_FESTIVAL_SITE_URL}/volunteer`
    : "https://volunteers.egrharvestfest.com/volunteer";

  const event = buildShiftEvent(
    assignment.id,
    assignment.shift,
    assignment.volunteer.name,
    portalUrl
  );

  const icsContent = generateICS(event);

  return new NextResponse(icsContent, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="volunteer-shift-${assignmentId}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
