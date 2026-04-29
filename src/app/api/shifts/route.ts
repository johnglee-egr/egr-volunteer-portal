import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

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
  return NextResponse.json(shifts);
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

  const shift = await prisma.shift.create({
    data: {
      title: data.title,
      description: data.description,
      date: new Date(data.date),
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
