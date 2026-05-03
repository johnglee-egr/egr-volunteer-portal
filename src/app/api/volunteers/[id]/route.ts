import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// This endpoint is intentionally accessible without admin auth.
// It is used by the volunteer portal to refresh a volunteer's own dashboard
// after login (the volunteer's ID was captured from the original lookup response).
// IDs are CUIDs — not guessable by enumeration — providing reasonable obscurity.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const volunteer = await prisma.volunteer.findUnique({
    where: { id },
    include: {
      assignments: {
        include: { shift: { include: { category: true } } },
      },
      pairRequests: {
        include: { requester: true, partner: true },
      },
    },
  });
  if (!volunteer) {
    return NextResponse.json({ error: "Volunteer not found" }, { status: 404 });
  }
  return NextResponse.json(volunteer);
}
