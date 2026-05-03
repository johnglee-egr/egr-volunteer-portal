import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

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
  const unauthed = await requireAdmin();
  if (unauthed) return unauthed;

  let templates = await prisma.notificationTemplate.findMany({ orderBy: { createdAt: "asc" } });
  if (templates.length === 0) {
    await prisma.notificationTemplate.createMany({ data: PREBUILT });
    templates = await prisma.notificationTemplate.findMany({ orderBy: { createdAt: "asc" } });
  }
  return NextResponse.json(templates);
}

export async function POST(req: NextRequest) {
  const unauthed = await requireAdmin();
  if (unauthed) return unauthed;

  const { name, body, subject, channel } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Template name is required." }, { status: 400 });
  if (!body?.trim()) return NextResponse.json({ error: "Template body is required." }, { status: 400 });
  const validChannels = ["email", "sms", "both"];

  const template = await prisma.notificationTemplate.create({
    data: {
      name: name.trim(),
      subject: subject?.trim() || null,
      body: body.trim(),
      channel: validChannels.includes(channel) ? channel : "both",
      isPrebuilt: false, // clients can never set this
    },
  });
  return NextResponse.json(template, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const unauthed = await requireAdmin();
  if (unauthed) return unauthed;

  const { id, name, body, subject, channel } = await req.json();
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  const validChannels = ["email", "sms", "both"];
  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name.trim();
  if (subject !== undefined) updateData.subject = subject?.trim() || null;
  if (body !== undefined) updateData.body = body.trim();
  if (channel !== undefined) updateData.channel = validChannels.includes(channel) ? channel : "both";
  // isPrebuilt is never updated by clients

  const template = await prisma.notificationTemplate.update({ where: { id }, data: updateData });
  return NextResponse.json(template);
}

export async function DELETE(req: NextRequest) {
  const unauthed = await requireAdmin();
  if (unauthed) return unauthed;

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  await prisma.notificationTemplate.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
