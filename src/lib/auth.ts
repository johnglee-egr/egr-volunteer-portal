import { cookies } from "next/headers";

const ADMIN_COOKIE = "harvest_admin_session";

export async function isAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get(ADMIN_COOKIE)?.value === "authenticated";
}

export function verifyPassword(password: string): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    console.error("[auth] ADMIN_PASSWORD env var is not set — login will always fail.");
    return false;
  }
  return password === adminPassword;
}

/** Call at the top of any admin-only API route handler. Returns a 401 response if not authenticated. */
export async function requireAdmin(): Promise<Response | null> {
  const authed = await isAdmin();
  if (!authed) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}
