import { NextRequest, NextResponse } from "next/server";
import { verifyPassword, isAdmin } from "@/lib/auth";

/**
 * Session probe. The admin cookie is httpOnly, so the browser cannot read it —
 * without this the dashboard had no way to know a valid session already existed
 * and showed the login screen on every refresh.
 */
export async function GET() {
  return NextResponse.json({ authenticated: await isAdmin() });
}

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  if (verifyPassword(password)) {
    const response = NextResponse.json({ success: true });
    response.cookies.set("harvest_admin_session", "authenticated", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });
    return response;
  }
  return NextResponse.json({ error: "Invalid password" }, { status: 401 });
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete("harvest_admin_session");
  return response;
}
