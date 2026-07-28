import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export async function GET() {
  let settings = await prisma.festivalSettings.findUnique({ where: { id: "main" } });
  if (!settings) {
    settings = await prisma.festivalSettings.create({
      data: {
        id: "main",
        festivalName: "EGR Harvest + Beer Festival",
      },
    });
  }
  return NextResponse.json(settings);
}

export async function PUT(req: NextRequest) {
  const unauthed = await requireAdmin(); if (unauthed) return unauthed;
  const body = await req.json();
  // Allowlist accepted fields to prevent raw body injection
  const allowed = ["festivalName", "festivalDate", "festivalTime", "contactEmail", "contactPhone", "welcomeMessage"];
  const data: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) data[key] = body[key];
  }
  const settings = await prisma.festivalSettings.upsert({
    where: { id: "main" },
    update: data,
    create: { id: "main", ...data },
  });

  // When the festival date changes, sync all shift dates to match
  if (data.festivalDate && typeof data.festivalDate === "string") {
    const shiftDate = new Date(data.festivalDate + "T00:00:00.000Z");
    await prisma.shift.updateMany({ data: { date: shiftDate } });
  }

  return NextResponse.json(settings);
}
