import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status");

  const where = status ? { status } : {};
  const assignments = await prisma.assignment.findMany({
    where,
    include: {
      volunteer: true,
      shift: { include: { category: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(assignments);
}

export async function POST(req: NextRequest) {
  const { volunteerId, shiftId, assignedBy, stationIndex } = await req.json();

  // Check capacity (only count confirmed)
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    include: {
      category: true,
      assignments: { where: { status: "confirmed" } },
    },
  });

  if (!shift) {
    return NextResponse.json({ error: "Shift not found" }, { status: 404 });
  }

  // Only enforce capacity for volunteer self-signup — admin can always over-assign
  if (assignedBy !== "admin" && shift.assignments.length >= shift.capacity) {
    return NextResponse.json({ error: "This shift is full" }, { status: 400 });
  }

  // Check for duplicate
  const existing = await prisma.assignment.findUnique({
    where: { volunteerId_shiftId: { volunteerId, shiftId } },
  });

  if (existing && (existing.status === "confirmed" || existing.status === "pending")) {
    return NextResponse.json(
      { error: existing.status === "confirmed" ? "Already assigned to this shift" : "Already pending approval for this shift" },
      { status: 400 }
    );
  }

  // ─── Approval triage ────────────────────────────────────────────────────────
  // Admin assignments are always auto-confirmed.
  // For self-signups, auto-confirm if "simple": shift has room AND any approved
  // partners can also fit. Otherwise queue for human review.
  let status: "confirmed" | "pending";
  let autoStationIndex = stationIndex;

  if (assignedBy === "admin") {
    status = "confirmed";
  } else {
    // Find approved partners not already on this shift
    const partnerLinks = await prisma.pairRequest.findMany({
      where: {
        OR: [{ requesterId: volunteerId }, { partnerId: volunteerId }],
        status: "approved",
      },
    });
    const partnerIds = partnerLinks.map((p) =>
      p.requesterId === volunteerId ? p.partnerId : p.requesterId
    );
    const onShiftIds = new Set(shift.assignments.map((a) => a.volunteerId));
    const partnersToAdd = partnerIds.filter((pid) => !onShiftIds.has(pid));

    const slotsNeeded = 1 + partnersToAdd.length;
    const slotsAvailable = shift.capacity - shift.assignments.length;

    // Volunteer is part of a pending group? Queue for human review.
    const inPendingGroup = await prisma.volunteerGroupMember.findFirst({
      where: { volunteerId, group: { status: "pending" } },
    });

    if (slotsAvailable >= slotsNeeded && !inPendingGroup) {
      status = "confirmed";
      // Auto-assign to first empty station for "throughout" categories with stations
      if (
        autoStationIndex === undefined &&
        shift.category?.type === "throughout" &&
        shift.category.stationCount > 1
      ) {
        const volsPer = shift.category.volsPerStation || 1;
        const counts = new Map<number, number>();
        shift.assignments.forEach((a) => {
          if (a.stationIndex != null) counts.set(a.stationIndex, (counts.get(a.stationIndex) || 0) + 1);
        });
        for (let i = 0; i < shift.category.stationCount; i++) {
          if ((counts.get(i) || 0) < volsPer) { autoStationIndex = i; break; }
        }
        if (autoStationIndex === undefined && shift.assignments.length > 0) autoStationIndex = 0;
      }
    } else {
      status = "pending";
    }
  }

  const assignment = existing
    ? await prisma.assignment.update({
        where: { id: existing.id },
        data: { status, assignedBy: assignedBy || "self", ...(autoStationIndex !== undefined ? { stationIndex: autoStationIndex } : {}) },
        include: { volunteer: true, shift: true },
      })
    : await prisma.assignment.create({
        data: { volunteerId, shiftId, status, assignedBy: assignedBy || "self", ...(autoStationIndex !== undefined ? { stationIndex: autoStationIndex } : {}) },
        include: { volunteer: true, shift: true },
      });

  // ─── Auto-assign approved partners ──────────────────────────────────────────
  // Runs for both admin and self-signup confirmed assignments.
  // If the primary assignment is confirmed, pull all approved pair partners
  // and confirm them on the same shift automatically.
  const autoAssignedPartners: string[] = [];
  if (status === "confirmed") {
    const partnerLinks = await prisma.pairRequest.findMany({
      where: {
        OR: [{ requesterId: volunteerId }, { partnerId: volunteerId }],
        status: "approved",
      },
    });
    const partnerIds = partnerLinks.map((p) =>
      p.requesterId === volunteerId ? p.partnerId : p.requesterId
    );

    for (const pid of partnerIds) {
      const existingPartner = await prisma.assignment.findUnique({
        where: { volunteerId_shiftId: { volunteerId: pid, shiftId } },
      });
      if (existingPartner?.status === "confirmed") continue; // already there
      if (existingPartner) {
        await prisma.assignment.update({
          where: { id: existingPartner.id },
          data: { status: "confirmed", assignedBy: "pair-auto", ...(autoStationIndex !== undefined ? { stationIndex: autoStationIndex } : {}) },
        });
      } else {
        await prisma.assignment.create({
          data: { volunteerId: pid, shiftId, status: "confirmed", assignedBy: "pair-auto", ...(autoStationIndex !== undefined ? { stationIndex: autoStationIndex } : {}) },
        });
      }
      autoAssignedPartners.push(pid);
    }
  }

  return NextResponse.json({ ...assignment, triaged: status === "confirmed" && assignedBy !== "admin", autoAssignedPartners: autoAssignedPartners.length }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const { assignmentId, status, stationIndex } = await req.json();

  // Allow updating just stationIndex without status change
  if (assignmentId && stationIndex !== undefined && !status) {
    const updated = await prisma.assignment.update({
      where: { id: assignmentId },
      data: { stationIndex },
      include: { volunteer: true, shift: { include: { category: true } } },
    });
    return NextResponse.json(updated);
  }

  if (!assignmentId || !["confirmed", "denied", "cancelled"].includes(status)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Capacity check removed from admin approval — admin can approve beyond minimum

  const updated = await prisma.assignment.update({
    where: { id: assignmentId },
    data: { status, ...(stationIndex !== undefined ? { stationIndex } : {}) },
    include: { volunteer: true, shift: { include: { category: true } } },
  });

  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest) {
  const { assignmentId, volunteerId, shiftId } = await req.json();

  if (assignmentId) {
    await prisma.assignment.update({
      where: { id: assignmentId },
      data: { status: "cancelled" },
    });
  } else if (volunteerId && shiftId) {
    await prisma.assignment.update({
      where: { volunteerId_shiftId: { volunteerId, shiftId } },
      data: { status: "cancelled" },
    });
  }

  return NextResponse.json({ success: true });
}
