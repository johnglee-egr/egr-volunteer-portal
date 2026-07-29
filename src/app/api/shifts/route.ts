import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAdmin } from "@/lib/auth";

export async function GET() {
  const shifts = await prisma.shift.findMany({
    include: {
      category: true,
      assignments: {
        where: { status: "confirmed" },
        include: { volunteer: true },
      },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });

  // This endpoint is public — the volunteer portal reads it before anyone logs
  // in. It only needs names to render capacity, so strip contact details for
  // non-admin callers rather than publishing the roster's phones and emails.
  const callerIsAdmin = await isAdmin();
  if (callerIsAdmin) return NextResponse.json(shifts);

  const redacted = shifts.map((s) => ({
    ...s,
    assignments: s.assignments.map((a) => ({
      ...a,
      volunteer: {
        id: a.volunteer.id,
        name: a.volunteer.name,
        role: a.volunteer.role,
        isOver21: a.volunteer.isOver21,
      },
    })),
  }));
  return NextResponse.json(redacted);
}

export async function POST(req: NextRequest) {
  const data = await req.json();

  // Auto-generate station names if stationCount is provided
  let stationNames: string | undefined;
  if (data.stationCount && parseInt(data.stationCount) > 1) {
    const count = parseInt(data.stationCount);
    const names = Array.from({ length: count }, (_, i) => `Station ${i + 1}`);
    stationNames = JSON.stringify(names);
  }

  // Default to the festival date from settings if no date is provided
  let shiftDate: Date;
  if (data.date) {
    shiftDate = new Date(data.date);
  } else {
    const settings = await prisma.festivalSettings.findUnique({ where: { id: "main" } });
    shiftDate = settings?.festivalDate
      ? new Date(settings.festivalDate + "T00:00:00.000Z")
      : new Date();
  }

  const shift = await prisma.shift.create({
    data: {
      title: data.title,
      description: data.description,
      date: shiftDate,
      startTime: data.startTime,
      endTime: data.endTime,
      capacity: parseInt(data.capacity) || 1,
      categoryId: data.categoryId,
      ...(stationNames ? { stationNames } : {}),
    },
    include: { category: true },
  });
  return NextResponse.json(shift, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const { id, ...data } = await req.json();
  if (data.date) data.date = new Date(data.date);
  if (data.capacity) data.capacity = parseInt(data.capacity);
  const shift = await prisma.shift.update({
    where: { id },
    data,
  });
  return NextResponse.json(shift);
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  await prisma.shift.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
