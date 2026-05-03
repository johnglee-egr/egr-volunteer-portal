import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export async function GET() {
  const categories = await prisma.category.findMany({
    include: { shifts: true },
    orderBy: { sortOrder: "asc" },
  });
  return NextResponse.json(categories);
}

export async function POST(req: NextRequest) {
  const unauthed = await requireAdmin(); if (unauthed) return unauthed;
  const data = await req.json();
  if (!data.name) {
    return NextResponse.json({ error: "Category name is required" }, { status: 400 });
  }
  // Auto-assign sort order to end
  const maxOrder = await prisma.category.aggregate({ _max: { sortOrder: true } });
  const nextOrder = (maxOrder._max.sortOrder ?? -1) + 1;

  const category = await prisma.category.create({
    data: {
      name: data.name,
      description: data.description || null,
      color: data.color || null,
      sortOrder: nextOrder,
      type: data.type || "throughout",
      stationCount: data.stationCount || 1,
      volsPerStation: data.volsPerStation || 1,
      requiresOver21: !!data.requiresOver21,
    },
  });
  return NextResponse.json(category, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const unauthed = await requireAdmin(); if (unauthed) return unauthed;
  const { id, reorder, ...data } = await req.json();

  // Bulk reorder: expects reorder = [{id, sortOrder}, ...]
  if (reorder && Array.isArray(reorder)) {
    const updates = reorder.map((item: { id: string; sortOrder: number }) =>
      prisma.category.update({
        where: { id: item.id },
        data: { sortOrder: item.sortOrder },
      })
    );
    await prisma.$transaction(updates);
    const categories = await prisma.category.findMany({
      include: { shifts: true },
      orderBy: { sortOrder: "asc" },
    });
    return NextResponse.json(categories);
  }

  // Single update — only pass known fields
  try {
    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.color !== undefined) updateData.color = data.color;
    if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.stationCount !== undefined) updateData.stationCount = data.stationCount;
    if (data.volsPerStation !== undefined) updateData.volsPerStation = data.volsPerStation;
    if (data.requiresOver21 !== undefined) updateData.requiresOver21 = !!data.requiresOver21;

    const category = await prisma.category.update({ where: { id }, data: updateData });
    return NextResponse.json(category);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update category";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const unauthed = await requireAdmin(); if (unauthed) return unauthed;
  const { id } = await req.json();
  try {
    await prisma.category.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Cannot delete category that has shifts assigned to it. Remove shifts first." },
      { status: 400 }
    );
  }
}
