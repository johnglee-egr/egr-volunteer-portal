import { cookies } from "next/headers";

const ADMIN_COOKIE = "harvest_admin_session";

export async function isAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get(ADMIN_COOKIE)?.value === "authenticated";
}

export function verifyPassword(password: string): boolean {
  return password === (process.env.ADMIN_PASSWORD || "egr");
}
