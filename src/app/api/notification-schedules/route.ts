import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const schedules = await prisma.notificationSchedule.findMany({
    include: { template: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(schedules);
}

export async function POST(req: NextRequest) {
  const data = await req.json();
  const schedule = await prisma.notificationSchedule.create({
    data,
    include: { template: true },
  });
  return NextResponse.json(schedule, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const { id, ...data } = await req.json();
  const schedule = await prisma.notificationSchedule.update({
    where: { id },
    data,
    include: { template: true },
  });
  return NextResponse.json(schedule);
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  await prisma.notificationSchedule.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
