import nodemailer from "nodemailer";
import { prisma } from "./db";
import { fmt12 } from "./formatters";
import { buildShiftEvent, buildGoogleCalendarUrl, generateICS } from "./ics";

// ── Low-level send functions ─────────────────────────────────────────────────

interface EmailCalendarOptions {
  /** Raw ICS file content to attach */
  icsContent?: string;
  /** Google Calendar deep-link to embed as a button */
  googleCalUrl?: string;
  /** Direct .ics download URL to embed as a button (for non-Google clients) */
  icsUrl?: string;
}

function buildEmailHTML(textBody: string, cal?: EmailCalendarOptions): string {
  const baseHtml = textBody.replace(/\n/g, "<br>");
  if (!cal?.googleCalUrl && !cal?.icsUrl) return baseHtml;

  const btnStyle =
    "display:inline-block;padding:10px 18px;border-radius:6px;font-size:14px;font-weight:600;text-decoration:none;color:#ffffff;";

  const googleBtn = cal.googleCalUrl
    ? `<a href="${cal.googleCalUrl}" style="${btnStyle}background:#4285f4;">&#x1F4C5; Add to Google Calendar</a>`
    : "";

  const icsBtn = cal.icsUrl
    ? `<a href="${cal.icsUrl}" style="${btnStyle}background:#6c757d;margin-left:8px;">&#x1F4C5; Download (.ics)</a>`
    : "";

  return `${baseHtml}
<br><br>
<div style="margin-top:8px;padding:16px;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;display:inline-block;">
  <p style="margin:0 0 10px 0;font-size:14px;color:#92400e;font-weight:600;">📅 Add your shift to your calendar</p>
  <div>${googleBtn}${icsBtn}</div>
</div>`;
}

export async function sendEmail(
  to: string,
  subject: string,
  message: string,
  cal?: EmailCalendarOptions
) {
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
      html: buildEmailHTML(message, cal),
      ...(cal?.icsContent
        ? {
            attachments: [
              {
                filename: "volunteer-shift.ics",
                content: cal.icsContent,
                contentType: "text/calendar; method=PUBLISH",
              },
            ],
          }
        : {}),
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
        timeZone: "UTC", // shift.date is stored as UTC midnight — display as-is
      })
    : "(date TBD)";

  const timeStr = shift?.startTime && shift?.endTime
    ? `${fmt12(shift.startTime)} – ${fmt12(shift.endTime)}`
    : "(time TBD)";

  return text
    .replace(/\{volunteer_name\}/g, volunteer.name)
    .replace(/\{shift_title\}/g, shift?.title || "your shift")
    .replace(/\{shift_date\}/g, dateStr)
    .replace(/\{shift_time\}/g, timeStr)
    .replace(/\{portal_url\}/g, portalUrl);
}

// ── Standard shift reminder (used by scheduler + manual shift buttons) ───────

export async function sendReminder(
  volunteer: { name: string; email?: string | null; phone?: string | null; contactPref?: string | null },
  shift: { title: string; date: Date; startTime: string; endTime: string },
  /** Assignment ID — enables calendar invite attachments + download links */
  assignmentId?: string
) {
  // Try to use the "Shift Reminder" template from the database; fall back to a
  // sensible hardcoded default that uses the correct festival name.
  let templateBody =
    'Hi {volunteer_name}!\n\nReminder: You\'re signed up for "{shift_title}" at the EGR Harvest + Beer Festival.\n\nDate: {shift_date}\nTime: {shift_time}\n\nThank you for volunteering!';
  let templateSubject = `Volunteer Reminder: ${shift.title}`;

  try {
    const tpl = await prisma.notificationTemplate.findFirst({
      where: { name: "Shift Reminder" },
    });
    if (tpl) {
      templateBody = tpl.body;
      if (tpl.subject) templateSubject = applyMerge(tpl.subject, volunteer, shift);
    }
  } catch {
    // Template lookup failure is non-fatal — use the hardcoded fallback
  }

  const message = applyMerge(templateBody, volunteer, shift);

  // Determine which channels to use based on the volunteer's preference
  const pref = volunteer.contactPref || "both";
  const wantEmail = (pref === "both" || pref === "email") && !!volunteer.email;
  const wantSMS   = (pref === "both" || pref === "sms")   && !!volunteer.phone;

  // Build calendar helpers when we have an assignment ID
  let cal: EmailCalendarOptions | undefined;
  let smsCalLine = "";

  if (assignmentId) {
    const portalUrl = process.env.NEXT_PUBLIC_FESTIVAL_SITE_URL
      ? `${process.env.NEXT_PUBLIC_FESTIVAL_SITE_URL}/volunteer`
      : "https://volunteers.egrharvestfest.com/volunteer";

    const event = buildShiftEvent(assignmentId, shift, volunteer.name, portalUrl);
    const googleCalUrl = buildGoogleCalendarUrl(event);
    const icsContent = generateICS(event);

    const siteUrl = process.env.NEXT_PUBLIC_FESTIVAL_SITE_URL || "https://volunteers.egrharvestfest.com";
    const icsUrl = `${siteUrl}/api/calendar/${assignmentId}`;

    cal = { icsContent, googleCalUrl, icsUrl };
    smsCalLine = `\n\n📅 Add to calendar: ${icsUrl}`;
  }

  const results = [];
  if (wantEmail) {
    results.push(await sendEmail(volunteer.email!, templateSubject, message, cal));
  }
  if (wantSMS) {
    results.push(await sendSMS(volunteer.phone!, message + smsCalLine));
  }
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
      // groupValue format: "HH:MM-HH:MM" — use regex to avoid splitting on colons
      if (!groupValue) return [];
      const match = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(groupValue);
      if (!match) return [];
      const [, startStr, endStr] = match;
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
  if (volunteers.length === 0) return { sent: 0, volunteerCount: 0 };

  // Batch-fetch all confirmed assignments for the resolved volunteers to avoid N+1 queries
  const volunteerIds = volunteers.map((v) => v.id);
  const allAssignments = await prisma.assignment.findMany({
    where: { volunteerId: { in: volunteerIds }, status: "confirmed" },
    include: { shift: true },
    orderBy: { createdAt: "asc" },
  });
  // Build a map: volunteerId → first confirmed shift (for merge tags)
  const shiftByVol = new Map<string, typeof allAssignments[0]["shift"]>();
  for (const a of allAssignments) {
    if (!shiftByVol.has(a.volunteerId)) shiftByVol.set(a.volunteerId, a.shift);
  }

  let sent = 0;
  let reachable = 0;

  for (const vol of volunteers) {
    const shift = shiftByVol.get(vol.id) ?? null;
    const body = applyMerge(template.body, vol, shift);
    const subject = applyMerge(template.subject || "EGR Harvest + Beer Festival", vol, shift);

    // Intersect template channel with the volunteer's own contact preference
    const pref = (vol as { contactPref?: string | null }).contactPref || "both";
    const canEmail = (template.channel === "email" || template.channel === "both")
                  && (pref === "email" || pref === "both")
                  && !!vol.email;
    const canSMS   = (template.channel === "sms"   || template.channel === "both")
                  && (pref === "sms"   || pref === "both")
                  && !!vol.phone;

    if (!canEmail && !canSMS) continue; // no reachable contact — skip silently
    reachable++;

    if (canEmail) {
      const r = await sendEmail(vol.email!, subject, body);
      if (r.success) sent++;
    }
    if (canSMS) {
      const r = await sendSMS(vol.phone!, body);
      if (r.success) sent++;
    }
  }

  return { sent, volunteerCount: volunteers.length, reachable };
}
