import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAdmin } from "@/lib/auth";

// POST /api/assignments/bulk
//   { shiftId, volunteerIds: string[], stationIndex? }
// Deliberately bypasses capacity (an admin may over-assign) and auto-confirms,
// but NOT the 21+ rule — that one is a legal constraint, not a soft limit.
export async function POST(req: NextRequest) {
  const { shiftId, volunteerIds, stationIndex } = await req.json() as {
    shiftId: string;
    volunteerIds: string[];
    stationIndex?: number;
  };

  // Team captains use this to sign up their own members, so it can't be
  // admin-gated outright — but callers who aren't admins may only assign
  // people who are on a team they lead.
  const callerIsAdmin = await isAdmin();

  if (!shiftId || !Array.isArray(volunteerIds) || volunteerIds.length === 0) {
    return NextResponse.json({ error: "shiftId and volunteerIds[] required" }, { status: 400 });
  }

  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    include: {
      category: true,
      assignments: { where: { status: "confirmed" } },
    },
  });
  if (!shift) return NextResponse.json({ error: "Shift not found" }, { status: 404 });

  // Determine the next available station for each new assignment, if a stationed shift
  const isStationed = shift.category?.type === "throughout" && shift.category.stationCount > 1;
  const volsPer = shift.category?.volsPerStation || 1;
  const stationCounts = new Map<number, number>();
  for (const a of shift.assignments) {
    if (a.stationIndex != null) stationCounts.set(a.stationIndex, (stationCounts.get(a.stationIndex) || 0) + 1);
  }
  const pickStation = (): number | undefined => {
    if (stationIndex !== undefined) return stationIndex;
    if (!isStationed) return undefined;
    for (let i = 0; i < (shift.category?.stationCount || 0); i++) {
      if ((stationCounts.get(i) || 0) < volsPer) {
        stationCounts.set(i, (stationCounts.get(i) || 0) + 1);
        return i;
      }
    }
    return 0; // overflow — admin chose to over-assign
  };

  const results: { volunteerId: string; name?: string; status: "added" | "already" | "error"; error?: string }[] = [];

  // Age eligibility is enforced here exactly as it is on the single-assign
  // path. Previously this route skipped the check entirely, so an under-21
  // volunteer could be placed on an alcohol-service shift in bulk — which is
  // the path a coordinator actually uses when staffing a large category.
  const needs21 = shift.category?.requiresOver21 === true;
  const vols = await prisma.volunteer.findMany({ where: { id: { in: volunteerIds } } });
  const volById = new Map(vols.map((v) => [v.id, v]));

  for (const vid of volunteerIds) {
    try {
      const vol = volById.get(vid);
      if (needs21 && vol?.isOver21 !== true) {
        results.push({
          volunteerId: vid,
          name: vol?.name,
          status: "error",
          error: `${vol?.name ?? "This volunteer"} can't be assigned to ${shift.title}: it requires 21+ and their age is ${vol?.isOver21 === false ? "under 21" : "not confirmed"}.`,
        });
        continue;
      }

      const existing = await prisma.assignment.findUnique({
        where: { volunteerId_shiftId: { volunteerId: vid, shiftId } },
      });
      if (existing && existing.status === "confirmed") {
        results.push({ volunteerId: vid, name: vol?.name, status: "already" });
        continue;
      }
      const assignedStation = pickStation();
      if (existing) {
        await prisma.assignment.update({
          where: { id: existing.id },
          data: {
            status: "confirmed",
            assignedBy: "admin",
            ...(assignedStation !== undefined ? { stationIndex: assignedStation } : {}),
          },
        });
      } else {
        await prisma.assignment.create({
          data: {
            volunteerId: vid,
            shiftId,
            status: "confirmed",
            assignedBy: "admin",
            ...(assignedStation !== undefined ? { stationIndex: assignedStation } : {}),
          },
        });
      }
      results.push({ volunteerId: vid, status: "added" });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      results.push({ volunteerId: vid, status: "error", error: err });
    }
  }

  const rejected = results.filter((r) => r.status === "error");
  return NextResponse.json({
    added: results.filter((r) => r.status === "added").length,
    already: results.filter((r) => r.status === "already").length,
    errors: rejected.length,
    // Surfaced so the caller can tell the user WHO was rejected and why,
    // instead of silently reporting a smaller number than expected.
    rejectedReasons: rejected.map((r) => r.error).filter(Boolean),
    results,
  });
}
