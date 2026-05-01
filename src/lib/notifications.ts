import nodemailer from "nodemailer";
import { prisma } from "./db";

// ── Low-level send functions ─────────────────────────────────────────────────

export async function sendEmail(to: string, subject: string, message: string) {
  const host = process.env.SMTP_HOST;
  if (!host) {
    console.log(`[EMAIL MOCK] To: ${to}, Subject: ${subject}`);
    await prisma.notification.create({
      data: { type: "email", recipient: to, subject, message, status: "sent", sentAt: new Date() },
    });
    return { success: true, mock: true };
  }

  const transporter = nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || "587"),
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text: message,
      html: message.replace(/\n/g, "<br>"),
    });
    await prisma.notification.create({
      data: { type: "email", recipient: to, subject, message, status: "sent", sentAt: new Date() },
    });
    return { success: true };
  } catch (error) {
    await prisma.notification.create({
      data: { type: "email", recipient: to, subject, message, status: "failed" },
    });
    return { success: false, error };
  }
}

export async function sendSMS(to: string, message: string) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    console.log(`[SMS MOCK] To: ${to}, Message: ${message}`);
    await prisma.notification.create({
      data: { type: "sms", recipient: to, message, status: "sent", sentAt: new Date() },
    });
    return { success: true, mock: true };
  }

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
        },
        body: new URLSearchParams({ To: to, From: fromNumber, Body: message }),
      }
    );
    if (!response.ok) throw new Error(`Twilio error: ${response.status}`);
    await prisma.notification.create({
      data: { type: "sms", recipient: to, message, status: "sent", sentAt: new Date() },
    });
    return { success: true };
  } catch (error) {
    await prisma.notification.create({
      data: { type: "sms", recipient: to, message, status: "failed" },
    });
    return { success: false, error };
  }
}

// ── Merge tags ───────────────────────────────────────────────────────────────

export function applyMerge(
  text: string,
  volunteer: { name: string; email?: string | null; phone?: string | null },
  shift?: { title?: string; date?: Date; startTime?: string; endTime?: string } | null
) {
  const portalUrl = process.env.NEXT_PUBLIC_FESTIVAL_SITE_URL
    ? `${process.env.NEXT_PUBLIC_FESTIVAL_SITE_URL}/volunteer`
    : "https://volunteers.egrharvestfest.com/volunteer";

  const dateStr = shift?.date
    ? new Date(shift.date).toLocaleDateString("en-US", {
        weekday: "long", month: "long", day: "numeric", year: "numeric",
      })
    : "";
  const timeStr = shift?.startTime && shift?.endTime
    ? `${fmt12(shift.startTime)} – ${fmt12(shift.endTime)}`
    : "";

  return text
    .replace(/\{volunteer_name\}/g, volunteer.name)
    .replace(/\{shift_title\}/g, shift?.title || "your shift")
    .replace(/\{shift_date\}/g, dateStr)
    .replace(/\{shift_time\}/g, timeStr)
    .replace(/\{portal_url\}/g, portalUrl);
}

function fmt12(t: string) {
  const [hStr, mStr] = t.split(":");
  let h = parseInt(hStr);
  const m = mStr || "00";
  const ampm = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m} ${ampm}`;
}

// ── Standard shift reminder (used by scheduler + manual shift buttons) ───────

export async function sendReminder(
  volunteer: { name: string; email?: string | null; phone?: string | null },
  shift: { title: string; date: Date; startTime: string; endTime: string }
) {
  const message = applyMerge(
    "Hi {volunteer_name}!\n\nReminder: You're signed up for \"{shift_title}\" at the Harvest Beer Festival.\n\nDate: {shift_date}\nTime: {shift_time}\n\nThank you for volunteering!",
    volunteer,
    shift
  );

  const results = [];
  if (volunteer.email) results.push(await sendEmail(volunteer.email, `Volunteer Reminder: ${shift.title}`, message));
  if (volunteer.phone) results.push(await sendSMS(volunteer.phone, message));
  return results;
}

// ── Resolve a recipient group to a list of volunteers ────────────────────────

export async function resolveGroup(groupType: string, groupValue?: string | null) {
  switch (groupType) {
    case "all":
      return prisma.volunteer.findMany({ orderBy: { name: "asc" } });

    case "category": {
      if (!groupValue) return [];
      const rows = await prisma.assignment.findMany({
        where: { status: "confirmed", shift: { categoryId: groupValue } },
        include: { volunteer: true },
        distinct: ["volunteerId"],
      });
      return rows.map((r) => r.volunteer);
    }

    case "timerange": {
      // groupValue format: "HH:MM-HH:MM"
      if (!groupValue) return [];
      const [startStr, endStr] = groupValue.split("-");
      const rows = await prisma.assignment.findMany({
        where: {
          status: "confirmed",
          shift: { startTime: { gte: startStr, lte: endStr } },
        },
        include: { volunteer: true },
        distinct: ["volunteerId"],
      });
      return rows.map((r) => r.volunteer);
    }

    case "role":
      if (!groupValue) return [];
      return prisma.volunteer.findMany({ where: { role: groupValue }, orderBy: { name: "asc" } });

    case "team": {
      if (!groupValue) return [];
      const members = await prisma.teamMember.findMany({
        where: { teamId: groupValue },
        include: { volunteer: true },
      });
      return members.map((m) => m.volunteer);
    }

    case "unassigned": {
      const all = await prisma.volunteer.findMany({
        include: { assignments: { where: { status: "confirmed" } } },
        orderBy: { name: "asc" },
      });
      return all.filter((v) => v.assignments.length === 0);
    }

    default:
      return [];
  }
}

// ── Send a template to a group ───────────────────────────────────────────────

export async function sendToGroup(templateId: string, groupType: string, groupValue?: string | null) {
  const template = await prisma.notificationTemplate.findUnique({ where: { id: templateId } });
  if (!template) throw new Error("Template not found");

  const volunteers = await resolveGroup(groupType, groupValue);
  const results = [];

  for (const vol of volunteers) {
    // Use their first confirmed shift for merge tags (if available)
    const assignment = await prisma.assignment.findFirst({
      where: { volunteerId: vol.id, status: "confirmed" },
      include: { shift: true },
    });
    const shift = assignment?.shift ?? null;

    const body = applyMerge(template.body, vol, shift);
    const subject = applyMerge(template.subject || "EGR Harvest + Beer Festival", vol, shift);

    if ((template.channel === "email" || template.channel === "both") && vol.email) {
      results.push(await sendEmail(vol.email, subject, body));
    }
    if ((template.channel === "sms" || template.channel === "both") && vol.phone) {
      results.push(await sendSMS(vol.phone, body));
    }
  }

  return { sent: results.length, volunteerCount: volunteers.length };
}
