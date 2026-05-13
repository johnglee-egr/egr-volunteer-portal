import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams.get("search");
  const where = search
    ? { name: { contains: search } }
    : {};

  const volunteers = await prisma.volunteer.findMany({
    where,
    include: {
      assignments: {
        where: { status: "confirmed" },
        include: { shift: true },
      },
    },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(volunteers);
}

export async function POST(req: NextRequest) {
  const data = await req.json();
  const { name, email, phone, contactPref, isOver21 } = data;

  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (!phone) {
    return NextResponse.json(
      { error: "A phone number is required so we can send shift reminders" },
      { status: 400 }
    );
  }

  // Validate contactPref — only meaningful when the volunteer provided both channels
  const validPrefs = ["both", "email", "sms"];
  const resolvedPref = validPrefs.includes(contactPref) ? contactPref : "both";

  // Check for existing volunteer with same name and contact
  const existing = await prisma.volunteer.findFirst({
    where: {
      name: { equals: name },
      OR: [
        ...(email ? [{ email: { equals: email } }] : []),
        ...(phone ? [{ phone: { equals: phone } }] : []),
      ],
    },
  });

  if (existing) {
    // Return only id + name — not the full record — to avoid PII leakage
    // The client should then use /api/volunteers/lookup to authenticate properly
    return NextResponse.json({ id: existing.id, name: existing.name, alreadyRegistered: true });
  }

  // If requesting team lead role, save as pendingRole (requires admin approval)
  const wantsTeamLead = data.role === "team_lead";
  // isOver21: accept true/false; null means not answered
  const resolvedIsOver21 = isOver21 === true ? true : isOver21 === false ? false : null;

  const volunteer = await prisma.volunteer.create({
    data: {
      name,
      email: email || null,
      phone: phone || null,
      contactPref: resolvedPref,
      role: "volunteer",
      pendingRole: wantsTeamLead ? "team_lead" : null,
      isOver21: resolvedIsOver21,
    },
  });
  return NextResponse.json(volunteer, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const unauthed = await requireAdmin(); if (unauthed) return unauthed;
  const { id, deleteTeamMembers } = await req.json();
  if (!id) return NextResponse.json({ error: "Volunteer ID required" }, { status: 400 });

  // Wrap in a transaction so a partial failure doesn't leave orphaned data
  await prisma.$transaction(async (tx) => {
    // If requested, also delete every member of the teams this volunteer leads.
    if (deleteTeamMembers) {
      const ledTeams = await tx.team.findMany({
        where: { leaderId: id },
        include: { members: true },
      });
      const memberIds = new Set<string>();
      for (const t of ledTeams) {
        for (const m of t.members) {
          if (m.volunteerId !== id) memberIds.add(m.volunteerId);
        }
      }
      for (const memberId of memberIds) {
        // Each member might themselves lead a team/group — clean those up first
        await tx.team.deleteMany({ where: { leaderId: memberId } });
        await tx.volunteerGroup.deleteMany({ where: { leaderId: memberId } });
        await tx.volunteer.delete({ where: { id: memberId } });
      }
    }

    // Teams and groups led by this volunteer have no cascade on the leader FK,
    // so remove them first (their members cascade automatically).
    await tx.team.deleteMany({ where: { leaderId: id } });
    await tx.volunteerGroup.deleteMany({ where: { leaderId: id } });
    // Delete the volunteer — cascades to Assignment, PairRequest,
    // TeamMember, and VolunteerGroupMember automatically.
    await tx.volunteer.delete({ where: { id } });
  });

  return NextResponse.json({ success: true });
}

export async function PUT(req: NextRequest) {
  const unauthed = await requireAdmin(); if (unauthed) return unauthed;
  const body = await req.json();
  const { id, role, name, email, phone, approvePendingRole, denyPendingRole, isOver21 } = body as Record<string, unknown>;
  if (!id) {
    return NextResponse.json({ error: "Volunteer ID required" }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};
  if (role !== undefined) updateData.role = role;
  if (name !== undefined) updateData.name = name;
  if (email !== undefined) updateData.email = email;
  if (phone !== undefined) updateData.phone = phone;
  if (isOver21 !== undefined) updateData.isOver21 = isOver21 === true ? true : isOver21 === false ? false : null;
  // Approve pending role: promote to role and clear pendingRole
  if (approvePendingRole) { updateData.role = approvePendingRole; updateData.pendingRole = null; }
  // Deny pending role: clear (or mark as denied-but-kept) depending on keepDenied flag
  if (denyPendingRole) {
    updateData.pendingRole = (body as Record<string, unknown>).keepDenied ? "team_lead_denied" : null;
  }

  const volunteer = await prisma.volunteer.update({
    where: { id: id as string },
    data: updateData,
    include: {
      assignments: { where: { status: "confirmed" }, include: { shift: true } },
    },
  });
  return NextResponse.json(volunteer);
}
