import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const PREBUILT: Array<{ name: string; subject: string; body: string; channel: string; isPrebuilt: boolean }> = [
  {
    name: "Shift Reminder",
    subject: "Reminder: Your Volunteer Shift — EGR Harvest + Beer Festival",
    body: "Hi {volunteer_name}!\n\nJust a friendly reminder that you're signed up to volunteer for {shift_title} on {shift_date} from {shift_time}.\n\nThank you for making the EGR Harvest + Beer Festival possible — we'll see you there!\n\nQuestions? Visit {portal_url}.",
    channel: "both",
    isPrebuilt: true,
  },
  {
    name: "Day-Of Reminder",
    subject: "Today's the Day — EGR Harvest + Beer Festival!",
    body: "Good morning {volunteer_name}!\n\nToday is the EGR Harvest + Beer Festival and your shift is {shift_title} starting at {shift_time}.\n\nGaslight Village, East Grand Rapids — see you soon and thank you for volunteering!",
    channel: "both",
    isPrebuilt: true,
  },
  {
    name: "General Announcement",
    subject: "EGR Harvest + Beer Festival — Important Update",
    body: "Hi {volunteer_name},\n\n[Your message here]\n\nThank you,\nEGR Harvest + Beer Festival Team",
    channel: "email",
    isPrebuilt: true,
  },
  {
    name: "No Shift Assigned",
    subject: "Don't forget to pick your shift!",
    body: "Hi {volunteer_name},\n\nYou're registered as a volunteer for the EGR Harvest + Beer Festival but haven't signed up for a shift yet. Spots fill up fast!\n\nVisit {portal_url} to pick your shift today.\n\nThank you,\nEGR Harvest + Beer Festival Team",
    channel: "both",
    isPrebuilt: true,
  },
  {
    name: "Thank You",
    subject: "Thank You for Volunteering!",
    body: "Hi {volunteer_name},\n\nThank you so much for volunteering at the EGR Harvest + Beer Festival! You are the heartbeat of this event and we truly couldn't do it without you.\n\nWe hope to see you again next year!\n\nWith gratitude,\nEGR Harvest + Beer Festival Team",
    channel: "both",
    isPrebuilt: true,
  },
];

export async function GET() {
  let templates = await prisma.notificationTemplate.findMany({ orderBy: { createdAt: "asc" } });
  if (templates.length === 0) {
    await prisma.notificationTemplate.createMany({ data: PREBUILT });
    templates = await prisma.notificationTemplate.findMany({ orderBy: { createdAt: "asc" } });
  }
  return NextResponse.json(templates);
}

export async function POST(req: NextRequest) {
  const data = await req.json();
  const template = await prisma.notificationTemplate.create({ data });
  return NextResponse.json(template, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const { id, ...data } = await req.json();
  const template = await prisma.notificationTemplate.update({ where: { id }, data });
  return NextResponse.json(template);
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  await prisma.notificationTemplate.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
