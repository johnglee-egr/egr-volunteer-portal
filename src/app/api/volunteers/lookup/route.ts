import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { phoneDigits } from "@/lib/formatters";

export async function POST(req: NextRequest) {
  const { name, contact } = await req.json();

  if (!name || !contact) {
    return NextResponse.json({ error: "Name and contact (email or phone) required" }, { status: 400 });
  }

  // Fetch all volunteers with this name, then match by email (exact) or phone
  // (digits-only comparison so any format works: 123-456-7890, (123) 456-7890, etc.)
  const candidates = await prisma.volunteer.findMany({
    where: { name: { equals: name } },
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

  const inputDigits = phoneDigits(contact);
  const volunteer = candidates.find((v) => {
    const emailMatch = v.email && v.email.toLowerCase() === contact.toLowerCase();
    const phoneMatch = v.phone && phoneDigits(v.phone) === inputDigits;
    return emailMatch || phoneMatch;
  });

  if (!volunteer) {
    return NextResponse.json({ error: "Volunteer not found" }, { status: 404 });
  }

  return NextResponse.json(volunteer);
}
