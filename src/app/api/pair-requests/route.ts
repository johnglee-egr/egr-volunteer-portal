import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, isAdmin } from "@/lib/auth";
import { phoneDigits, normalizePhone } from "@/lib/formatters";

export async function GET() {
  // Admin-only: includes full requester/partner records with contact details.
  // Volunteers see their own pair requests via /api/volunteers/lookup.
  const unauthed = await requireAdmin(); if (unauthed) return unauthed;
  const requests = await prisma.pairRequest.findMany({
    include: { requester: true, partner: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(requests);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { requesterId, partnerId: directPartnerId, partnerName, partnerEmail, partnerPhone, partnerIsOver21, shiftId, message } = body;
  // autoApprove / skipCrossAssign are admin-only privileges
  const callerIsAdmin = await isAdmin();
  const autoApprove = callerIsAdmin ? !!body.autoApprove : false;
  const skipCrossAssign = callerIsAdmin ? !!body.skipCrossAssign : false;

  // Prefer a directly-supplied partnerId (from admin UI) over a name-based lookup.
  // Name lookup is kept for the volunteer-facing "pair request by name" flow.
  let partner: { id: string; name: string } | null = null;

  if (directPartnerId) {
    partner = await prisma.volunteer.findUnique({ where: { id: directPartnerId } });
    if (!partner) {
      return NextResponse.json({ error: "Partner volunteer not found." }, { status: 404 });
    }
  } else {
    // 1. If a phone was provided, try to match an existing volunteer by phone first
    //    (digits-only so any format works; name may be misspelled)
    if (partnerPhone) {
      const inputDigits = phoneDigits(partnerPhone);
      const allWithPhone = await prisma.volunteer.findMany({ where: { phone: { not: null } } });
      partner = allWithPhone.find((v) => v.phone && phoneDigits(v.phone) === inputDigits) ?? null;
    }

    // 2. Fall back to exact name lookup if phone didn't match
    if (!partner && partnerName) {
      partner = await prisma.volunteer.findFirst({
        where: { name: { equals: partnerName, mode: "insensitive" } },
      });
    }

    // 3. Still not found. Creating a volunteer record for another person is only
    //    allowed when the requester explicitly asked to sign them up — otherwise
    //    we'd be registering a third party, with their phone number, on someone
    //    else's say-so and with no opt-in from them.
    if (!partner && !body.createPartnerIfMissing) {
      return NextResponse.json(
        {
          error: `We couldn't find a volunteer named "${partnerName}". If they haven't signed up yet, tick "My partner isn't registered yet — sign them up" and we'll add them.`,
          partnerNotFound: true,
        },
        { status: 404 }
      );
    }

    if (!partner) {
      if (!partnerPhone) {
        return NextResponse.json(
          { error: `Could not find a volunteer matching "${partnerName}". Please provide their phone number so we can register them.` },
          { status: 404 }
        );
      }
      const partnerContactPref = partnerEmail && partnerPhone ? "both" : partnerEmail ? "email" : "sms";
      const resolvedPartnerIsOver21 = partnerIsOver21 === true ? true : partnerIsOver21 === false ? false : null;
      partner = await prisma.volunteer.create({
        data: {
          name: partnerName,
          email: partnerEmail || null,
          phone: normalizePhone(partnerPhone),
          contactPref: partnerContactPref,
          isOver21: resolvedPartnerIsOver21,
        },
      });
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
  // skipCrossAssign lets the admin drive shift assignment explicitly via the UI.
  if (autoApprove && !skipCrossAssign) {
    await crossAssignPair(requesterId, partner.id);
  }

  return NextResponse.json(pairRequest, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const unauthed = await requireAdmin(); if (unauthed) return unauthed;
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

  /**
   * Place the partner at the same station as the person they're paired with —
   * standing together is the entire point of a pair. Previously the station was
   * left null, so on a stationed shift the second half of every pair printed
   * with a blank Station column and no idea where to go.
   *
   * Falls back to the next station with room if the partner's is full, and to
   * the partner's station regardless if the shift is completely full (the admin
   * approved the pair, so keeping them together beats an empty cell).
   */
  const placeWith = async (shiftId: string, partnerStation: number | null) => {
    if (partnerStation === null) return undefined; // unstationed shift
    const shift = await prisma.shift.findUnique({
      where: { id: shiftId },
      include: { category: true, assignments: { where: { status: "confirmed" } } },
    });
    const stationCount = shift?.category?.stationCount ?? 0;
    const volsPer = shift?.category?.volsPerStation ?? 1;
    if (!shift || stationCount <= 1) return undefined;

    const occupancy = new Map<number, number>();
    for (const a of shift.assignments) {
      if (a.stationIndex != null) occupancy.set(a.stationIndex, (occupancy.get(a.stationIndex) || 0) + 1);
    }
    if ((occupancy.get(partnerStation) || 0) < volsPer) return partnerStation;
    for (let i = 0; i < stationCount; i++) {
      if ((occupancy.get(i) || 0) < volsPer) return i;
    }
    return partnerStation;
  };

  for (const a of toAddToB) {
    const station = await placeWith(a.shiftId, a.stationIndex);
    await prisma.assignment.upsert({
      where: { volunteerId_shiftId: { volunteerId: idB, shiftId: a.shiftId } },
      update: {
        status: "confirmed",
        assignedBy: "pair-auto",
        ...(station !== undefined ? { stationIndex: station } : {}),
      },
      create: {
        volunteerId: idB,
        shiftId: a.shiftId,
        status: "confirmed",
        assignedBy: "pair-auto",
        ...(station !== undefined ? { stationIndex: station } : {}),
      },
    });
  }

  for (const a of toAddToA) {
    const station = await placeWith(a.shiftId, a.stationIndex);
    await prisma.assignment.upsert({
      where: { volunteerId_shiftId: { volunteerId: idA, shiftId: a.shiftId } },
      update: {
        status: "confirmed",
        assignedBy: "pair-auto",
        ...(station !== undefined ? { stationIndex: station } : {}),
      },
      create: {
        volunteerId: idA,
        shiftId: a.shiftId,
        status: "confirmed",
        assignedBy: "pair-auto",
        ...(station !== undefined ? { stationIndex: station } : {}),
      },
    });
  }

  // Backfill shifts the pair ALREADY share where one of them has no station.
  // These are skipped by the loops above (nothing to add), which is how records
  // created before the station fix keep printing a blank Station column.
  const shared = assignmentsA.filter((a) => shiftIdsB.has(a.shiftId));
  for (const a of shared) {
    const b = assignmentsB.find((x) => x.shiftId === a.shiftId);
    if (!b) continue;
    if (a.stationIndex == null && b.stationIndex != null) {
      const station = await placeWith(a.shiftId, b.stationIndex);
      if (station !== undefined) {
        await prisma.assignment.update({ where: { id: a.id }, data: { stationIndex: station } });
      }
    } else if (b.stationIndex == null && a.stationIndex != null) {
      const station = await placeWith(b.shiftId, a.stationIndex);
      if (station !== undefined) {
        await prisma.assignment.update({ where: { id: b.id }, data: { stationIndex: station } });
      }
    }
  }
}
