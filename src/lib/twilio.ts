import crypto from "crypto";

/**
 * Validate Twilio's X-Twilio-Signature header.
 *
 * The webhook endpoints are necessarily public — Twilio has to reach them — and
 * they mutate real state (opt-out flags, delivery records). Without this check
 * anyone who guessed the URL could opt volunteers out of their reminders or
 * forge delivery receipts, so an unsigned request is rejected.
 *
 * Twilio's scheme: concatenate the full request URL with every POST parameter
 * sorted by key (key immediately followed by value), HMAC-SHA1 it with the
 * account auth token, then base64. See Twilio "Validating Signatures".
 */
export function validateTwilioSignature(
  signature: string | null,
  url: string,
  params: Record<string, string>
): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token || !signature) return false;

  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);

  const expected = crypto
    .createHmac("sha1", token)
    .update(Buffer.from(payload, "utf-8"))
    .digest("base64");

  // Constant-time compare; timingSafeEqual throws on length mismatch.
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * The public URL Twilio used to reach us. Signature validation hashes the exact
 * URL Twilio signed, so this must match what was configured in the Console —
 * including protocol and host, which differ from the request object behind
 * Vercel's proxy.
 */
export function publicWebhookUrl(path: string): string {
  const base =
    process.env.NEXT_PUBLIC_FESTIVAL_SITE_URL?.replace(/\/$/, "") ||
    "https://volunteers.egrharvestfest.com";
  return `${base}${path}`;
}

/** Read an x-www-form-urlencoded Twilio webhook body into a plain object. */
export async function readTwilioForm(req: Request): Promise<Record<string, string>> {
  const text = await req.text();
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(text)) params[k] = v;
  return params;
}
