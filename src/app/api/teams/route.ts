import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

const teamInclude = {
  leader: true,
  members: {
    include: {
      volunteer: {
        include: { assignments: { include: { shift: { include: { category: true } } } } },
      },
    },
  },
};

export async function GET() {
  try {
    const teams = await prisma.team.findMany({
      include: teamInclude,
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(teams);
  } catch (e: unknown) {
    console.error("GET /api/teams error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const unauthed = await requireAdmin(); if (unauthed) return unauthed;
  try {
    const { name, leaderId, memberNames } = await req.json();

    if (!name || !leaderId) {
      return NextResponse.json({ error: "Team name and leader required." }, { status: 400 });
    }

    // Create volunteer records for members (name only)
    const memberVolunteerIds: string[] = [];
    if (memberNames && Array.isArray(memberNames)) {
      for (const m of memberNames) {
        if (!m.name || !m.name.trim()) continue;
        // Check if volunteer already exists by name
        let vol = await prisma.volunteer.findFirst({ where: { name: m.name.trim() } });
        if (!vol) {
          const memberIsOver21 = m.isOver21 === true ? true : m.isOver21 === false ? false : null;
          vol = await prisma.volunteer.create({
            data: {
              name: m.name.trim(),
              email: m.email || null,
              phone: m.phone || null,
              isOver21: memberIsOver21,
            },
          });
        }
        memberVolunteerIds.push(vol.id);
      }
    }

    const team = await prisma.team.create({
      data: {
        name,
        leaderId,
        members: {
          create: [
            { volunteerId: leaderId },
            ...memberVolunteerIds.map((vid) => ({ volunteerId: vid })),
          ],
        },
      },
      include: teamInclude,
    });

    return NextResponse.json(team, { status: 201 });
  } catch (e: unknown) {
    console.error("POST /api/teams error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const unauthed = await requireAdmin(); if (unauthed) return unauthed;
  try {
    const { id, name, addMembers, removeMembers, assignShiftId, assignCategoryId } = await req.json();

    // Rename team
    if (name) {
      await prisma.team.update({ where: { id }, data: { name } });
    }

    // Add members by name (create volunteer if needed)
    if (addMembers && Array.isArray(addMembers)) {
      for (const m of addMembers) {
        let vol = await prisma.volunteer.findFirst({ where: { name: m.name?.trim() } });
        if (!vol) {
          const addIsOver21 = m.isOver21 === true ? true : m.isOver21 === false ? false : null;
          vol = await prisma.volunteer.create({
            data: {
              name: m.name.trim(),
              email: m.email || null,
              phone: m.phone || null,
              isOver21: addIsOver21,
            },
          });
        }
        // Add to team (ignore if already member)
        await prisma.teamMember.upsert({
          where: { teamId_volunteerId: { teamId: id, volunteerId: vol.id } },
          create: { teamId: id, volunteerId: vol.id },
          update: {},
        });
      }
    }

    // Remove members
    if (removeMembers && Array.isArray(removeMembers)) {
      for (const memberId of removeMembers) {
        await prisma.teamMember.deleteMany({
          where: { teamId: id, volunteerId: memberId },
        });
      }
    }

    // Assign entire team to a shift
    if (assignShiftId) {
      const team = await prisma.team.findUnique({
        where: { id },
        include: { members: true },
      });
      if (team) {
        const results = [];
        for (const member of team.members) {
          try {
            const assignment = await prisma.assignment.upsert({
              where: { volunteerId_shiftId: { volunteerId: member.volunteerId, shiftId: assignShiftId } },
              create: { volunteerId: member.volunteerId, shiftId: assignShiftId, assignedBy: "team_lead", status: "confirmed" },
              update: {},
            });
            results.push(assignment);
          } catch {
            // Skip if already assigned
          }
        }
      }
    }

    // Assign entire team to fill a category (all shifts in that category)
    if (assignCategoryId) {
      const team = await prisma.team.findUnique({
        where: { id },
        include: { members: true },
      });
      const shifts = await prisma.shift.findMany({
        where: { categoryId: assignCategoryId },
        include: { assignments: true },
        orderBy: { startTime: "asc" },
      });

      if (team && shifts.length > 0) {
        let memberQueue = [...team.members];
        for (const shift of shifts) {
          const openSlots = shift.capacity - shift.assignments.length;
          const toAssign = memberQueue.splice(0, openSlots);
          for (const member of toAssign) {
            try {
              await prisma.assignment.upsert({
                where: { volunteerId_shiftId: { volunteerId: member.volunteerId, shiftId: shift.id } },
                create: { volunteerId: member.volunteerId, shiftId: shift.id, assignedBy: "team_lead", status: "confirmed" },
                update: {},
              });
            } catch {
              // Skip duplicates
            }
          }
          if (memberQueue.length === 0) break;
        }
      }
    }

    const updated = await prisma.team.findUnique({ where: { id }, include: teamInclude });
    return NextResponse.json(updated);
  } catch (e: unknown) {
    console.error("PUT /api/teams error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const unauthed = await requireAdmin(); if (unauthed) return unauthed;
  try {
    const { id } = await req.json();
    await prisma.team.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    console.error("DELETE /api/teams error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
