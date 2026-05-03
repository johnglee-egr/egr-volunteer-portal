import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export async function GET() {
  const unauthed = await requireAdmin();
  if (unauthed) return unauthed;

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

  // Allowlist fields to prevent raw body injection
  const schedule = await prisma.notificationSchedule.create({
    data: {
      name: name.trim(),
      templateId: data.templateId,
      groupType: data.groupType,
      groupValue: data.groupValue ?? null,
      relativeType: data.relativeType ?? null,
      relativeValue: data.relativeValue ?? null,
      relativeTime: data.relativeTime ?? null,
      sendAt: data.sendAt ? new Date(data.sendAt) : null,
      isAutomatic: !!data.isAutomatic,
      status: "pending", // always start pending — never let caller set status
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

  // Allowlist fields to prevent raw body injection
  const updateData: Record<string, unknown> = {};
  const allowed = ["name", "templateId", "groupType", "groupValue", "relativeType", "relativeValue", "relativeTime", "sendAt", "isAutomatic", "status"];
  for (const key of allowed) {
    if (key in data) {
      if (key === "sendAt") updateData[key] = data[key] ? new Date(data[key]) : null;
      else updateData[key] = data[key];
    }
  }
  // Never allow status to jump back to pending from sent/failed via this endpoint
  if (updateData.status && !["pending", "cancelled"].includes(updateData.status as string)) {
    delete updateData.status;
  }

  const schedule = await prisma.notificationSchedule.update({
    where: { id },
    data: updateData,
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
