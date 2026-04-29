import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function PUT(req: NextRequest) {
  const { shiftId, stationIndex, name } = await req.json();

  if (!shiftId || stationIndex === undefined || !name) {
    return NextResponse.json({ error: "shiftId, stationIndex, and name are required" }, { status: 400 });
  }

  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!shift) {
    return NextResponse.json({ error: "Shift not found" }, { status: 404 });
  }

  let stationNames: string[] = [];
  try {
    stationNames = shift.stationNames ? JSON.parse(shift.stationNames as string) : [];
  } catch {
    stationNames = [];
  }

  // If stationNames is empty or shorter than the requested index, fill with defaults
  // This handles shifts that were created before station names were saved
  if (stationIndex < 0) {
    return NextResponse.json({ error: "Invalid station index" }, { status: 400 });
  }

  while (stationNames.length <= stationIndex) {
    stationNames.push(`Station ${stationNames.length + 1}`);
  }

  stationNames[stationIndex] = name;

  const updated = await prisma.shift.update({
    where: { id: shiftId },
    data: { stationNames: JSON.stringify(stationNames) },
  });

  return NextResponse.json(updated);
}
