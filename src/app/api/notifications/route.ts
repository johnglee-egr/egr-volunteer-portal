import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendReminder, sendEmail, sendSMS } from "@/lib/notifications";

export async function GET() {
  const notifications = await prisma.notification.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json(notifications);
}

// Send reminders to volunteers for their shifts
export async function POST(req: NextRequest) {
  const { type, shiftId, volunteerId, customMessage } = await req.json();

  if (type === "reminder" && shiftId) {
    // Send reminders to all volunteers on a shift
    const assignments = await prisma.assignment.findMany({
      where: { shiftId, status: "confirmed" },
      include: { volunteer: true, shift: true },
    });

    const results = [];
    for (const assignment of assignments) {
      const result = await sendReminder(assignment.volunteer, assignment.shift);
      results.push({ volunteer: assignment.volunteer.name, result });
    }
    return NextResponse.json({ sent: results.length, results });
  }

  if (type === "reminder" && volunteerId) {
    // Send reminders for all of a volunteer's shifts
    const assignments = await prisma.assignment.findMany({
      where: { volunteerId, status: "confirmed" },
      include: { volunteer: true, shift: true },
    });

    const results = [];
    for (const assignment of assignments) {
      const result = await sendReminder(assignment.volunteer, assignment.shift);
      results.push({ shift: assignment.shift.title, result });
    }
    return NextResponse.json({ sent: results.length, results });
  }

  if (type === "broadcast" && customMessage) {
    // Send a custom message to all volunteers
    const volunteers = await prisma.volunteer.findMany();
    const results = [];
    for (const v of volunteers) {
      if (v.email) {
        results.push(await sendEmail(v.email, "Harvest Beer Festival Update", customMessage));
      }
      if (v.phone) {
        results.push(await sendSMS(v.phone, customMessage));
      }
    }
    return NextResponse.json({ sent: results.length, results });
  }

  return NextResponse.json({ error: "Invalid notification type" }, { status: 400 });
}
