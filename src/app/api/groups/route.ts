import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const groupInclude = {
  leader: true,
  members: { include: { volunteer: true } },
};

export async function GET() {
  try {
    const groups = await prisma.volunteerGroup.findMany({
      include: groupInclude,
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(groups);
  } catch (e: unknown) {
    console.error("GET /api/groups error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { name, leaderId, message, members } = await req.json();

  if (!name || !leaderId) {
    return NextResponse.json({ error: "Group name and leader are required." }, { status: 400 });
  }

  if (!members || !Array.isArray(members) || members.length === 0) {
    return NextResponse.json({ error: "At least one group member is required." }, { status: 400 });
  }

  // Create volunteer records for members (name only, no contact required)
  const memberVolunteerIds: string[] = [];
  for (const m of members) {
    if (!m.name || !m.name.trim()) continue;
    const vol = await prisma.volunteer.create({
      data: { name: m.name.trim() },
    });
    memberVolunteerIds.push(vol.id);
  }

  // Create the group
  const group = await prisma.volunteerGroup.create({
    data: {
      name,
      leaderId,
      message: message || null,
      members: {
        create: [
          // Leader is always a member
          { volunteerId: leaderId },
          // Additional members
          ...memberVolunteerIds.map((vid) => ({ volunteerId: vid })),
        ],
      },
    },
    include: groupInclude,
  });

  return NextResponse.json(group, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const { id, status } = await req.json();

  const group = await prisma.volunteerGroup.update({
    where: { id },
    data: { status },
    include: groupInclude,
  });

  return NextResponse.json(group);
}
