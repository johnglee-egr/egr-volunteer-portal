import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { toCSV, fmt12, formatPhone } from "@/lib/csv";
import { requireAdmin } from "@/lib/auth";


/**
 * Age eligibility as it should read on a printed sheet. The station captain
 * holding paper on festival day needs to verify this for alcohol-service
 * shifts, and it was previously absent from every export.
 */
function ageLabel(isOver21: boolean | null | undefined): string {
  if (isOver21 === true) return "21+";
  if (isOver21 === false) return "Under 21";
  return "Not confirmed";
}

// GET /api/export?type=master|shift|volunteer|coverage&format=csv|html
//   shift requires shiftId, volunteer requires volunteerId
export async function GET(req: NextRequest) {
  const unauthed = await requireAdmin(); if (unauthed) return unauthed;
  const type = req.nextUrl.searchParams.get("type") || "master";
  const format = req.nextUrl.searchParams.get("format") || "csv";
  const shiftId = req.nextUrl.searchParams.get("shiftId") || undefined;
  const volunteerId = req.nextUrl.searchParams.get("volunteerId") || undefined;

  if (type === "master") return masterExport(format);
  if (type === "shift" && shiftId) return shiftExport(shiftId, format);
  if (type === "volunteer" && volunteerId) return volunteerExport(volunteerId, format);
  if (type === "volunteers") return volunteersExport(format);
  if (type === "coverage") return coverageExport(format);

  return NextResponse.json({ error: "Invalid export type or missing id" }, { status: 400 });
}

// ── Master sheet: every confirmed assignment, every shift, sorted by date/time
async function masterExport(format: string) {
  const assignments = await prisma.assignment.findMany({
    where: { status: "confirmed" },
    include: {
      volunteer: true,
      shift: { include: { category: true } },
    },
  });
  // Sort by date, then startTime, then category, then station
  assignments.sort((a, b) => {
    const da = new Date(a.shift.date).getTime();
    const db = new Date(b.shift.date).getTime();
    if (da !== db) return da - db;
    if (a.shift.startTime !== b.shift.startTime) return a.shift.startTime.localeCompare(b.shift.startTime);
    if (a.shift.category.name !== b.shift.category.name) return a.shift.category.name.localeCompare(b.shift.category.name);
    return (a.stationIndex ?? 0) - (b.stationIndex ?? 0);
  });

  const stationName = (shift: { stationNames: string | null }, idx: number | null | undefined): string => {
    if (idx === null || idx === undefined) return "";
    try {
      const names = shift.stationNames ? JSON.parse(shift.stationNames) : [];
      return names[idx] || `Station ${idx + 1}`;
    } catch { return `Station ${idx + 1}`; }
  };

  const rows = assignments.map((a) => ({
    Date: new Date(a.shift.date).toLocaleDateString("en-US"),
    Category: a.shift.category.name,
    Shift: a.shift.title,
    Start: fmt12(a.shift.startTime),
    End: fmt12(a.shift.endTime),
    Station: stationName(a.shift, a.stationIndex),
    Volunteer: a.volunteer.name,
    Email: a.volunteer.email || "",
    Phone: formatPhone(a.volunteer.phone),
    Role: a.volunteer.role === "team_lead" ? "Team Lead" : "Volunteer",
    "21+": ageLabel(a.volunteer.isOver21),
  }));

  if (format === "html") return printableHtml("Master Volunteer Schedule", rows);
  return csvResponse("master-schedule.csv", rows);
}

// ── Per-shift roster
async function shiftExport(shiftId: string, format: string) {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    include: {
      category: true,
      assignments: {
        where: { status: "confirmed" },
        include: { volunteer: true },
        orderBy: { stationIndex: "asc" },
      },
    },
  });
  if (!shift) return NextResponse.json({ error: "Shift not found" }, { status: 404 });

  let stationNames: string[] = [];
  try { stationNames = shift.stationNames ? JSON.parse(shift.stationNames) : []; } catch { /* ignore */ }

  const rows = shift.assignments.map((a) => ({
    Station: a.stationIndex != null ? (stationNames[a.stationIndex] || `Station ${a.stationIndex + 1}`) : "",
    Volunteer: a.volunteer.name,
    Email: a.volunteer.email || "",
    Phone: formatPhone(a.volunteer.phone),
    Role: a.volunteer.role === "team_lead" ? "Team Lead" : "Volunteer",
    "21+": ageLabel(a.volunteer.isOver21),
    "Checked In": "",
  }));

  const title = `${shift.category.name} — ${shift.title} (${new Date(shift.date).toLocaleDateString()}, ${fmt12(shift.startTime)}–${fmt12(shift.endTime)})`;
  if (format === "html") return printableHtml(title, rows);
  return csvResponse(`shift-${shift.title.replace(/\s+/g, "_")}.csv`, rows);
}

