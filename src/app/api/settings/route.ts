import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

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
  const data = await req.json();
  const settings = await prisma.festivalSettings.upsert({
    where: { id: "main" },
    update: data,
    create: { id: "main", ...data },
  });
  return NextResponse.json(settings);
}
