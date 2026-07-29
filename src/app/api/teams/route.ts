import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, isAdmin } from "@/lib/auth";
import { normalizePhone, phoneDigits } from "@/lib/formatters";

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

type MemberInput = { name: string; phone?: string | null; email?: string | null; isOver21?: boolean | null };

/**
 * Find or create the volunteer record for a teammate a captain is adding.
 *
 * Matching order is phone-first (digits-only, so formatting never matters) then
 * case-insensitive name, which keeps a captain from creating a duplicate record
 * for someone who already registered themselves.
 *
 * Deliberately never sets smsConsent: A2P 10DLC requires the subscriber's own
 * consent, so a captain supplying a number does not opt that person into texts.
 * The number is stored for contact/identification only.
 */
async function upsertMemberVolunteer(m: MemberInput) {
  const name = m.name.trim();
  const rawPhone = m.phone ? String(m.phone).trim() : "";

  let vol = null;
  if (rawPhone) {
    const digits = phoneDigits(rawPhone);
    if (digits.length >= 10) {
      const withPhone = await prisma.volunteer.findMany({ where: { phone: { not: null } } });
      vol = withPhone.find((v) => v.phone && phoneDigits(v.phone) === digits) ?? null;
    }
  }
  if (!vol) {
    vol = await prisma.volunteer.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
    });
  }

  const isOver21 = m.isOver21 === true ? true : m.isOver21 === false ? false : null;

  if (!vol) {
    return prisma.volunteer.create({
      data: {
        name,
        email: m.email || null,
        phone: rawPhone ? normalizePhone(rawPhone) : null,
        isOver21,
        // contactPref stays email-only until the person opts in to SMS themselves
        contactPref: "email",
      },
    });
  }

  // Backfill a phone or 21+ answer we didn't previously have, but never
  // overwrite details the volunteer supplied about themselves.
  const patch: { phone?: string; isOver21?: boolean } = {};
  if (rawPhone && !vol.phone) patch.phone = normalizePhone(rawPhone);
  if (isOver21 !== null && vol.isOver21 === null) patch.isOver21 = isOver21;
  if (Object.keys(patch).length > 0) {
    return prisma.volunteer.update({ where: { id: vol.id }, data: patch });
  }
  return vol;
}

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
  try {
    const { name, leaderId, memberNames } = await req.json();

    if (!name || !leaderId) {
      return NextResponse.json({ error: "Team name and leader required." }, { status: 400 });
    }

    // A volunteer may create the team they themselves lead (the "Build Your Team"
    // flow runs without an admin session). Anything else still requires admin.
    const callerIsAdmin = await isAdmin();
    if (!callerIsAdmin) {
      const leader = await prisma.volunteer.findUnique({ where: { id: leaderId } });
      if (!leader) {
        return NextResponse.json({ error: "Leader volunteer not found." }, { status: 404 });
      }
      // Don't let one volunteer stack up unlimited teams under their own name
      const existing = await prisma.team.count({ where: { leaderId } });
      if (existing >= 5) {
        return NextResponse.json(
          { error: "You already lead the maximum number of teams." },
          { status: 403 }
        );
      }
    }

    // Create volunteer records for members. A captain may supply a teammate's
    // phone for contact purposes — it never sets smsConsent, which only the
    // person themselves can give (A2P 10DLC forbids third-party opt-in).
    const memberVolunteerIds: string[] = [];
    if (memberNames && Array.isArray(memberNames)) {
      for (const m of memberNames) {
        if (!m.name || !m.name.trim()) continue;
        const vol = await upsertMemberVolunteer(m);
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
  try {
    const body = await req.json();
    const { id, name, addMembers, addMemberIds, removeMembers, assignShiftId, assignCategoryId, spreadAcrossShifts } = body;

    // Allow team leaders to manage their own team members without admin auth.
    // All other operations (rename, shift assignment, spread) require admin.
    const callerIsAdmin = await isAdmin();
    const teamLeaderOnly = !callerIsAdmin && (addMembers || removeMembers) && !name && !assignShiftId && !assignCategoryId && !spreadAcrossShifts;
    if (teamLeaderOnly) {
      const team = await prisma.team.findUnique({ where: { id } });
      if (!team || team.leaderId !== body.requesterId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    } else if (!callerIsAdmin) {
      const unauthed = await requireAdmin(); if (unauthed) return unauthed;
    }

    // Rename team
    if (name) {
      await prisma.team.update({ where: { id }, data: { name } });
    }

    // Add existing volunteers by id (admin "Add to Team" bulk action). Unlike
    // addMembers this never creates a volunteer — the records already exist, so
    // matching by name/phone would risk attaching the wrong person.
    if (addMemberIds && Array.isArray(addMemberIds)) {
      for (const volunteerId of addMemberIds) {
        if (typeof volunteerId !== "string" || !volunteerId) continue;
        const exists = await prisma.volunteer.findUnique({ where: { id: volunteerId } });
        if (!exists) continue;
        await prisma.teamMember.upsert({
          where: { teamId_volunteerId: { teamId: id, volunteerId } },
          create: { teamId: id, volunteerId },
          update: {},
        });
      }
    }

    // Add members by name (create volunteer if needed)
    if (addMembers && Array.isArray(addMembers)) {
      for (const m of addMembers) {
        if (!m.name || !m.name.trim()) continue;
        const vol = await upsertMemberVolunteer(m);
        // Add to team (ignore if already member)
        await prisma.teamMember.upsert({
          where: { teamId_volunteerId: { teamId: id, volunteerId: vol.id } },
          create: { teamId: id, volunteerId: vol.id },
          update: {},
        });
      }
    }

    // Remove members. Also release any shift the captain put them on, otherwise
    // the slot stays consumed by someone who is no longer on the roster and the
    // capacity can never be recovered from the volunteer portal.
    // Self-signups (assignedBy "self") are left alone — those are the member's own.
    if (removeMembers && Array.isArray(removeMembers)) {
      for (const memberId of removeMembers) {
        await prisma.teamMember.deleteMany({
          where: { teamId: id, volunteerId: memberId },
        });
        await prisma.assignment.deleteMany({
          where: { volunteerId: memberId, assignedBy: { in: ["team_lead", "team-auto"] } },
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

    // Spread remaining team members across their already-selected shifts (earliest → latest)
    if (body.spreadAcrossShifts) {
      const fullTeam = await prisma.team.findUnique({
        where: { id },
        include: {
          members: {
            include: {
              volunteer: { include: { assignments: { where: { status: "confirmed" } } } },
            },
          },
        },
      });
      if (fullTeam) {
        const shiftIds = new Set<string>();
        for (const m of fullTeam.members) {
          for (const a of m.volunteer.assignments) shiftIds.add(a.shiftId);
        }
        if (shiftIds.size > 0) {
          const relevantShifts = await prisma.shift.findMany({
            where: { id: { in: [...shiftIds] } },
            include: { assignments: { where: { status: "confirmed" } } },
            orderBy: [{ date: "asc" }, { startTime: "asc" }],
          });
          for (const shift of relevantShifts) {
            const assignedIds = new Set(shift.assignments.map((a) => a.volunteerId));
            const openSlots = shift.capacity - shift.assignments.length;
            if (openSlots <= 0) continue;
            const unassigned = fullTeam.members
              .map((m) => m.volunteerId)
              .filter((vid) => !assignedIds.has(vid));
            for (let i = 0; i < Math.min(openSlots, unassigned.length); i++) {
              await prisma.assignment.upsert({
                where: { volunteerId_shiftId: { volunteerId: unassigned[i], shiftId: shift.id } },
                create: { volunteerId: unassigned[i], shiftId: shift.id, status: "confirmed", assignedBy: "admin" },
                update: { status: "confirmed", assignedBy: "admin" },
              });
            }
          }
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
