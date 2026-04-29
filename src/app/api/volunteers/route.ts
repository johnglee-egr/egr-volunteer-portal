import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

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
  const { name, email, phone } = data;

  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (!phone) {
    return NextResponse.json(
      { error: "A phone number is required so we can send shift reminders" },
      { status: 400 }
    );
  }

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
    return NextResponse.json(existing);
  }

  // If requesting team lead role, save as pendingRole (requires admin approval)
  const wantsTeamLead = data.role === "team_lead";
  const volunteer = await prisma.volunteer.create({
    data: {
      name,
      email: email || null,
      phone: phone || null,
      role: "volunteer",
      pendingRole: wantsTeamLead ? "team_lead" : null,
    },
  });
  return NextResponse.json(volunteer, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "Volunteer ID required" }, { status: 400 });

  // Teams and groups led by this volunteer have no cascade on the leader FK,
  // so remove them first (their members cascade automatically).
  await prisma.team.deleteMany({ where: { leaderId: id } });
  await prisma.volunteerGroup.deleteMany({ where: { leaderId: id } });

  // Delete the volunteer — cascades to Assignment, PairRequest,
  // TeamMember, and VolunteerGroupMember automatically.
  await prisma.volunteer.delete({ where: { id } });

  return NextResponse.json({ success: true });
}

export async function PUT(req: NextRequest) {
  const { id, role, name, email, phone, approvePendingRole, denyPendingRole } = await req.json() as Record<string, string>;
  if (!id) {
    return NextResponse.json({ error: "Volunteer ID required" }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};
  if (role !== undefined) updateData.role = role;
  if (name !== undefined) updateData.name = name;
  if (email !== undefined) updateData.email = email;
  if (phone !== undefined) updateData.phone = phone;
  // Approve pending role: promote to role and clear pendingRole
  if (approvePendingRole) { updateData.role = approvePendingRole; updateData.pendingRole = null; }
  // Deny pending role: just clear pendingRole
  if (denyPendingRole) { updateData.pendingRole = null; }

  const volunteer = await prisma.volunteer.update({
    where: { id },
    data: updateData,
    include: {
      assignments: { where: { status: "confirmed" }, include: { shift: true } },
    },
  });
  return NextResponse.json(volunteer);
}
