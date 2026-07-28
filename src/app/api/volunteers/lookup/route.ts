import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { phoneDigits } from "@/lib/formatters";

export async function POST(req: NextRequest) {
  const { name, contact } = await req.json();

  if (!name || !contact) {
    return NextResponse.json({ error: "Name and contact (email or phone) required" }, { status: 400 });
  }

  const include = {
    assignments: {
      where: { status: { in: ["confirmed", "pending", "denied"] } },
      include: { shift: true },
    },
    pairRequests: {
      include: { partner: true },
    },
  };

  const inputDigits = phoneDigits(contact);

  // Step 1: try name + contact match (exact name, any phone format or exact email)
  const namedCandidates = await prisma.volunteer.findMany({
    where: { name: { equals: name, mode: "insensitive" } },
    include,
  });
  const volunteer = namedCandidates.find((v) => {
    const emailMatch = v.email && v.email.toLowerCase() === contact.toLowerCase();
    const phoneMatch = v.phone && phoneDigits(v.phone) === inputDigits;
    return emailMatch || phoneMatch;
  });
  if (volunteer) return NextResponse.json(volunteer);

  // Step 2: fall back to phone-only match so a misspelled name doesn't block login
  const allByPhone = await prisma.volunteer.findMany({
    where: { phone: { not: null } },
    include,
  });
  const byPhone = allByPhone.find(
    (v) => v.phone && phoneDigits(v.phone) === inputDigits
  );
  if (byPhone) return NextResponse.json(byPhone);

  return NextResponse.json({ error: "Volunteer not found" }, { status: 404 });
}
