import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  const { name, contact } = await req.json();

  if (!name || !contact) {
    return NextResponse.json({ error: "Name and contact (email or phone) required" }, { status: 400 });
  }

  const volunteer = await prisma.volunteer.findFirst({
    where: {
      name: { equals: name },
      OR: [
        { email: { equals: contact } },
        { phone: { equals: contact } },
      ],
    },
    include: {
      assignments: {
        where: { status: { in: ["confirmed", "pending", "denied"] } },
        include: { shift: true },
      },
      pairRequests: {
        include: { partner: true },
      },
    },
  });

  if (!volunteer) {
    return NextResponse.json({ error: "Volunteer not found" }, { status: 404 });
  }

  return NextResponse.json(volunteer);
}
