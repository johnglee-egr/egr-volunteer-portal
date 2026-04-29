import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const requests = await prisma.pairRequest.findMany({
    include: { requester: true, partner: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(requests);
}

export async function POST(req: NextRequest) {
  const { requesterId, partnerName, partnerEmail, partnerPhone, shiftId, message } = await req.json();

  // Find partner by name
  let partner = await prisma.volunteer.findFirst({
    where: { name: { equals: partnerName } },
  });

  // If partner doesn't exist, create them — but require a phone number so
  // we can send them shift reminders just like every other volunteer.
  if (!partner) {
    if (!partnerPhone) {
      return NextResponse.json(
        { error: `Could not find volunteer named "${partnerName}". Please provide their phone number (required) so we can register them.` },
        { status: 404 }
      );
    }

    // Check if a volunteer already exists with same name + same phone
    partner = await prisma.volunteer.findFirst({
      where: {
        name: { equals: partnerName },
        phone: { equals: partnerPhone },
      },
    });

    if (!partner) {
      partner = await prisma.volunteer.create({
        data: {
          name: partnerName,
          email: partnerEmail || null,
          phone: partnerPhone,
        },
      });
    }
  }

  const pairRequest = await prisma.pairRequest.create({
    data: {
      requesterId,
      partnerId: partner.id,
      shiftId: shiftId || null,
      message: message || null,
    },
    include: { requester: true, partner: true },
  });

  return NextResponse.json(pairRequest, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const { id, status } = await req.json();
  const request = await prisma.pairRequest.update({
    where: { id },
    data: { status },
    include: { requester: true, partner: true },
  });
  return NextResponse.json(request);
}
