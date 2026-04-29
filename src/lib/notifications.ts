import nodemailer from "nodemailer";
import { prisma } from "./db";

export async function sendEmail(to: string, subject: string, message: string) {
  const host = process.env.SMTP_HOST;
  if (!host) {
    console.log(`[EMAIL MOCK] To: ${to}, Subject: ${subject}, Message: ${message}`);
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

export async function sendReminder(
  volunteer: { name: string; email?: string | null; phone?: string | null },
  shift: { title: string; date: Date; startTime: string; endTime: string }
) {
  const dateStr = new Date(shift.date).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const message = `Hi ${volunteer.name}!\n\nReminder: You're signed up for "${shift.title}" at the Harvest Beer Festival.\n\nDate: ${dateStr}\nTime: ${shift.startTime} - ${shift.endTime}\n\nThank you for volunteering!`;

  const results = [];

  if (volunteer.email) {
    results.push(await sendEmail(volunteer.email, `Volunteer Reminder: ${shift.title}`, message));
  }
  if (volunteer.phone) {
    results.push(await sendSMS(volunteer.phone, message));
  }

  return results;
}
