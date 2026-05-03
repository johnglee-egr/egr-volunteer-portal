import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendReminder, sendEmail, sendSMS, sendToGroup } from "@/lib/notifications";

export async function GET() {
  const notifications = await prisma.notification.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json(notifications);
}

// Send reminders to volunteers for their shifts
export async function POST(req: NextRequest) {
  const { type, shiftId, volunteerId, customMessage, templateId, groupType, groupValue } = await req.json();

  if (type === "reminder" && shiftId) {
    // Send reminders to all volunteers on a shift (with calendar invite)
    const assignments = await prisma.assignment.findMany({
      where: { shiftId, status: "confirmed" },
      include: { volunteer: true, shift: true },
    });

    const results = [];
    for (const assignment of assignments) {
      const result = await sendReminder(assignment.volunteer, assignment.shift, assignment.id);
      results.push({ volunteer: assignment.volunteer.name, result });
    }
    return NextResponse.json({ sent: results.length, results });
  }

  if (type === "reminder" && volunteerId) {
    // Send reminders for all of a volunteer's confirmed shifts (with calendar invites)
    const assignments = await prisma.assignment.findMany({
      where: { volunteerId, status: "confirmed" },
      include: { volunteer: true, shift: true },
    });

    const results = [];
    for (const assignment of assignments) {
      const result = await sendReminder(assignment.volunteer, assignment.shift, assignment.id);
      results.push({ shift: assignment.shift.title, result });
    }
    return NextResponse.json({ sent: results.length, results });
  }

  if (type === "broadcast" && customMessage) {
    // Send a custom message to all volunteers, respecting their contact preference
    const volunteers = await prisma.volunteer.findMany();
    const results = [];
    for (const v of volunteers) {
      const pref = v.contactPref || "both";
      if ((pref === "email" || pref === "both") && v.email) {
        results.push(await sendEmail(v.email, "EGR Harvest + Beer Festival Update", customMessage));
      }
      if ((pref === "sms" || pref === "both") && v.phone) {
        results.push(await sendSMS(v.phone, customMessage));
      }
    }
    return NextResponse.json({ sent: results.length, results });
  }

  if (type === "group" && templateId && groupType) {
    // Send a template to a resolved recipient group
    const result = await sendToGroup(templateId, groupType, groupValue ?? null);
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: "Invalid notification type" }, { status: 400 });
}
