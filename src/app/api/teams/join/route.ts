import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Self-service team join.
 *
 * The main PUT /api/teams addMembers path is gated to admins and the team's own
 * leader. This route covers the opposite direction: a volunteer adding
 * themselves to an existing team during (or after) signup. Scope is deliberately
 * narrow — it can only ever add the caller to one team, never anyone else.
 */
export async function POST(req: NextRequest) {
  const { volunteerId, teamId } = await req.json();

  if (!volunteerId || !teamId) {
    return NextResponse.json({ error: "Volunteer and team are required." }, { status: 400 });
  }

  const [volunteer, team] = await Promise.all([
    prisma.volunteer.findUnique({ where: { id: volunteerId } }),
    prisma.team.findUnique({ where: { id: teamId }, include: { leader: true } }),
  ]);

  if (!volunteer) return NextResponse.json({ error: "Volunteer not found." }, { status: 404 });
  if (!team) return NextResponse.json({ error: "That team no longer exists." }, { status: 404 });

  await prisma.teamMember.upsert({
    where: { teamId_volunteerId: { teamId, volunteerId } },
    create: { teamId, volunteerId },
    update: {},
  });

  return NextResponse.json({
    ok: true,
    teamId: team.id,
    teamName: team.name,
    leaderName: team.leader?.name ?? null,
  });
}

/** Leave a team you joined. */
export async function DELETE(req: NextRequest) {
  const { volunteerId, teamId } = await req.json();
  if (!volunteerId || !teamId) {
    return NextResponse.json({ error: "Volunteer and team are required." }, { status: 400 });
  }

  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (team?.leaderId === volunteerId) {
    return NextResponse.json(
      { error: "You lead this team — a captain can't leave their own team." },
      { status: 400 }
    );
  }

  await prisma.teamMember.deleteMany({ where: { teamId, volunteerId } });
  // Release only shifts the captain assigned; the volunteer's own signups stay.
  await prisma.assignment.deleteMany({
    where: { volunteerId, assignedBy: { in: ["team_lead", "team-auto"] } },
  });

  return NextResponse.json({ ok: true });
}
