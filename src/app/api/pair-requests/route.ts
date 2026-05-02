import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const requests = await prisma.pairRequest.findMany({
    include: { requester: true, partner: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(requests);
}

export async function POST(req: NextRequest) {
  const { requesterId, partnerId: directPartnerId, partnerName, partnerEmail, partnerPhone, shiftId, message, autoApprove } = await req.json();

  // Prefer a directly-supplied partnerId (from admin UI) over a name-based lookup.
  // Name lookup is kept for the volunteer-facing "pair request by name" flow.
  let partner: { id: string; name: string } | null = null;

  if (directPartnerId) {
    partner = await prisma.volunteer.findUnique({ where: { id: directPartnerId } });
    if (!partner) {
      return NextResponse.json({ error: "Partner volunteer not found." }, { status: 404 });
    }
  } else {
    // Find partner by name
    partner = await prisma.volunteer.findFirst({
      where: { name: { equals: partnerName } },
    });

    // If partner doesn't exist, create them — phone is required for reminders
    if (!partner) {
      if (!partnerPhone) {
        return NextResponse.json(
          { error: `Could not find volunteer named "${partnerName}". Please provide their phone number (required) so we can register them.` },
          { status: 404 }
        );
      }

      // Check if a volunteer already exists with same name + same phone
      partner = await prisma.volunteer.findFirst({
        where: {
          name: { equals: partnerName },
          phone: { equals: partnerPhone },
        },
      });

      if (!partner) {
        partner = await prisma.volunteer.create({
          data: {
            name: partnerName,
            email: partnerEmail || null,
            phone: partnerPhone,
          },
        });
      }
    }
  }

  const pairRequest = await prisma.pairRequest.create({
    data: {
      requesterId,
      partnerId: partner.id,
      shiftId: shiftId || null,
      message: message || null,
      status: autoApprove ? "approved" : "pending",
    },
    include: { requester: true, partner: true },
  });

  // When auto-approved (admin-created pair), cross-assign each person to the
  // other's existing confirmed shifts so the pair is immediately in sync.
  if (autoApprove) {
    await crossAssignPair(requesterId, partner.id);
  }

  return NextResponse.json(pairRequest, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const { id, status } = await req.json();
  const request = await prisma.pairRequest.update({
    where: { id },
    data: { status },
    include: { requester: true, partner: true },
  });

  // When a pair request is approved (admin approves from the queue),
  // cross-assign the pair to each other's existing confirmed shifts.
  if (status === "approved") {
    await crossAssignPair(request.requesterId, request.partnerId);
  }

  return NextResponse.json(request);
}

/**
 * Given two volunteer IDs who are now an approved pair, assign each one to
 * any confirmed shifts the other already has (if not already there).
 */
async function crossAssignPair(idA: string, idB: string): Promise<void> {
  const [assignmentsA, assignmentsB] = await Promise.all([
    prisma.assignment.findMany({ where: { volunteerId: idA, status: "confirmed" } }),
    prisma.assignment.findMany({ where: { volunteerId: idB, status: "confirmed" } }),
  ]);

  const shiftIdsA = new Set(assignmentsA.map((a) => a.shiftId));
  const shiftIdsB = new Set(assignmentsB.map((a) => a.shiftId));

  // Shifts A is on that B isn't → add B
  const toAddToB = assignmentsA.filter((a) => !shiftIdsB.has(a.shiftId));
  // Shifts B is on that A isn't → add A
  const toAddToA = assignmentsB.filter((a) => !shiftIdsA.has(a.shiftId));

  const upserts: Promise<unknown>[] = [];

  for (const a of toAddToB) {
    upserts.push(
      prisma.assignment.upsert({
        where: { volunteerId_shiftId: { volunteerId: idB, shiftId: a.shiftId } },
        update: { status: "confirmed", assignedBy: "pair-auto" },
        create: { volunteerId: idB, shiftId: a.shiftId, status: "confirmed", assignedBy: "pair-auto" },
      })
    );
  }

  for (const a of toAddToA) {
    upserts.push(
      prisma.assignment.upsert({
        where: { volunteerId_shiftId: { volunteerId: idA, shiftId: a.shiftId } },
        update: { status: "confirmed", assignedBy: "pair-auto" },
        create: { volunteerId: idA, shiftId: a.shiftId, status: "confirmed", assignedBy: "pair-auto" },
      })
    );
  }

  await Promise.all(upserts);
}
