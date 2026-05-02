import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export async function GET() {
  const schedules = await prisma.notificationSchedule.findMany({
    include: { template: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(schedules);
}

export async function POST(req: NextRequest) {
  const unauthed = await requireAdmin();
  if (unauthed) return unauthed;

  const data = await req.json();
  const { name, templateId, groupType, relativeType, sendAt } = data;

  if (!name?.trim()) return NextResponse.json({ error: "Schedule name is required." }, { status: 400 });
  if (!templateId) return NextResponse.json({ error: "templateId is required." }, { status: 400 });
  if (!groupType) return NextResponse.json({ error: "groupType is required." }, { status: 400 });

  // Validate templateId exists
  const template = await prisma.notificationTemplate.findUnique({ where: { id: templateId } });
  if (!template) return NextResponse.json({ error: "Template not found." }, { status: 404 });

  // Validate fixed-type has a sendAt
  if (relativeType === "fixed" && !sendAt) {
    return NextResponse.json({ error: "A specific date & time is required for fixed schedules." }, { status: 400 });
  }

  const schedule = await prisma.notificationSchedule.create({
    data: {
      ...data,
      name: name.trim(),
    },
    include: { template: true },
  });
  return NextResponse.json(schedule, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const unauthed = await requireAdmin();
  if (unauthed) return unauthed;

  const { id, ...data } = await req.json();
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  const schedule = await prisma.notificationSchedule.update({
    where: { id },
    data,
    include: { template: true },
  });
  return NextResponse.json(schedule);
}

export async function DELETE(req: NextRequest) {
  const unauthed = await requireAdmin();
  if (unauthed) return unauthed;

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  await prisma.notificationSchedule.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
