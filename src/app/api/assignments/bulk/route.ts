import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// POST /api/assignments/bulk
//   { shiftId, volunteerIds: string[], stationIndex? }
// Admin-only — bypasses capacity, auto-confirms.
export async function POST(req: NextRequest) {
  const { shiftId, volunteerIds, stationIndex } = await req.json() as {
    shiftId: string;
    volunteerIds: string[];
    stationIndex?: number;
  };

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

  const results: { volunteerId: string; status: "added" | "already" | "error"; error?: string }[] = [];

  for (const vid of volunteerIds) {
    try {
      const existing = await prisma.assignment.findUnique({
        where: { volunteerId_shiftId: { volunteerId: vid, shiftId } },
      });
      if (existing && existing.status === "confirmed") {
        results.push({ volunteerId: vid, status: "already" });
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

  return NextResponse.json({
    added: results.filter((r) => r.status === "added").length,
    already: results.filter((r) => r.status === "already").length,
    errors: results.filter((r) => r.status === "error").length,
    results,
  });
}