// ── One volunteer's complete schedule
async function volunteerExport(volunteerId: string, format: string) {
  const v = await prisma.volunteer.findUnique({
    where: { id: volunteerId },
    include: {
      assignments: {
        where: { status: "confirmed" },
        include: { shift: { include: { category: true } } },
      },
    },
  });
  if (!v) return NextResponse.json({ error: "Volunteer not found" }, { status: 404 });

  v.assignments.sort((a, b) => {
    const da = new Date(a.shift.date).getTime();
    const db = new Date(b.shift.date).getTime();
    if (da !== db) return da - db;
    return a.shift.startTime.localeCompare(b.shift.startTime);
  });

  const rows = v.assignments.map((a) => {
    let stations: string[] = [];
    try { stations = a.shift.stationNames ? JSON.parse(a.shift.stationNames) : []; } catch { /* ignore */ }
    return {
      Date: new Date(a.shift.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
      Category: a.shift.category.name,
      Shift: a.shift.title,
      Start: fmt12(a.shift.startTime),
      End: fmt12(a.shift.endTime),
      Station: a.stationIndex != null ? (stations[a.stationIndex] || `Station ${a.stationIndex + 1}`) : "",
    };
  });

  const title = `Schedule for ${v.name}`;
  if (format === "html") return printableHtml(title, rows, [`Email: ${v.email || "—"}`, `Phone: ${formatPhone(v.phone) || "—"}`, `Age: ${ageLabel(v.isOver21)}`]);
  return csvResponse(`schedule-${v.name.replace(/\s+/g, "_")}.csv`, rows);
}

// ── All volunteers contact list
async function volunteersExport(format: string) {
  const [vols, pairRequests, teamMembers] = await Promise.all([
    prisma.volunteer.findMany({
      orderBy: { name: "asc" },
      include: {
        assignments: {
          where: { status: "confirmed" },
          include: { shift: { include: { category: true } } },
        },
      },
    }),
    prisma.pairRequest.findMany({
      where: { status: "approved" },
      include: { requester: true, partner: true },
    }),
    prisma.teamMember.findMany({
      include: { team: true },
    }),
  ]);

  // Build partner lookup: volunteerId → partner name
  const partnerMap = new Map<string, string>();
  for (const pr of pairRequests) {
    partnerMap.set(pr.requesterId, pr.partner.name);
    partnerMap.set(pr.partnerId, pr.requester.name);
  }

  // Build team lookup: volunteerId → team name
  const teamMap = new Map<string, string>();
  for (const tm of teamMembers) {
    teamMap.set(tm.volunteerId, tm.team.name);
  }

  // Max shift count across all volunteers (minimum 1 for a consistent schema)
  const maxShifts = Math.max(1, ...vols.map((v) => v.assignments.length));

  const rows = vols.map((v) => {
    const sorted = [...v.assignments].sort((a, b) =>
      a.shift.startTime.localeCompare(b.shift.startTime)
    );

    const row: Record<string, unknown> = {
      Name: v.name,
      Email: v.email || "",
      Phone: formatPhone(v.phone),
      Role: v.role === "team_lead" ? "Team Lead" : "Volunteer",
      "21+": ageLabel(v.isOver21),
    };

    for (let i = 0; i < maxShifts; i++) {
      const a = sorted[i];
      row[`Shift ${i + 1}`] = a
        ? `${a.shift.title} (${fmt12(a.shift.startTime)}–${fmt12(a.shift.endTime)})`
        : "";
    }

    // Someone can be on a team AND partnered with someone outside it. This
    // used to show only the partner, while the admin screen showed only the
    // team — the same person read differently depending which you opened.
    // List every affiliation that applies, matching the dashboard.
    const partner = partnerMap.get(v.id);
    const team = teamMap.get(v.id);
    const parts: string[] = [];
    if (v.role === "team_lead") parts.push(`Team Lead${team ? `: ${team}` : ""}`);
    else if (team) parts.push(`Team: ${team}`);
    if (partner) parts.push(`Partner: ${partner}`);
    row["Partner / Team"] = parts.join(" · ");

    return row;
  });

  if (format === "html") return printableHtml("Volunteer Roster", rows, [], true);
  return csvResponse("volunteers.csv", rows);
}

// ── Coverage gap report — by shift, slots filled vs needed
async function coverageExport(format: string) {
  const shifts = await prisma.shift.findMany({
    include: {
      category: true,
      assignments: { where: { status: "confirmed" } },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });

  const rows = shifts.map((s) => {
    const filled = s.assignments.length;
    const ratio = s.capacity > 0 ? filled / s.capacity : 1;
    const status = filled === 0 ? "🔴 Empty" : ratio < 0.5 ? "🟠 Critical" : ratio < 1 ? "🟡 Partial" : ratio === 1 ? "🟢 Full" : "🔵 Over";
    return {
      Date: new Date(s.date).toLocaleDateString("en-US"),
      Category: s.category.name,
      Shift: s.title,
      Time: `${fmt12(s.startTime)}–${fmt12(s.endTime)}`,
      Filled: filled,
      Needed: s.capacity,
      Status: status,
    };
  });

  if (format === "html") return printableHtml("Coverage Report", rows);
  return csvResponse("coverage.csv", rows);
}

function csvResponse(filename: string, rows: Record<string, unknown>[]): NextResponse {
  const csv = toCSV(rows);
  // HTTP headers must be latin-1. Shift titles contain an em-dash ("Pour — Shift
  // 1"), so passing one through unescaped threw and made every per-shift roster
  // export fail with a 500. Send an ASCII-safe filename plus RFC 5987
  // filename* so clients that support it still get the original characters.
  const asciiName = filename.replace(/[^\x20-\x7E]/g, "-").replace(/["\\]/g, "");
  const encoded = encodeURIComponent(filename);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encoded}`,
    },
  });
}

function printableHtml(title: string, rows: Record<string, unknown>[], subtitleLines: string[] = [], landscape = false): NextResponse {
  if (rows.length === 0) {
    return new NextResponse(`<html><body><h1>${title}</h1><p>No data.</p></body></html>`, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  const headers = Object.keys(rows[0]);
  const esc = (s: unknown): string =>
    String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const html = `<!DOCTYPE html>
<html><head>
<title>${esc(title)}</title>
<meta charset="utf-8">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 30px; color: #1a1a1a; }
  h1 { color: #78350f; margin-bottom: 6px; font-size: 22px; }
  .subtitle { color: #666; margin-bottom: 16px; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { background: #fef3c7; color: #78350f; text-align: left; padding: 8px 10px; border: 1px solid #fbbf24; font-weight: 600; }
  td { padding: 8px 10px; border: 1px solid #fde68a; }
  tr:nth-child(even) td { background: #fffbeb; }
  .footer { margin-top: 20px; font-size: 11px; color: #999; }
  button { background: #b45309; color: white; border: none; padding: 8px 14px; border-radius: 6px; cursor: pointer; font-weight: 500; }
  @media print {
    ${landscape ? "@page { size: landscape; margin: 1cm; }" : "@page { margin: 1cm; }"}
    body { padding: 0; }
    .no-print { display: none; }
    table { font-size: 10px; width: 100%; table-layout: fixed; }
    th, td { padding: 5px 6px; word-wrap: break-word; }
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
    tr { page-break-inside: avoid; }
  }
</style>
</head><body>
<div class="no-print" style="margin-bottom:12px;"><button onclick="window.print()">🖨 Print</button></div>
<h1>${esc(title)}</h1>
${subtitleLines.length ? `<div class="subtitle">${subtitleLines.map(esc).join(" • ")}</div>` : ""}
<table>
  <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
  <tbody>${rows.map((r) => `<tr>${headers.map((h) => `<td>${esc(r[h])}</td>`).join("")}</tr>`).join("")}</tbody>
  <tfoot><tr><td colspan="${headers.length}" style="font-size:10px;color:#999;padding-top:8px;">Generated ${new Date().toLocaleString()} • EGR Harvest + Beer Festival Volunteers</td></tr></tfoot>
</table>
</body></html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
