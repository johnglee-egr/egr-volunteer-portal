"use client";

import { useState, useEffect } from "react";
import { fmt12, fmtPhoneInput } from "@/lib/formatters";

interface Shift {
  id: string;
  title: string;
  description?: string;
  date: string;
  startTime: string;
  endTime: string;
  capacity: number;
  category?: { id: string; name: string; requiresOver21?: boolean };
  assignments: { id: string; volunteer: { id: string; name: string } }[];
}

interface Assignment {
  id: string;
  shiftId: string;
  status: string;
  shift: Shift;
}

interface TeamMember {
  id: string;
  volunteer: {
    id: string; name: string; email?: string; phone?: string;
    assignments?: Assignment[]; role?: string;
    smsConsent?: boolean | null; smsOptOutAt?: string | null;
  };
}

interface Team {
  id: string;
  name: string;
  leaderId: string;
  leader: { id: string; name: string };
  members: TeamMember[];
}

// A2P 10DLC compliance constants. The plain-text version is stored with each
// volunteer's consent record so we can show a carrier exactly what was agreed to.
const SMS_PRIVACY_URL = "https://www.egrharvestfest.com/privacy-policy.html";
const SMS_TERMS_URL = "https://www.egrharvestfest.com/terms-and-conditions.html";
const SMS_CONSENT_TEXT =
  "Yes, text me shift reminders. I agree to receive recurring automated SMS text " +
  "messages from the EGR Harvest + Beer Festival about my volunteer shifts at the " +
  "number provided. Message frequency varies (about 5-10 messages per festival " +
  "season). Message and data rates may apply. Reply STOP to cancel, HELP for help. " +
  `Terms: ${SMS_TERMS_URL} Privacy: ${SMS_PRIVACY_URL}`;

interface Volunteer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  pendingRole?: string | null;
  smsConsent?: boolean | null;
  smsOptOutAt?: string | null;
  assignments: Assignment[];
  pairRequests: { id: string; status: string; partner: { name: string } }[];
}

export default function VolunteerPortal() {
  const [step, setStep] = useState<"choose" | "lookup" | "register" | "team-setup" | "join-team" | "shift-choice" | "signup-complete" | "dashboard">("choose");
  const [volunteer, setVolunteer] = useState<Volunteer | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [registerLoading, setRegisterLoading] = useState(false);

  // Login form
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [registerAsTeamLead, setRegisterAsTeamLead] = useState(false);

  // Contact preference (shown during registration when both email + phone are provided)
  const [contactPref, setContactPref] = useState<"both" | "email" | "sms">("both");

  // A2P 10DLC SMS opt-in. Must default to false — pre-checked consent is non-compliant.
  const [smsConsent, setSmsConsent] = useState(false);

  // 21+ age verification (required for certain shifts like pouring)
  const [isOver21, setIsOver21] = useState<boolean | null>(null);

  // Inline confirm state for "Remove Me" on confirmed shifts
  const [removingAssignmentId, setRemovingAssignmentId] = useState<string | null>(null);

  // Pair request form
  const [showPairForm, setShowPairForm] = useState(false);
  const [partnerName, setPartnerName] = useState("");
  const [partnerEmail, setPartnerEmail] = useState("");
  const [partnerPhone, setPartnerPhone] = useState("");
  const [partnerIsOver21, setPartnerIsOver21] = useState<boolean | null>(null);
  const [registerPartner, setRegisterPartner] = useState(false);
  const [pairMessage, setPairMessage] = useState("");

  const [activeTab, setActiveTab] = useState<"shifts" | "my-schedule" | "my-team">("shifts");

  // Team management (for team leads)
  const [myTeams, setMyTeams] = useState<Team[]>([]);
  // Teams this volunteer belongs to but does not lead
  const [memberTeams, setMemberTeams] = useState<Team[]>([]);
  // "Join a Team" flow (offered to individuals right after registering)
  const [allTeams, setAllTeams] = useState<Team[]>([]);
  const [joinTeamId, setJoinTeamId] = useState<string>("");
  const [joinLoading, setJoinLoading] = useState(false);
  // Reminder shown to a captain right after they first build their team, since
  // they cannot opt their members into SMS on their behalf.
  const [showOptInNotice, setShowOptInNotice] = useState(false);
  const [showTeamForm, setShowTeamForm] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamMembers, setNewTeamMembers] = useState<{ name: string; phone: string; isOver21: boolean | null }[]>([{ name: "", phone: "", isOver21: null }]);
  const [teamSignUpShiftId, setTeamSignUpShiftId] = useState<string | null>(null);
  const [teamSignUpTeamId, setTeamSignUpTeamId] = useState<string | null>(null);

  // Tracks whether we're in a "first-time shift selection" session (new signup flow)
  const [isNewSignup, setIsNewSignup] = useState(false);

  // Shift ID pending confirmation after a duplicate-time warning
  const [dupWarningShiftId, setDupWarningShiftId] = useState<string | null>(null);

  // Shift selection drill-down: category → shift
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Team-lead multi-member sign-up modal
  const [memberSignUpModal, setMemberSignUpModal] = useState<{ shift: Shift; selectedIds: Set<string> } | null>(null);

  // My Team tab: drag-to-assign
  const [dragShiftId, setDragShiftId] = useState<string | null>(null);
  const [dragOverMemberId, setDragOverMemberId] = useState<string | null>(null);

  // My Team tab sub-view
  const [teamSubTab, setTeamSubTab] = useState<"roster" | "schedule">("roster");

  // Inline confirm for removing a member from the team (matches the "Remove Me"
  // pattern used on shifts — the app uses no native browser dialogs anywhere else)
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);

  // Inline "add member" fields on the roster
  const [addMemberName, setAddMemberName] = useState("");
  const [addMemberPhone, setAddMemberPhone] = useState("");

  useEffect(() => {
    fetch("/api/shifts").then((r) => r.json()).then(setShifts);
  }, []);

  const handleLogin = async () => {
    setError("");
    if (!name || !contact) {
      setError("Please enter your name and email or phone number.");
      return;
    }
    setLoginLoading(true);
    const res = await fetch("/api/volunteers/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, contact }),
    });
    setLoginLoading(false);

    if (res.ok) {
      const data = await res.json();
      setVolunteer(data);
      setActiveTab("my-schedule");
      setStep("dashboard");
      loadTeams(data.id);
    } else {
      setError("Volunteer not found. Use the ← Back button and choose \"New Volunteer? Register Here\" to create an account.");
    }
  };

  const handleRegister = async () => {
    setError("");
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Please enter your name.");
      return;
    }
    if (!phone) {
      setError("A phone number is required so we can send you shift reminders.");
      return;
    }
    setRegisterLoading(true);
    const res = await fetch("/api/volunteers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: trimmedName,
        email: email || null,
        phone: phone || null,
        role: registerAsTeamLead ? "team_lead" : "volunteer",
        // Contact preference can never imply SMS without an explicit opt-in.
        contactPref: smsConsent
          ? ((email && phone) ? contactPref : (email ? "email" : "sms"))
          : "email",
        isOver21,
        smsConsent,
        smsConsentText: smsConsent ? SMS_CONSENT_TEXT : null,
      }),
    });
    setRegisterLoading(false);

    if (res.ok) {
      const data = await res.json();
      if (data.alreadyRegistered) {
        setError(`You're already registered, ${data.name}! Use "Already Registered?" on the home screen to look up your schedule.`);
        return;
      }
      setVolunteer({ ...data, assignments: [], pairRequests: [] });
      setIsNewSignup(true); // show "Done — Confirm" bar when they reach the shifts tab
      // If they requested team lead, give them a chance to build their team right now
      // Captains go build their team; everyone else is offered the chance to
      // join an existing one before landing on the dashboard.
      if (registerAsTeamLead) {
        setStep("team-setup");
      } else {
        const teamRes = await fetch("/api/teams");
        const teams: Team[] = teamRes.ok ? await teamRes.json() : [];
        setAllTeams(teams);
        setStep(teams.length > 0 ? "join-team" : "dashboard");
      }
    } else {
      const data = await res.json();
      setError(data.error || "Registration failed.");
    }
  };

  const timesOverlap = (aStart: string, aEnd: string, bStart: string, bEnd: string) =>
    aStart < bEnd && bStart < aEnd;

  const handleSignUp = (shiftId: string) => {
    if (!volunteer) return;
    setError("");
    setSuccess("");

    const target = shifts.find((s) => s.id === shiftId);
    if (target) {
      const conflict = volunteer.assignments
        .filter((a) => a.status === "confirmed" || a.status === "pending")
        .find((a) => timesOverlap(target.startTime, target.endTime, a.shift.startTime, a.shift.endTime));
      if (conflict) {
        setDupWarningShiftId(shiftId);
        return;
      }
    }
    doSignUp(shiftId);
  };

  const doSignUp = async (shiftId: string) => {
    if (!volunteer) return;
    setDupWarningShiftId(null);

    const res = await fetch("/api/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ volunteerId: volunteer.id, shiftId, assignedBy: "self" }),
    });

    if (res.ok) {
      const data = await res.json();
      setSuccess(data.triaged
        ? "You're confirmed! Your spot has been reserved. 🎉"
        : "Request submitted! An admin will review and confirm your spot soon.");
      refreshData();
    } else {
      const data = await res.json();
      setError(data.error || "Could not sign up.");
    }
  };

  const handleRemove = async (assignmentId: string) => {
    setError("");
    setSuccess("");

    const res = await fetch("/api/assignments", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignmentId }),
    });

    if (res.ok) {
      setSuccess("You've been removed from the shift.");
      refreshData();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not remove you from the shift. Please try again.");
    }
  };

  const handlePairRequest = async () => {
    if (!volunteer || !partnerName) return;
    if (registerPartner && !partnerPhone) {
      setError("Please enter your partner's phone number so we can register them and send shift reminders.");
      return;
    }
    setError("");

    const res = await fetch("/api/pair-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requesterId: volunteer.id,
        partnerName,
        partnerPhone: partnerPhone || null,
        partnerEmail: registerPartner ? partnerEmail || null : null,
        partnerIsOver21: registerPartner ? partnerIsOver21 : undefined,
        message: pairMessage || null,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const wasNew = registerPartner;
      setSuccess(wasNew
        ? `Partner request submitted! ${partnerName} has been registered as a new volunteer.`
        : "Partner request submitted!");
      setShowPairForm(false);
      setPartnerName("");
      setPartnerEmail("");
      setPartnerPhone("");
      setRegisterPartner(false);
      setPairMessage("");
      refreshData();
    } else {
      const data = await res.json();
      if (data.error?.includes("Please provide their email or phone")) {
        setRegisterPartner(true);
        setError(`"${partnerName}" isn't registered yet. Add their email or phone below to sign them up!`);
      } else {
        setError(data.error || "Could not submit partner request.");
      }
    }
  };


  const refreshData = async () => {
    if (!volunteer) return;
    const volId = volunteer.id; // capture at call time to avoid stale closure
    const [volRes, shiftRes, teamRes] = await Promise.all([
      fetch(`/api/volunteers/${volId}`),
      fetch("/api/shifts"),
      fetch("/api/teams"),
    ]);
    if (volRes.ok) {
      const volData = await volRes.json();
      setVolunteer(volData);
    }
    if (shiftRes.ok) setShifts(await shiftRes.json());
    if (teamRes.ok) applyTeams(await teamRes.json(), volId);
  };

  // Split the full team list into "teams I lead", "teams I belong to", and the
  // full roster used by the Join a Team picker.
  const applyTeams = (teams: Team[], volId: string) => {
    setAllTeams(teams);
    setMyTeams(teams.filter((t) => t.leaderId === volId));
    setMemberTeams(
      teams.filter(
        (t) => t.leaderId !== volId && t.members.some((m) => m.volunteer.id === volId)
      )
    );
  };

  // Load teams when logging in
  const loadTeams = async (volId: string) => {
    const res = await fetch("/api/teams");
    if (res.ok) applyTeams(await res.json(), volId);
  };

  /**
   * Join an existing team. `next` decides where the volunteer lands afterwards:
   * "shifts" lets them pick their own, "captain" hands assignment to the team
   * leader (they appear on the captain's roster with no shifts either way).
   */
  const handleJoinTeam = async (next: "shifts" | "captain") => {
    if (!volunteer || !joinTeamId) return;
    setError("");
    setJoinLoading(true);
    const res = await fetch("/api/teams/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ volunteerId: volunteer.id, teamId: joinTeamId }),
    });
    setJoinLoading(false);

    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Could not join that team.");
      return;
    }

    const data = await res.json();
    await refreshData();

    if (next === "shifts") {
      setSuccess(`You joined ${data.teamName}! Now pick the shifts you'd like.`);
      setActiveTab("shifts");
      setIsNewSignup(true);
      setStep("dashboard");
    } else {
      setSuccess(
        `You joined ${data.teamName}. ${data.leaderName || "Your captain"} will assign your shifts — watch for a reminder.`
      );
      setActiveTab("my-team");
      setStep("dashboard");
    }
  };

  const handleCreateTeam = async () => {
    if (!volunteer || !newTeamName.trim()) return;
    setError("");
    const validMembers = newTeamMembers
      .filter((m) => m.name.trim())
      .map((m) => ({ name: m.name.trim(), phone: m.phone.trim() || null, isOver21: m.isOver21 }));
    const res = await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newTeamName, leaderId: volunteer.id, memberNames: validMembers }),
    });
    if (res.ok) {
      const hadPhones = validMembers.some((m) => m.phone);
      setNewTeamName("");
      setNewTeamMembers([{ name: "", phone: "", isOver21: null }]);
      if (step === "team-setup") {
        // Coming from registration — remind the captain that SMS opt-in is
        // per-person, then continue to the shift-selection prompt.
        refreshData();
        setShowOptInNotice(true);
      } else {
        setSuccess("Team created! You can now sign your team up for shifts.");
        setShowTeamForm(false);
        if (hadPhones) setShowOptInNotice(true);
        refreshData();
      }
    } else {
      const d = await res.json();
      setError(d.error || "Failed to create team.");
    }
  };

  const handleTeamSignUp = async (teamId: string, shiftId: string) => {
    setError("");
    const res = await fetch("/api/teams", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: teamId, assignShiftId: shiftId }),
    });
    if (res.ok) {
      setSuccess("Team signed up for shift!");
      setTeamSignUpShiftId(null);
      setTeamSignUpTeamId(null);
      refreshData();
    } else {
      const d = await res.json();
      setError(d.error || "Failed to sign up team.");
    }
  };

  // Sign up selected team members for a shift (captain-driven multi-select)
  const handleMemberSignUp = async () => {
    if (!memberSignUpModal) return;
    const { shift, selectedIds } = memberSignUpModal;
    setError("");
    let count = 0;
    for (const memberId of selectedIds) {
      const already = shift.assignments.some((a) => a.volunteer.id === memberId);
      if (already) continue;
      const res = await fetch("/api/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ volunteerId: memberId, shiftId: shift.id, assignedBy: "team_lead" }),
      });
      if (res.ok) count++;
    }
    setMemberSignUpModal(null);
    setSuccess(`Signed up ${count} member${count !== 1 ? "s" : ""} for ${shift.title}!`);
    refreshData();
  };

  // A volunteer opts themselves in to SMS from their own dashboard. This is the
  // only path that can ever set smsConsent — a captain cannot do it for them.
  const handleSelfOptIn = async () => {
    if (!volunteer) return;
    setError("");
    const res = await fetch("/api/volunteers/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        volunteerId: volunteer.id,
        smsConsent: true,
        smsConsentText: SMS_CONSENT_TEXT,
      }),
    });
    if (res.ok) {
      setSuccess("You're signed up for text reminders. Reply STOP to any message to cancel.");
      refreshData();
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Could not save your preference.");
    }
  };

  // Add one member to the team from the roster. The phone is stored for contact
  // only — it does NOT enroll them in SMS, which they must consent to themselves.
  const handleAddMember = async (teamId: string) => {
    const name = addMemberName.trim();
    if (!name) return;
    setError("");
    const res = await fetch("/api/teams", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: teamId,
        addMembers: [{ name, phone: addMemberPhone.trim() || null }],
        requesterId: volunteer?.id,
      }),
    });
    if (res.ok) {
      setAddMemberName("");
      setAddMemberPhone("");
      setSuccess(`${name} added to the team.`);
      refreshData();
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Could not add that member.");
    }
  };

  // Release a shift slot held by a team member (captain-initiated)
  const handleRemoveMemberShift = async (assignmentId: string, memberName: string, shiftTitle: string) => {
    setError("");
    const res = await fetch("/api/assignments", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignmentId }),
    });
    if (res.ok) {
      setSuccess(`Removed ${memberName} from ${shiftTitle}.`);
      refreshData();
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Could not remove that shift.");
    }
  };

  // Assign a team member to a shift via drag-and-drop
  const handleDragAssign = async (memberId: string, shiftId: string) => {
    setDragShiftId(null);
    setDragOverMemberId(null);
    const already = shifts.find((s) => s.id === shiftId)?.assignments.some((a) => a.volunteer.id === memberId);
    if (already) { setError("This member is already on that shift."); return; }
    const res = await fetch("/api/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ volunteerId: memberId, shiftId, assignedBy: "team_lead" }),
    });
    if (res.ok) { refreshData(); setSuccess("Shift assigned!"); }
    else { const d = await res.json(); setError(d.error || "Could not assign shift."); }
  };

  // Print team schedule in a new window
  const printTeamSchedule = (team: Team) => {
    const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const members = team.members;
    const rows = members.map((tm) => {
      const memberShifts = (tm.volunteer.assignments || []).filter((a) => a.status === "confirmed");
      return {
        name: tm.volunteer.name + (tm.volunteer.id === volunteer?.id ? " (captain)" : ""),
        phone: tm.volunteer.phone || "—",
        shifts: memberShifts,
      };
    });
    const festivalDate = members
      .flatMap((tm) => tm.volunteer.assignments || [])
      .map((a) => a.shift?.date)
      .find(Boolean);
    const dateLine = festivalDate
      ? new Date(festivalDate).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
      : "";
    const html = `<!DOCTYPE html><html><head><title>${esc(team.name)} — Team Schedule</title>
<style>
  body{font-family:sans-serif;padding:24px;color:#1a1a1a}
  h1{color:#0f766e;font-size:22px;margin-bottom:4px}
  h2{color:#6b7280;font-size:14px;font-weight:normal;margin-bottom:20px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{background:#ccfbf1;color:#0f766e;text-align:left;padding:8px 10px;border:1px solid #99f6e4}
  td{padding:8px 10px;border:1px solid #d1fae5;vertical-align:top}
  tr:nth-child(even) td{background:#f0fdf4}
  @media print{
    @page{size:landscape;margin:1cm}
    body{padding:0}
    button{display:none}
    thead{display:table-header-group}
    tr{page-break-inside:avoid}
  }
</style></head><body>
<button onclick="window.print()" style="background:#0f766e;color:white;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;margin-bottom:16px">🖨 Print</button>
<h1>${esc(team.name)} — Team Schedule</h1>
<h2>EGR Harvest + Beer Festival${dateLine ? ` &middot; ${esc(dateLine)}` : ""}</h2>
<table><thead><tr><th>Member</th><th>Phone</th><th>Shifts</th></tr></thead><tbody>
${rows.map((r) => `<tr><td style="font-weight:600">${esc(r.name)}</td><td>${esc(r.phone)}</td><td>${r.shifts.length === 0 ? "<em style='color:#9ca3af'>No shifts yet</em>" : r.shifts.map((a) => esc(`${a.shift.title} (${fmt12(a.shift.startTime)}–${fmt12(a.shift.endTime)})`)).join("<br>")}</td></tr>`).join("")}
</tbody></table></body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  // Export team schedule as CSV download. Includes date and phone so the file
  // is actually usable for contacting and coordinating the crew.
  const exportTeamCsv = (team: Team) => {
    const esc = (s: string) => `"${(s || "").replace(/"/g, '""')}"`;
    const rows: string[] = ["Team,Member,Phone,Date,Shift,Start,End"];
    for (const tm of team.members) {
      const memberShifts = (tm.volunteer.assignments || []).filter((a) => a.status === "confirmed");
      const phone = tm.volunteer.phone || "";
      if (memberShifts.length === 0) {
        rows.push([team.name, tm.volunteer.name, phone, "", "(no shift assigned)", "", ""].map(esc).join(","));
      } else {
        for (const a of memberShifts) {
          const d = a.shift.date ? new Date(a.shift.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "";
          rows.push([team.name, tm.volunteer.name, phone, d, a.shift.title, fmt12(a.shift.startTime), fmt12(a.shift.endTime)].map(esc).join(","));
        }
      }
    }
    const blob = new Blob([rows.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${team.name.replace(/[^a-z0-9]+/gi, "_")}_schedule.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ── Home: pick a path ──────────────────────────────────────────────────────
  if (step === "choose") {
    return (
      <div className="max-w-lg mx-auto mt-10 px-4 pb-16">
        <h1 className="text-3xl font-bold text-amber-900 text-center mb-2">EGR Harvest + Beer Festival</h1>
        <p className="text-center text-gray-500 mb-10">Volunteer Portal</p>
        <div className="flex flex-col gap-5">
          <button
            onClick={() => { setError(""); setStep("register"); }}
            className="group w-full bg-green-700 hover:bg-green-800 text-white rounded-2xl p-8 text-left shadow-md transition-colors"
          >
            <div className="text-4xl mb-3">🌱</div>
            <div className="text-xl font-bold mb-1">New Volunteer?</div>
            <div className="text-green-200 text-sm">Register Here</div>
          </button>
          <button
            onClick={() => { setError(""); setStep("lookup"); }}
            className="group w-full bg-amber-700 hover:bg-amber-800 text-white rounded-2xl p-8 text-left shadow-md transition-colors"
          >
            <div className="text-4xl mb-3">📋</div>
            <div className="text-xl font-bold mb-1">Already Registered?</div>
            <div className="text-amber-200 text-sm">Look Up My Schedule</div>
          </button>
        </div>
      </div>
    );
  }

  // ── Look up existing volunteer ──────────────────────────────────────────────
  if (step === "lookup") {
    return (
      <div className="max-w-md mx-auto mt-16 px-4">
        <div className="bg-white rounded-xl shadow-md p-8 border border-amber-200">
          <h1 className="text-2xl font-bold text-amber-900 mb-6 text-center">Look Up My Schedule</h1>

          {error && <div className="bg-red-50 text-red-700 p-3 rounded mb-4 text-sm">{error}</div>}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none"
                placeholder="John Smith"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email or Phone</label>
              <input
                type="text"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none"
                placeholder="john@example.com or 555-123-4567"
              />
            </div>
            <button
              onClick={handleLogin}
              disabled={loginLoading}
              className="w-full bg-amber-700 text-white py-2 rounded-lg font-medium hover:bg-amber-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loginLoading ? "Looking up…" : "Look Up My Schedule"}
            </button>
            <button
              onClick={() => { setError(""); setStep("choose"); }}
              className="w-full text-gray-500 text-sm hover:text-gray-700 transition-colors"
            >
              ← Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── New volunteer registration ──────────────────────────────────────────────
  if (step === "register") {
    return (
      <div className="max-w-md mx-auto mt-16 px-4">
        <div className="bg-white rounded-xl shadow-md p-8 border border-green-200">
          <h1 className="text-2xl font-bold text-green-900 mb-6 text-center">Register as Volunteer</h1>

          {error && <div className="bg-red-50 text-red-700 p-3 rounded mb-4 text-sm">{error}</div>}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-green-400 focus:border-transparent outline-none"
                placeholder="John Smith"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone <span className="text-red-600">*</span>
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(fmtPhoneInput(e.target.value))}
                autoComplete="tel"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-green-400 focus:border-transparent outline-none"
                placeholder="555-123-4567"
                required
              />
              <p className="text-xs text-gray-500 mt-1">Required — we&apos;ll send you automated shift reminders before the big day!</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-green-400 focus:border-transparent outline-none"
                placeholder="john@example.com"
              />
              <p className="text-xs text-gray-500 mt-1">Add your email to also receive reminders with a calendar invite you can save.</p>
            </div>

            {/* Contact preference — shown only when both channels are provided */}
            {phone && email && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2 transition-all duration-300">
                <p className="text-sm font-semibold text-green-900">📬 How would you like to receive reminders?</p>
                <p className="text-xs text-green-700">
                  We&apos;ll send automated reminders before the big day — pick your preference below.
                </p>
                <div className="flex flex-col gap-2 mt-1">
                  {(
                    [
                      { value: "both",  label: "📱 + 📧  Both text & email", desc: "Get a text AND an email (email includes a calendar invite)" },
                      { value: "email", label: "📧  Email only",             desc: "Email reminder with a calendar invite attached" },
                      { value: "sms",   label: "📱  Text message only",      desc: "Quick SMS reminder with a link to add to your calendar" },
                    ] as const
                  ).map(({ value, label, desc }) => (
                    <label key={value} className={`flex items-start gap-3 cursor-pointer rounded-lg p-2.5 border transition-colors ${
                      contactPref === value
                        ? "border-green-500 bg-white"
                        : "border-transparent hover:border-green-300 hover:bg-white/60"
                    }`}>
                      <input
                        type="radio"
                        name="contactPref"
                        value={value}
                        checked={contactPref === value}
                        onChange={() => setContactPref(value)}
                        className="mt-0.5 accent-green-600"
                      />
                      <span>
                        <span className="block text-sm font-medium text-gray-800">{label}</span>
                        <span className="block text-xs text-gray-500">{desc}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* SMS consent — A2P 10DLC requires an affirmative, unchecked-by-default
                opt-in with frequency, rates, opt-out and links to both legal pages. */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={smsConsent}
                  onChange={(e) => setSmsConsent(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-blue-600 shrink-0"
                />
                <span className="text-sm text-gray-800 leading-snug">
                  Yes, text me shift reminders. I agree to receive recurring automated SMS
                  text messages from the EGR Harvest + Beer Festival about my volunteer
                  shifts at the number provided. Message frequency varies (about 5&ndash;10
                  messages per festival season). Message and data rates may apply. Reply
                  STOP to cancel, HELP for help. See our{" "}
                  <a
                    href={SMS_TERMS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-700 underline font-medium"
                    onClick={(e) => e.stopPropagation()}
                  >Terms &amp; Conditions</a>{" "}and{" "}
                  <a
                    href={SMS_PRIVACY_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-700 underline font-medium"
                    onClick={(e) => e.stopPropagation()}
                  >Privacy Policy</a>.
                </span>
              </label>
              <p className="text-xs text-gray-500 mt-2 ml-7">
                Consent is not a condition of volunteering. Leave this unchecked and we&apos;ll
                email you instead.
              </p>
            </div>

            {/* 21+ age verification */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-2">
              <p className="text-sm font-semibold text-amber-900">🍺 Are you 21 years of age or older?</p>
              <p className="text-xs text-amber-700">Required if you wish to volunteer for beer pouring or alcohol service roles.</p>
              <div className="flex gap-4 mt-1">
                <label className={`flex items-center gap-2 cursor-pointer px-4 py-2 rounded-lg border-2 transition-colors text-sm font-medium ${
                  isOver21 === true ? "border-amber-500 bg-white text-amber-900" : "border-gray-200 bg-white text-gray-600 hover:border-amber-300"
                }`}>
                  <input
                    type="radio"
                    name="isOver21"
                    checked={isOver21 === true}
                    onChange={() => setIsOver21(true)}
                    className="accent-amber-600"
                  />
                  Yes, I am 21+
                </label>
                <label className={`flex items-center gap-2 cursor-pointer px-4 py-2 rounded-lg border-2 transition-colors text-sm font-medium ${
                  isOver21 === false ? "border-gray-400 bg-white text-gray-700" : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                }`}>
                  <input
                    type="radio"
                    name="isOver21"
                    checked={isOver21 === false}
                    onChange={() => setIsOver21(false)}
                    className="accent-gray-600"
                  />
                  No, I am under 21
                </label>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={registerAsTeamLead}
                onChange={(e) => setRegisterAsTeamLead(e.target.checked)}
                className="w-4 h-4 text-teal-600 rounded border-gray-300 focus:ring-teal-500"
              />
              <span className="text-teal-800 font-medium">Request Team Lead Role</span>
              <span className="text-xs text-gray-500">(Pending admin approval)</span>
            </label>
            <button
              onClick={handleRegister}
              disabled={registerLoading}
              className="w-full bg-green-700 text-white py-2 rounded-lg font-medium hover:bg-green-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {registerLoading ? "Registering…" : "Register"}
            </button>
            <button
              onClick={() => { setError(""); setStep("choose"); }}
              className="w-full text-gray-500 text-sm hover:text-gray-700 transition-colors"
            >
              ← Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Sign-up complete thank-you screen ─────────────────────────────────────
  if (step === "signup-complete") {
    const confirmedShifts = volunteer?.assignments.filter((a) => a.status === "confirmed") ?? [];
    const pendingShifts  = volunteer?.assignments.filter((a) => a.status === "pending")   ?? [];
    const isTeamLead = volunteer?.role === "team_lead";

    return (
      <div className="max-w-lg mx-auto mt-10 px-4 pb-16">
        <div className="bg-white rounded-2xl shadow-md p-8 border border-green-200 text-center">
          <div className="text-6xl mb-4">🎉</div>
          <h1 className="text-2xl font-bold text-green-800 mb-2">You&apos;re all set, {volunteer?.name}!</h1>
          <p className="text-gray-600 text-sm mb-6">
            {isTeamLead
              ? "Your team has been registered and your shift requests are in. The Festival Volunteer Manager will confirm your assignments and be in touch with details closer to the event."
              : "Thanks for signing up to volunteer at the EGR Harvest + Beer Festival! We'll be in touch with confirmation and more details closer to the event."}
          </p>

          {/* Shift summary */}
          {(confirmedShifts.length > 0 || pendingShifts.length > 0) && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6 text-left">
              <p className="text-sm font-semibold text-green-800 mb-3">Your shift request{confirmedShifts.length + pendingShifts.length !== 1 ? "s" : ""}:</p>
              <div className="space-y-2">
                {confirmedShifts.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 text-sm">
                    <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap">Confirmed</span>
                    <span className="font-medium text-gray-800">{a.shift.title}</span>
                    <span className="text-gray-500 text-xs">{fmt12(a.shift.startTime)} – {fmt12(a.shift.endTime)}</span>
                  </div>
                ))}
                {pendingShifts.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 text-sm">
                    <span className="bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap">Pending</span>
                    <span className="font-medium text-gray-800">{a.shift.title}</span>
                    <span className="text-gray-500 text-xs">{fmt12(a.shift.startTime)} – {fmt12(a.shift.endTime)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(confirmedShifts.length === 0 && pendingShifts.length === 0) && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-sm text-amber-800">
              No shifts selected yet — the Festival Volunteer Manager will reach out with your assignment details.
            </div>
          )}

          <div className="flex flex-col gap-3">
            <button
              onClick={() => { setActiveTab("my-schedule"); setStep("dashboard"); }}
              className="w-full bg-green-700 text-white py-3 rounded-xl font-bold hover:bg-green-800 transition-colors"
            >
              View My Schedule
            </button>
            <button
              onClick={() => { setActiveTab("shifts"); setStep("dashboard"); }}
              className="w-full bg-gray-100 text-gray-700 py-3 rounded-xl font-medium hover:bg-gray-200 transition-colors"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Shift choice prompt (after team is created during registration flow) ────
  if (step === "shift-choice") {
    return (
      <div className="max-w-lg mx-auto mt-16 px-4">
        <div className="bg-white rounded-xl shadow-md p-8 border border-teal-200">
          <div className="text-center mb-6">
            <div className="text-5xl mb-3">🎉</div>
            <h1 className="text-2xl font-bold text-teal-900 mb-2">Team Created!</h1>
            <p className="text-gray-600 text-sm">
              Great news, <strong>{volunteer?.name}</strong>! Your team is all set. Would you like to browse and select shifts now, or let the Festival Volunteer Manager handle assignments?
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <button
              onClick={() => { setActiveTab("shifts"); setIsNewSignup(true); setStep("dashboard"); }}
              className="w-full bg-teal-700 text-white rounded-xl p-5 text-left hover:bg-teal-800 transition-colors shadow-sm"
            >
              <div className="text-2xl mb-1">📅</div>
              <div className="font-bold text-lg">Yes — Pick Shifts Now</div>
              <div className="text-teal-200 text-sm mt-0.5">Browse available shifts and sign your team up right away.</div>
            </button>
            <button
              onClick={() => { setSuccess("Thanks for signing up! The Festival Volunteer Manager will be in touch soon with your specific shift assignments."); setStep("dashboard"); }}
              className="w-full bg-gray-50 border-2 border-gray-200 text-gray-800 rounded-xl p-5 text-left hover:bg-gray-100 transition-colors"
            >
              <div className="text-2xl mb-1">📬</div>
              <div className="font-bold text-lg">No — Leave It to the Manager</div>
              <div className="text-gray-500 text-sm mt-0.5">We&apos;ll reach out with more info on your specific assignments closer to the festival.</div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Join a team (offered to individuals right after registering) ──────────
  if (step === "join-team") {
    const chosen = allTeams.find((t) => t.id === joinTeamId);
    return (
      <div className="max-w-lg mx-auto mt-16 px-4 pb-16">
        <div className="bg-white rounded-xl shadow-md p-8 border border-teal-200">
          <div className="text-center mb-6">
            <div className="text-5xl mb-3">👋</div>
            <h1 className="text-2xl font-bold text-teal-900 mb-2">
              Welcome, {volunteer?.name}!
            </h1>
            <p className="text-gray-600 text-sm">
              Are you volunteering with a group? Join their team and your captain can
              coordinate your shifts. Otherwise just skip — you can still pick shifts on
              your own.
            </p>
          </div>

          {error && <div className="bg-red-50 text-red-700 p-3 rounded mb-4 text-sm">{error}</div>}

          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Choose a team
              </label>
              <select
                value={joinTeamId}
                onChange={(e) => setJoinTeamId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-teal-400 outline-none bg-white"
              >
                <option value="">— Select a team —</option>
                {allTeams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} (captain: {t.leader?.name || "—"}, {t.members.length} member
                    {t.members.length !== 1 ? "s" : ""})
                  </option>
                ))}
              </select>
              {chosen && (
                <p className="text-xs text-teal-700 mt-2">
                  You&apos;ll appear on {chosen.leader?.name || "the captain"}&apos;s roster for{" "}
                  <strong>{chosen.name}</strong>.
                </p>
              )}
            </div>

            {joinTeamId && (
              <div className="space-y-3">
                <p className="text-sm font-medium text-gray-700">How do you want shifts handled?</p>
                <button
                  onClick={() => handleJoinTeam("shifts")}
                  disabled={joinLoading}
                  className="w-full bg-teal-700 text-white rounded-xl p-4 text-left hover:bg-teal-800 transition-colors disabled:opacity-50"
                >
                  <div className="font-bold">📅 I&apos;ll pick my own shifts</div>
                  <div className="text-teal-200 text-xs mt-0.5">
                    Join the team, then browse and choose shifts yourself.
                  </div>
                </button>
                <button
                  onClick={() => handleJoinTeam("captain")}
                  disabled={joinLoading}
                  className="w-full bg-white border-2 border-teal-200 text-gray-800 rounded-xl p-4 text-left hover:bg-teal-50 transition-colors disabled:opacity-50"
                >
                  <div className="font-bold">🧢 Let my captain assign me</div>
                  <div className="text-gray-500 text-xs mt-0.5">
                    Join the team and wait — your captain will put you on shifts.
                  </div>
                </button>
              </div>
            )}

            <button
              onClick={() => { setJoinTeamId(""); setIsNewSignup(true); setActiveTab("shifts"); setStep("dashboard"); }}
              className="w-full text-gray-500 text-sm hover:text-gray-700 transition-colors pt-1"
            >
              Skip — I&apos;m volunteering on my own
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Team setup (immediately after team-lead registration) ─────────────────
  if (step === "team-setup") {
    return (
      <div className="max-w-lg mx-auto mt-16 px-4">
        <div className="bg-white rounded-xl shadow-md p-8 border border-teal-200">
          {/* Header */}
          <div className="flex items-center gap-3 mb-1">
            <span className="text-3xl">👥</span>
            <h1 className="text-2xl font-bold text-teal-900">Build Your Team</h1>
          </div>
          <p className="text-sm text-gray-500 mb-1">
            Welcome, <strong>{volunteer?.name}</strong>! Your team lead request is pending admin approval.
          </p>
          <p className="text-sm text-gray-500 mb-6">
            Set up your team now so everyone is ready to sign up for shifts together. You can always add more members later from your dashboard.
          </p>

          {error && <div className="bg-red-50 text-red-700 p-3 rounded mb-4 text-sm">{error}</div>}

          <div className="space-y-5">
            {/* Team Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Team Name <span className="text-red-600">*</span>
              </label>
              <input
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-teal-400 outline-none"
                placeholder="e.g., Smith Family Crew, Church Group, Work Friends"
              />
            </div>

            {/* Team Members */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Team Members</label>
              <p className="text-xs text-gray-400 mb-3">
                Add names now — they don&apos;t need to be registered yet. You&apos;ll be listed automatically as the team leader.
              </p>
              {newTeamMembers.map((m, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 mb-2">
                  <input
                    value={m.name}
                    onChange={(e) => {
                      const u = [...newTeamMembers];
                      u[i] = { ...u[i], name: e.target.value };
                      setNewTeamMembers(u);
                    }}
                    className="flex-1 min-w-[130px] border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-teal-400 outline-none"
                    placeholder={`Member ${i + 1} name`}
                  />
                  <input
                    type="tel"
                    value={m.phone}
                    onChange={(e) => {
                      const u = [...newTeamMembers];
                      u[i] = { ...u[i], phone: fmtPhoneInput(e.target.value) };
                      setNewTeamMembers(u);
                    }}
                    className="flex-1 min-w-[130px] border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-teal-400 outline-none"
                    placeholder="Phone (optional)"
                  />
                  <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={m.isOver21 === true}
                      onChange={(e) => {
                        const u = [...newTeamMembers];
                        u[i] = { ...u[i], isOver21: e.target.checked ? true : null };
                        setNewTeamMembers(u);
                      }}
                      className="w-3.5 h-3.5 accent-amber-600"
                    />
                    21+
                  </label>
                  {newTeamMembers.length > 1 && (
                    <button
                      onClick={() => setNewTeamMembers(newTeamMembers.filter((_, j) => j !== i))}
                      className="text-red-400 hover:text-red-600 text-xl px-2 leading-none"
                      title="Remove member"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              <p className="text-xs text-gray-400 mb-1">Check &quot;21+&quot; for members who are 21 or older (required for pouring roles).</p>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-2">
                <p className="text-xs text-blue-900">
                  📱 <strong>About phone numbers:</strong> adding a teammate&apos;s number lets us reach
                  them about their shifts. It does <strong>not</strong> sign them up for text
                  reminders — by law each person has to agree to texts themselves. They&apos;ll be
                  asked once when they open the portal, and you&apos;ll see who still needs to.
                </p>
              </div>
            </div>

            {/* Actions */}
            <button
              onClick={() => setNewTeamMembers([...newTeamMembers, { name: "", phone: "", isOver21: null }])}
              className="w-full bg-amber-600 text-white py-2.5 rounded-lg font-semibold hover:bg-amber-700 transition-colors"
            >
              + Add Another Member
            </button>
            <button
              onClick={handleCreateTeam}
              disabled={!newTeamName.trim()}
              className="w-full bg-teal-700 text-white py-2.5 rounded-lg font-semibold hover:bg-teal-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Create Team &amp; Go to Dashboard →
            </button>
            <button
              onClick={() => {
                setNewTeamName("");
                setNewTeamMembers([{ name: "", phone: "", isOver21: null }]);
                setStep("dashboard");
              }}
              className="w-full text-gray-500 text-sm hover:text-gray-700 transition-colors"
            >
              Skip for Now — I&apos;ll Set Up My Team Later
            </button>
          </div>
        </div>

        {/* SMS opt-in reminder — a captain can't consent for their members */}
        {showOptInNotice && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 text-center">
              <div className="text-4xl mb-3">📱</div>
              <h2 className="text-lg font-bold text-teal-900 mb-3">One more thing</h2>
              <p className="text-sm text-gray-700 leading-relaxed mb-5">
                If you want your team members to receive automated text reminders, please
                have each person sign in to opt in for messages. Thank you captain!
              </p>
              <button
                onClick={() => { setShowOptInNotice(false); setStep("shift-choice"); }}
                className="w-full bg-teal-700 text-white py-2.5 rounded-lg font-semibold hover:bg-teal-800 transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Dashboard
  return (
    <div className={`max-w-6xl mx-auto px-4 py-8 ${isNewSignup && activeTab === "shifts" ? "pb-24" : ""}`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-amber-900">
            Welcome, {volunteer?.name}!
            {volunteer?.role === "team_lead" && <span className="ml-2 text-sm bg-teal-100 text-teal-800 px-2 py-1 rounded-full align-middle">Team Captain</span>}
            {volunteer?.role !== "team_lead" && volunteer?.pendingRole === "team_lead" && <span className="ml-2 text-sm bg-amber-100 text-amber-800 px-2 py-1 rounded-full align-middle">Team Captain — pending approval</span>}
          </h1>
          <p className="text-gray-600 mt-1">
            {volunteer?.assignments.filter((a) => a.status === "confirmed").length || 0} active assignment(s)
          </p>
          {myTeams.length > 0 && (() => {
            const others = myTeams.flatMap((t) => t.members.filter((m) => m.volunteer.id !== volunteer?.id));
            return (
              <p className="text-teal-700 text-sm mt-0.5 font-medium">({others.length} team member{others.length !== 1 ? "s" : ""} + you)</p>
            );
          })()}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowPairForm(!showPairForm)}
            className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700 transition-colors"
          >
            Request Partner
          </button>
          <button
            onClick={() => { setStep("choose"); setVolunteer(null); }}
            className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-300 transition-colors"
          >
            Log Out
          </button>
        </div>
      </div>

      {/* Fixed toast — appears near the user's current position at the bottom of the screen */}
      {(error || success) && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-md w-[90vw] shadow-lg rounded-xl px-5 py-3 text-sm font-medium flex items-start gap-3 animate-in fade-in slide-in-from-bottom-2"
          style={{ background: error ? "#fef2f2" : "#f0fdf4", color: error ? "#b91c1c" : "#15803d", border: `1px solid ${error ? "#fca5a5" : "#86efac"}` }}>
          <span className="text-lg leading-none">{error ? "⚠️" : "✅"}</span>
          <span className="flex-1">{error || success}</span>
          <button onClick={() => { setError(""); setSuccess(""); }} className="opacity-60 hover:opacity-100 text-lg leading-none shrink-0">&times;</button>
        </div>
      )}

      {/* Partner Request Form */}
      {showPairForm && (
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-6 mb-6">
          <h3 className="font-bold text-purple-900 mb-4">Request to Work With a Partner</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Partner&apos;s Name</label>
              <input
                type="text"
                value={partnerName}
                onChange={(e) => setPartnerName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-400 outline-none"
                placeholder="Their full name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Partner&apos;s Phone</label>
              <input
                type="tel"
                value={partnerPhone}
                onChange={(e) => setPartnerPhone(fmtPhoneInput(e.target.value))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-400 outline-none"
                placeholder="555-123-4567"
              />
              <p className="text-xs text-gray-400 mt-1">Helps us find them if they&apos;re already registered</p>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Message (optional)</label>
            <input
              type="text"
              value={pairMessage}
              onChange={(e) => setPairMessage(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-400 outline-none"
              placeholder="We'd like to work the beer tent together"
            />
          </div>

          {/* Register new partner toggle & fields */}
          <div className="mt-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={registerPartner}
                onChange={(e) => setRegisterPartner(e.target.checked)}
                className="w-4 h-4 text-purple-600 rounded border-gray-300 focus:ring-purple-500"
              />
              <span className="text-purple-800 font-medium">My partner isn&apos;t registered yet &mdash; sign them up</span>
            </label>
          </div>

          {registerPartner && (
            <div className="mt-3 bg-white border border-purple-200 rounded-lg p-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Partner&apos;s Email <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="email"
                  value={partnerEmail}
                  onChange={(e) => setPartnerEmail(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-400 outline-none"
                  placeholder="partner@example.com"
                />
              </div>
              {/* Partner 21+ verification */}
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-xs font-semibold text-amber-900 mb-2">🍺 Is your partner 21 or older?</p>
                <div className="flex gap-3">
                  <label className={`flex items-center gap-1.5 cursor-pointer px-3 py-1.5 rounded-lg border transition-colors text-xs font-medium ${
                    partnerIsOver21 === true ? "border-amber-500 bg-white text-amber-900" : "border-gray-200 bg-white text-gray-600 hover:border-amber-300"
                  }`}>
                    <input type="radio" name="partnerIsOver21" checked={partnerIsOver21 === true} onChange={() => setPartnerIsOver21(true)} className="accent-amber-600" />
                    Yes, 21+
                  </label>
                  <label className={`flex items-center gap-1.5 cursor-pointer px-3 py-1.5 rounded-lg border transition-colors text-xs font-medium ${
                    partnerIsOver21 === false ? "border-gray-400 bg-white text-gray-700" : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                  }`}>
                    <input type="radio" name="partnerIsOver21" checked={partnerIsOver21 === false} onChange={() => setPartnerIsOver21(false)} className="accent-gray-600" />
                    Under 21
                  </label>
                </div>
              </div>
              <p className="text-xs text-gray-500">Adding an email lets us send your partner a calendar invite. This creates a volunteer account for them.</p>
            </div>
          )}

          <button
            onClick={handlePairRequest}
            className="mt-4 bg-purple-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-purple-700"
          >
            {registerPartner ? "Register Partner & Submit Request" : "Submit Request"}
          </button>
        </div>
      )}

      {/* SMS opt-in prompt — shown to anyone with a phone who hasn't consented.
          This is how teammates added by a captain enroll themselves. */}
      {volunteer?.phone && !volunteer?.smsConsent && !volunteer?.smsOptOutAt && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1">
              <p className="font-semibold text-blue-900 text-sm mb-1">📱 Want text reminders about your shifts?</p>
              <p className="text-xs text-blue-800 leading-snug">
                Get a text before each shift you&apos;re assigned. By turning this on you agree to
                receive recurring automated SMS from the EGR Harvest + Beer Festival at{" "}
                <strong>{volunteer.phone}</strong>. Message frequency varies (about 5&ndash;10 per
                festival season). Message and data rates may apply. Reply STOP to cancel, HELP for
                help. See our{" "}
                <a href={SMS_TERMS_URL} target="_blank" rel="noopener noreferrer" className="underline font-medium">Terms</a>
                {" "}and{" "}
                <a href={SMS_PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="underline font-medium">Privacy Policy</a>.
              </p>
            </div>
            <button
              onClick={handleSelfOptIn}
              className="bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0"
            >
              Yes, text me
            </button>
          </div>
        </div>
      )}

      {/* Partner Requests */}
      {volunteer?.pairRequests && volunteer.pairRequests.length > 0 && (
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 mb-6">
          <h3 className="font-semibold text-purple-900 mb-2">Your Partner Requests</h3>
          {volunteer.pairRequests.map((pr) => (
            <div key={pr.id} className="flex items-center gap-3 text-sm">
              <span>Requested to work with: <strong>{pr.partner.name}</strong></span>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                pr.status === "approved" ? "bg-green-100 text-green-800" :
                pr.status === "denied" ? "bg-red-100 text-red-800" :
                "bg-yellow-100 text-yellow-800"
              }`}>
                {pr.status}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-amber-100 rounded-lg p-1">
        {(volunteer?.role === "team_lead" || volunteer?.pendingRole === "team_lead" || myTeams.length > 0 || memberTeams.length > 0 ? ["shifts", "my-schedule", "my-team"] as const : ["shifts", "my-schedule"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab
                ? "bg-white text-amber-900 shadow-sm"
                : "text-amber-700 hover:text-amber-900"
            }`}
          >
            {tab === "shifts" ? "Available Shifts" : tab === "my-schedule" ? (myTeams.length > 0 ? "My Team Schedule" : "My Schedule") : "My Team"}
          </button>
        ))}
      </div>

      {/* Available Shifts — Category → Time → Shift drill-down */}
      {activeTab === "shifts" && (() => {
        // Group shifts by category
        const categoryMap = new Map<string, { name: string; shifts: Shift[] }>();
        shifts.forEach((s) => {
          const catName = s.category?.name || "Uncategorized";
          const catId = s.category?.id || "none";
          if (!categoryMap.has(catId)) categoryMap.set(catId, { name: catName, shifts: [] });
          categoryMap.get(catId)!.shifts.push(s);
        });

        // If no category selected, show category menu
        if (!selectedCategory) {
          return (
            <div>
              <h3 className="text-lg font-bold text-amber-900 mb-3">Select a Category</h3>
              <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
                {Array.from(categoryMap.entries()).map(([catId, { name, shifts: catShifts }]) => {
                  const totalOpen = catShifts.reduce((sum, s) => sum + Math.max(0, s.capacity - s.assignments.length), 0);
                  const totalSlots = catShifts.reduce((sum, s) => sum + s.capacity, 0);
                  return (
                    <button
                      key={catId}
                      onClick={() => setSelectedCategory(catId)}
                      className="bg-white rounded-lg border border-amber-100 p-5 text-left hover:border-amber-400 hover:shadow-md transition-all group"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="font-bold text-amber-900 text-lg group-hover:text-amber-700">{name}</h4>
                        {catShifts[0]?.category?.requiresOver21 && (
                          <span className="flex-shrink-0 bg-amber-100 text-amber-800 text-xs font-bold px-2 py-0.5 rounded-full">🍺 21+</span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 mt-1">{catShifts.length} shift{catShifts.length !== 1 ? "s" : ""}</p>
                      <div className="mt-2 flex items-center gap-2">
                        <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${totalOpen > 0 ? "bg-green-500" : "bg-red-400"}`}
                            style={{ width: `${totalSlots > 0 ? Math.round(((totalSlots - totalOpen) / totalSlots) * 100) : 100}%` }}
                          />
                        </div>
                        <span className={`text-xs font-medium ${totalOpen > 0 ? "text-green-700" : "text-red-600"}`}>
                          {totalOpen > 0 ? `${totalOpen} open` : "Full"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
              {categoryMap.size === 0 && (
                <p className="text-gray-500 text-center py-8">No shifts available yet.</p>
              )}
            </div>
          );
        }

        // Category selected — show shifts sorted by time
        const catData = categoryMap.get(selectedCategory);
        if (!catData) return null;
        const sortedShifts = [...catData.shifts].sort((a, b) => a.startTime.localeCompare(b.startTime));

        return (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <button
                onClick={() => setSelectedCategory(null)}
                className="bg-gray-100 text-gray-700 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors flex items-center gap-1"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 12L6 8l4-4"/></svg>
                All Categories
              </button>
              <h3 className="text-lg font-bold text-amber-900">{catData.name}</h3>
            </div>

            <div className="space-y-3">
              {sortedShifts.map((shift) => {
                const filled = shift.assignments.length;
                const available = shift.capacity - filled;
                const isConfirmed = shift.assignments.some(
                  (a) => a.volunteer.id === volunteer?.id
                );
                const isPending = volunteer?.assignments.some(
                  (a) => a.shiftId === shift.id && a.status === "pending"
                );

                return (
                  <div key={shift.id} className="bg-white rounded-lg shadow-sm border border-amber-100 p-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <div className="bg-amber-100 text-amber-800 px-3 py-1 rounded-lg text-sm font-bold whitespace-nowrap">
                            {fmt12(shift.startTime)} – {fmt12(shift.endTime)}
                          </div>
                          <div>
                            <h4 className="font-bold text-amber-900">{shift.title}</h4>
                            {shift.description && <p className="text-xs text-gray-500 mt-0.5">{shift.description}</p>}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 mt-2 ml-0 sm:ml-0">
                          <div className="flex-1 max-w-[200px] h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                available === 0 ? "bg-red-400" : available <= 2 ? "bg-amber-500" : "bg-green-500"
                              }`}
                              style={{ width: `${shift.capacity > 0 ? Math.round((filled / shift.capacity) * 100) : 100}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-500">{filled}/{shift.capacity} filled</span>
                          <span className={`text-xs font-medium ${available > 0 ? "text-green-700" : "text-red-600"}`}>
                            {available > 0 ? `${available} open` : "Full"}
                          </span>
                        </div>
                      </div>
                      <div className="shrink-0 flex flex-col items-stretch gap-1.5">
                        {isConfirmed && (() => {
                          const myAssignment = volunteer?.assignments.find(
                            (a) => a.shiftId === shift.id && a.status === "confirmed"
                          );
                          return (
                            <>
                              <span className="bg-green-100 text-green-700 px-4 py-2 rounded-lg text-sm font-medium inline-block text-center">Confirmed</span>
                              {myAssignment && (
                                <button
                                  onClick={() => handleRemove(myAssignment.id)}
                                  className="text-red-600 hover:text-red-800 text-xs font-medium underline"
                                >
                                  Cancel my sign-up
                                </button>
                              )}
                            </>
                          );
                        })()}
                        {!isConfirmed && isPending && (
                          <span className="bg-yellow-100 text-yellow-700 px-4 py-2 rounded-lg text-sm font-medium inline-block text-center">Pending Approval</span>
                        )}
                        {myTeams.length > 0 && available > 0 && (
                          <button
                            onClick={() => setMemberSignUpModal({ shift, selectedIds: new Set() })}
                            className="bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-800 transition-colors"
                          >
                            Sign Up Members
                          </button>
                        )}
                        {myTeams.length === 0 && !isConfirmed && !isPending && (
                          available > 0 ? (
                            <button
                              onClick={() => handleSignUp(shift.id)}
                              className="bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-800 transition-colors"
                            >
                              Request This Shift
                            </button>
                          ) : (
                            <span className="text-red-600 font-medium text-sm">No spots available</span>
                          )
                        )}
                        {myTeams.length > 0 && available === 0 && !isConfirmed && !isPending && (
                          <span className="text-red-600 font-medium text-sm">No spots available</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* "Done selecting" sticky bar — shown for new signups browsing the shifts tab */}
      {isNewSignup && activeTab === "shifts" && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t-2 border-green-300 shadow-lg">
          <div className="max-w-6xl mx-auto px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3">
            {(() => {
              // Each "Request This Shift" already commits immediately, so this bar must
              // not imply the sign-up is still incomplete — it's just a way to finish up.
              const locked = volunteer?.assignments.filter((a) => a.status === "confirmed").length || 0;
              return (
                <>
                  <div className="text-sm text-gray-600 text-center sm:text-left">
                    {locked > 0 ? (
                      <>
                        <span className="font-semibold text-green-700">
                          ✅ {locked} shift{locked !== 1 ? "s" : ""} confirmed — you&apos;re signed up.
                        </span>
                        {" "}Keep browsing, or finish up.
                      </>
                    ) : (
                      <>
                        <span className="font-semibold text-green-700">Pick a shift to get started.</span>
                        {" "}Your spot is reserved the moment you request it.
                      </>
                    )}
                  </div>
                  <button
                    onClick={() => { setIsNewSignup(false); setStep("signup-complete"); }}
                    className="bg-green-700 text-white px-8 py-2.5 rounded-lg font-bold hover:bg-green-800 transition-colors whitespace-nowrap shadow-sm"
                  >
                    {locked > 0 ? "I'm Done →" : "Skip for Now →"}
                  </button>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* My Schedule / My Team Schedule */}
      {activeTab === "my-schedule" && myTeams.length > 0 && (() => {
        // Team captain view: show all members' shifts with print/export
        const team = myTeams[0];
        const allMembers = team.members;
        return (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-teal-900">My Team Schedule — {team.name}</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => exportTeamCsv(team)}
                  className="bg-gray-100 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-200 flex items-center gap-1"
                >
                  ⬇ Export CSV
                </button>
                <button
                  onClick={() => printTeamSchedule(team)}
                  className="bg-teal-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-teal-800 flex items-center gap-1"
                >
                  🖨 Print
                </button>
              </div>
            </div>
            <div className="space-y-3">
              {allMembers.map((tm) => {
                const isMe = tm.volunteer.id === volunteer?.id;
                const memberShifts = (tm.volunteer.assignments || []).filter((a) => a.status === "confirmed");
                const pendingShifts = (tm.volunteer.assignments || []).filter((a) => a.status === "pending");
                return (
                  <div key={tm.id} className={`rounded-xl border p-4 ${isMe ? "bg-teal-50 border-teal-200" : "bg-white border-gray-200"}`}>
                    <p className="font-semibold text-sm text-gray-800 mb-2">
                      {isMe ? <span className="text-teal-700">👑 {tm.volunteer.name} (you)</span> : tm.volunteer.name}
                    </p>
                    {memberShifts.length === 0 && pendingShifts.length === 0 ? (
                      <p className="text-xs text-gray-400">No shifts assigned</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {memberShifts.map((a) => (
                          <span key={a.id} className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full font-medium">
                            ✓ {a.shift.title} {fmt12(a.shift.startTime)}–{fmt12(a.shift.endTime)}
                          </span>
                        ))}
                        {pendingShifts.map((a) => (
                          <span key={a.id} className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full">
                            ⏳ {a.shift.title} {fmt12(a.shift.startTime)}–{fmt12(a.shift.endTime)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {activeTab === "my-schedule" && myTeams.length === 0 && (
        <div className="space-y-4">
          {/* Pending requests */}
          {volunteer?.assignments.filter((a) => a.status === "pending").map((assignment) => (
            <div key={assignment.id} className="bg-yellow-50 rounded-lg shadow-sm border border-yellow-200 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="bg-yellow-200 text-yellow-800 px-2 py-0.5 rounded text-xs font-medium">Pending Approval</span>
                  <h3 className="font-bold text-lg text-amber-900">{assignment.shift.title}</h3>
                </div>
                <div className="text-sm text-gray-600 space-y-1 mt-1">
                  <p>
                    {new Date(assignment.shift.date).toLocaleDateString("en-US", {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    })}
                  </p>
                  <p>{fmt12(assignment.shift.startTime)} - {fmt12(assignment.shift.endTime)}</p>
                </div>
              </div>
              <button
                onClick={() => handleRemove(assignment.id)}
                className="bg-gray-100 text-gray-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors whitespace-nowrap"
              >
                Cancel Request
              </button>
            </div>
          ))}

          {/* Confirmed assignments */}
          {volunteer?.assignments.filter((a) => a.status === "confirmed").map((assignment) => (
            <div key={assignment.id} className="bg-white rounded-lg shadow-sm border border-green-200 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded text-xs font-medium">Confirmed</span>
                  <h3 className="font-bold text-lg text-amber-900">{assignment.shift.title}</h3>
                </div>
                <div className="text-sm text-gray-600 space-y-1 mt-1">
                  <p>
                    {new Date(assignment.shift.date).toLocaleDateString("en-US", {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    })}
                  </p>
                  <p>{fmt12(assignment.shift.startTime)} - {fmt12(assignment.shift.endTime)}</p>
                </div>
              </div>
              {removingAssignmentId === assignment.id ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Remove from this shift?</span>
                  <button
                    onClick={() => { handleRemove(assignment.id); setRemovingAssignmentId(null); }}
                    className="bg-red-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
                  >Yes, remove</button>
                  <button
                    onClick={() => setRemovingAssignmentId(null)}
                    className="bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
                  >Keep</button>
                </div>
              ) : (
                <button
                  onClick={() => setRemovingAssignmentId(assignment.id)}
                  className="bg-red-100 text-red-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-200 transition-colors whitespace-nowrap"
                >
                  Remove Me
                </button>
              )}
            </div>
          ))}

          {/* Denied (recent) */}
          {volunteer?.assignments.filter((a) => a.status === "denied").map((assignment) => (
            <div key={assignment.id} className="bg-red-50 rounded-lg shadow-sm border border-red-200 p-5 opacity-60">
              <div className="flex items-center gap-2">
                <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs font-medium">Not Approved</span>
                <h3 className="font-bold text-amber-900">{assignment.shift.title}</h3>
              </div>
              <p className="text-xs text-gray-500 mt-1">{fmt12(assignment.shift.startTime)} - {fmt12(assignment.shift.endTime)}</p>
            </div>
          ))}

          {(!volunteer?.assignments || volunteer.assignments.filter((a) => ["confirmed", "pending"].includes(a.status)).length === 0) && (
            <p className="text-gray-500 text-center py-8">
              You haven&apos;t signed up for any shifts yet. Head to &quot;Available Shifts&quot; to get started!
            </p>
          )}
        </div>
      )}

      {/* Team member sign-up modal (team captain picks which members to sign up) */}
      {memberSignUpModal && (() => {
        const { shift, selectedIds } = memberSignUpModal;
        const allMembers = myTeams.flatMap((t) => t.members);
        const openSlots = shift.capacity - shift.assignments.length;
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6">
              <h2 className="text-lg font-bold text-amber-900 mb-1">{shift.title}</h2>
              <p className="text-sm text-gray-500 mb-1">{fmt12(shift.startTime)} – {fmt12(shift.endTime)}</p>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-gray-400">{openSlots} spot{openSlots !== 1 ? "s" : ""} open</p>
                <p className={`text-xs font-semibold ${selectedIds.size > openSlots ? "text-red-600" : "text-amber-700"}`}>
                  {selectedIds.size} of {openSlots} selected
                </p>
              </div>
              {selectedIds.size > openSlots && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
                  Too many selected — this shift only has {openSlots} spot{openSlots !== 1 ? "s" : ""} left.
                </p>
              )}
              <div className="space-y-2 max-h-60 overflow-y-auto mb-4">
                {allMembers.map((tm) => {
                  const alreadyOn = shift.assignments.some((a) => a.volunteer.id === tm.volunteer.id);
                  const isMe = tm.volunteer.id === volunteer?.id;
                  // Flag a member already booked on a shift that overlaps this one
                  const conflict = (tm.volunteer.assignments || []).find(
                    (a) => a.status === "confirmed" && a.shiftId !== shift.id &&
                      timesOverlap(shift.startTime, shift.endTime, a.shift.startTime, a.shift.endTime)
                  );
                  const blocked = alreadyOn || !!conflict;
                  return (
                    <label key={tm.id} className={`flex items-start gap-3 rounded-lg p-2.5 ${blocked ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-amber-50"}`}>
                      <input
                        type="checkbox"
                        checked={alreadyOn || selectedIds.has(tm.volunteer.id)}
                        disabled={blocked}
                        onChange={(e) => {
                          const next = new Set(selectedIds);
                          if (e.target.checked) next.add(tm.volunteer.id);
                          else next.delete(tm.volunteer.id);
                          setMemberSignUpModal({ ...memberSignUpModal, selectedIds: next });
                        }}
                        className="w-4 h-4 accent-amber-600 mt-0.5"
                      />
                      <span className="text-sm font-medium text-gray-800">
                        {tm.volunteer.name}{isMe ? " (you)" : ""}
                        {alreadyOn && <span className="block text-xs text-green-600 font-normal">✓ already on this shift</span>}
                        {!alreadyOn && conflict && (
                          <span className="block text-xs text-red-500 font-normal">
                            ✕ already on {conflict.shift.title} ({fmt12(conflict.shift.startTime)}–{fmt12(conflict.shift.endTime)})
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setMemberSignUpModal(null)}
                  className="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg font-medium hover:bg-gray-200 text-sm"
                >Cancel</button>
                <button
                  onClick={handleMemberSignUp}
                  disabled={selectedIds.size === 0 || selectedIds.size > openSlots}
                  className="flex-1 bg-amber-700 text-white py-2 rounded-lg font-medium hover:bg-amber-800 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >Sign Up Selected</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* SMS opt-in reminder after creating a team from the dashboard */}
      {showOptInNotice && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 text-center">
            <div className="text-4xl mb-3">📱</div>
            <h2 className="text-lg font-bold text-teal-900 mb-3">One more thing</h2>
            <p className="text-sm text-gray-700 leading-relaxed mb-5">
              If you want your team members to receive automated text reminders, please
              have each person sign in to opt in for messages. Thank you captain!
            </p>
            <button
              onClick={() => setShowOptInNotice(false)}
              className="w-full bg-teal-700 text-white py-2.5 rounded-lg font-semibold hover:bg-teal-800 transition-colors"
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {/* Duplicate shift time warning modal */}
      {dupWarningShiftId && (() => {
        const target = shifts.find((s) => s.id === dupWarningShiftId);
        const conflict = volunteer?.assignments
          .filter((a) => a.status === "confirmed" || a.status === "pending")
          .find((a) => target && timesOverlap(target.startTime, target.endTime, a.shift.startTime, a.shift.endTime));
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6">
              <div className="text-3xl text-center mb-3">⚠️</div>
              <h2 className="text-lg font-bold text-gray-900 text-center mb-2">Duplicate Shift Time</h2>
              <p className="text-sm text-gray-600 text-center mb-2">
                <strong>{target?.title}</strong> ({fmt12(target?.startTime || "")} – {fmt12(target?.endTime || "")})
                overlaps with your existing shift:
              </p>
              <p className="text-sm font-medium text-amber-800 text-center bg-amber-50 rounded-lg py-2 px-3 mb-5">
                {conflict?.shift.title} ({fmt12(conflict?.shift.startTime || "")} – {fmt12(conflict?.shift.endTime || "")})
              </p>
              <p className="text-sm text-gray-500 text-center mb-5">Do you still want to sign up?</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDupWarningShiftId(null)}
                  className="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg font-medium hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => doSignUp(dupWarningShiftId)}
                  className="flex-1 bg-amber-700 text-white py-2 rounded-lg font-medium hover:bg-amber-800 transition-colors"
                >
                  Yes, Sign Me Up
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ========= MY TEAM TAB ========= */}
      {activeTab === "my-team" && (volunteer?.role === "team_lead" || volunteer?.pendingRole === "team_lead" || myTeams.length > 0 || memberTeams.length > 0) && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-teal-900">My Teams</h2>
            {/* Only show create button if captain has no teams yet */}
            {myTeams.length === 0 && (
              <button
                onClick={() => setShowTeamForm(!showTeamForm)}
                className="bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-teal-800 transition-colors"
              >
                {showTeamForm ? "Cancel" : "+ Create Team"}
              </button>
            )}
          </div>

          {/* ── Member view: teams this volunteer belongs to but does not lead ── */}
          {memberTeams.map((team) => {
            const me = team.members.find((m) => m.volunteer.id === volunteer?.id);
            const myShifts = (me?.volunteer.assignments || []).filter((a) => a.status === "confirmed");
            return (
              <div key={team.id} className="bg-white rounded-xl border border-teal-100 shadow-sm p-5 mb-4">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <span className="text-lg">👥</span>
                  <h3 className="font-bold text-lg text-teal-900">{team.name}</h3>
                  <span className="text-xs bg-teal-100 text-teal-800 px-2 py-0.5 rounded-full">
                    captain: {team.leader?.name || "—"}
                  </span>
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                    {team.members.length} member{team.members.length !== 1 ? "s" : ""}
                  </span>
                </div>

                <div className={`rounded-lg p-3 mb-3 text-sm ${myShifts.length > 0 ? "bg-green-50 border border-green-200" : "bg-amber-50 border border-amber-200"}`}>
                  {myShifts.length > 0 ? (
                    <>
                      <p className="font-medium text-green-900 mb-1.5">Your shifts on this team:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {myShifts.map((a) => (
                          <span key={a.id} className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full font-medium">
                            {a.shift.title} {fmt12(a.shift.startTime)}–{fmt12(a.shift.endTime)}
                          </span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-amber-900">
                      No shifts yet — {team.leader?.name || "your captain"} will assign you, or you
                      can pick your own from{" "}
                      <button onClick={() => setActiveTab("shifts")} className="underline font-medium">Available Shifts</button>.
                    </p>
                  )}
                </div>

                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Teammates</p>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {team.members.map((m) => (
                    <span
                      key={m.id}
                      className={`text-xs px-2 py-0.5 rounded-full ${m.volunteer.id === volunteer?.id ? "bg-teal-100 text-teal-800 font-semibold" : "bg-gray-100 text-gray-700"}`}
                    >
                      {m.volunteer.id === team.leaderId && "👑 "}
                      {m.volunteer.name}{m.volunteer.id === volunteer?.id ? " (you)" : ""}
                    </span>
                  ))}
                </div>

                <button
                  onClick={async () => {
                    await fetch("/api/teams/join", {
                      method: "DELETE",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ volunteerId: volunteer?.id, teamId: team.id }),
                    });
                    setSuccess(`You left ${team.name}.`);
                    refreshData();
                  }}
                  className="text-red-400 hover:text-red-600 text-xs font-medium"
                >Leave this team</button>
              </div>
            );
          })}

          {/* Join a team later — for anyone who skipped at signup */}
          {myTeams.length === 0 && memberTeams.length === 0 && allTeams.length > 0 && (
            <div className="bg-teal-50 border border-teal-200 rounded-xl p-5 mb-4">
              <p className="font-semibold text-teal-900 text-sm mb-1">Volunteering with a group?</p>
              <p className="text-xs text-teal-800 mb-3">
                Join their team and your captain can coordinate your shifts.
              </p>
              <div className="flex flex-wrap gap-2">
                <select
                  value={joinTeamId}
                  onChange={(e) => setJoinTeamId(e.target.value)}
                  className="flex-1 min-w-[180px] border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-teal-400 outline-none"
                >
                  <option value="">— Select a team —</option>
                  {allTeams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} (captain: {t.leader?.name || "—"})
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => handleJoinTeam("captain")}
                  disabled={!joinTeamId || joinLoading}
                  className="bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-teal-800 disabled:opacity-40 disabled:cursor-not-allowed"
                >Join Team</button>
              </div>
            </div>
          )}

          {/* Sub-tab: Roster | My Team Schedule */}
          {myTeams.length > 0 && (
            <div className="flex gap-1 mb-5 bg-teal-50 rounded-lg p-1 border border-teal-100">
              <button
                onClick={() => setTeamSubTab("roster")}
                className={`flex-1 py-1.5 px-3 rounded text-sm font-medium transition-colors ${teamSubTab === "roster" ? "bg-white text-teal-900 shadow-sm" : "text-teal-700 hover:text-teal-900"}`}
              >Roster</button>
              <button
                onClick={() => setTeamSubTab("schedule")}
                className={`flex-1 py-1.5 px-3 rounded text-sm font-medium transition-colors ${teamSubTab === "schedule" ? "bg-white text-teal-900 shadow-sm" : "text-teal-700 hover:text-teal-900"}`}
              >My Team Schedule</button>
            </div>
          )}

          {/* Create Team Form */}
          {showTeamForm && (
            <div className="bg-teal-50 border border-teal-200 rounded-xl p-6 mb-6 space-y-4">
              <h3 className="font-bold text-teal-900">Create a New Team</h3>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Team Name *</label>
                <input
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-teal-400 outline-none"
                  placeholder="e.g., Smith Family Crew"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Team Members (name only is fine)</label>
                {newTeamMembers.map((m, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 mb-2">
                    <input
                      value={m.name}
                      onChange={(e) => { const u = [...newTeamMembers]; u[i] = { ...u[i], name: e.target.value }; setNewTeamMembers(u); }}
                      className="flex-1 min-w-[130px] border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-teal-400 outline-none"
                      placeholder={`Member ${i + 1} name`}
                    />
                    <input
                      type="tel"
                      value={m.phone}
                      onChange={(e) => { const u = [...newTeamMembers]; u[i] = { ...u[i], phone: fmtPhoneInput(e.target.value) }; setNewTeamMembers(u); }}
                      className="flex-1 min-w-[130px] border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-teal-400 outline-none"
                      placeholder="Phone (optional)"
                    />
                    <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={m.isOver21 === true}
                        onChange={(e) => {
                          const u = [...newTeamMembers];
                          u[i] = { ...u[i], isOver21: e.target.checked ? true : null };
                          setNewTeamMembers(u);
                        }}
                        className="w-3.5 h-3.5 accent-amber-600"
                      />
                      21+
                    </label>
                    {newTeamMembers.length > 1 && (
                      <button onClick={() => setNewTeamMembers(newTeamMembers.filter((_, j) => j !== i))} className="text-red-500 text-sm px-2 hover:text-red-700">Remove</button>
                    )}
                  </div>
                ))}
                <p className="text-xs text-gray-400 mb-1">Check &quot;21+&quot; for members who are 21 or older (required for pouring roles).</p>
                <button onClick={() => setNewTeamMembers([...newTeamMembers, { name: "", phone: "", isOver21: null }])} className="text-teal-700 text-sm font-medium hover:text-teal-900">+ Add Another Member</button>
              </div>
              <button onClick={handleCreateTeam} className="bg-teal-700 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-teal-800">Create Team</button>
            </div>
          )}

          {/* My Teams List */}
          {myTeams.length === 0 && !showTeamForm && (
            <p className="text-gray-500 text-center py-8">You haven&apos;t created any teams yet. Click &quot;+ Create Team&quot; to get started!</p>
          )}

          {myTeams.map((team) => (
            <div key={team.id} className="bg-white rounded-xl border border-teal-100 shadow-sm p-5 mb-4">

              {/* ── ROSTER sub-tab ── */}
              {teamSubTab === "roster" && (
                <>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">👥</span>
                      <h3 className="font-bold text-lg text-teal-900">{team.name}</h3>
                      <span className="text-xs bg-teal-100 text-teal-800 px-2 py-0.5 rounded-full">{team.members.length} members</span>
                    </div>
                    <button
                      onClick={() => setTeamSignUpTeamId(teamSignUpTeamId === team.id ? null : team.id)}
                      className="bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-800"
                    >
                      Sign Up Whole Team for Shift
                    </button>
                  </div>

                  {/* Whole-team shift sign-up panel */}
                  {teamSignUpTeamId === team.id && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                      <h4 className="font-medium text-amber-900 mb-3">Choose a shift for your whole team:</h4>
                      <div className="space-y-2 max-h-60 overflow-y-auto">
                        {shifts.filter((s) => s.capacity - s.assignments.length > 0).map((s) => (
                          <div key={s.id} className="flex items-center justify-between bg-white rounded-lg p-3 border border-amber-100">
                            <div>
                              <span className="font-medium text-amber-900">{s.title}</span>
                              {s.category && <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{s.category.name}</span>}
                              <p className="text-xs text-gray-500">{fmt12(s.startTime)} - {fmt12(s.endTime)} &middot; {s.capacity - s.assignments.length} spots open</p>
                            </div>
                            <button
                              onClick={() => handleTeamSignUp(team.id, s.id)}
                              className="bg-amber-700 text-white px-3 py-1.5 rounded text-xs font-medium hover:bg-amber-800"
                            >
                              Sign Up Team
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Drag-to-assign: available shifts palette */}
                  <div className="mb-4">
                    <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Drag a shift onto a member to assign</p>
                    <div className="flex flex-wrap gap-2">
                      {shifts.filter((s) => s.capacity - s.assignments.length > 0).map((s) => (
                        <div
                          key={s.id}
                          draggable
                          onDragStart={() => setDragShiftId(s.id)}
                          onDragEnd={() => { setDragShiftId(null); setDragOverMemberId(null); }}
                          className={`cursor-grab active:cursor-grabbing bg-amber-50 border border-amber-300 text-amber-900 text-xs px-2.5 py-1 rounded-full select-none ${dragShiftId === s.id ? "opacity-50" : ""}`}
                        >
                          📋 {s.title} {fmt12(s.startTime)}
                        </div>
                      ))}
                    </div>
                    {shifts.filter((s) => s.capacity - s.assignments.length > 0).length === 0 && (
                      <p className="text-xs text-gray-400">No open shifts available</p>
                    )}
                  </div>

                  {/* Team Members (drop targets) */}
                  <div className="space-y-2">
                    {team.members.map((tm) => {
                      const isLeader = tm.volunteer.id === volunteer?.id;
                      const memberShifts = (tm.volunteer.assignments || []).filter((a) => a.status === "confirmed");
                      const isOver = dragOverMemberId === tm.volunteer.id;
                      return (
                        <div
                          key={tm.id}
                          onDragOver={(e) => { if (dragShiftId) { e.preventDefault(); setDragOverMemberId(tm.volunteer.id); } }}
                          onDragLeave={() => setDragOverMemberId(null)}
                          onDrop={async () => { if (dragShiftId) await handleDragAssign(tm.volunteer.id, dragShiftId); }}
                          className={`rounded-lg p-3 text-sm transition-colors ${isOver && dragShiftId ? "bg-teal-100 border-2 border-teal-400 border-dashed" : isLeader ? "bg-teal-50 border border-teal-200" : "bg-gray-50 border border-gray-200"}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1 font-medium flex-wrap">
                              {isLeader && <span className="text-teal-600 text-xs font-bold">TL</span>}
                              {tm.volunteer.name}
                              {tm.volunteer.phone && (
                                tm.volunteer.smsConsent ? (
                                  <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-normal" title="This member opted in to text reminders">
                                    📱 texts on
                                  </span>
                                ) : (
                                  <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full font-normal" title="They must turn on texts themselves — we can't do it for them">
                                    texts off
                                  </span>
                                )
                              )}
                              {!tm.volunteer.phone && (
                                <span className="text-xs bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full font-normal">no phone</span>
                              )}
                              {isOver && dragShiftId && <span className="text-teal-600 text-xs ml-1">← drop here</span>}
                            </div>
                            {!isLeader && (
                              removingMemberId === tm.volunteer.id ? (
                                <span className="flex items-center gap-1.5 shrink-0">
                                  <span className="text-xs text-gray-600">
                                    {memberShifts.length > 0
                                      ? `Remove & free ${memberShifts.length} shift${memberShifts.length !== 1 ? "s" : ""}?`
                                      : "Remove from team?"}
                                  </span>
                                  <button
                                    onClick={async () => {
                                      setRemovingMemberId(null);
                                      await fetch("/api/teams", {
                                        method: "PUT",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ id: team.id, removeMembers: [tm.volunteer.id], requesterId: volunteer?.id }),
                                      });
                                      setSuccess(`${tm.volunteer.name} removed from ${team.name}.`);
                                      refreshData();
                                    }}
                                    className="bg-red-600 text-white px-2 py-0.5 rounded text-xs font-medium hover:bg-red-700"
                                  >Yes, remove</button>
                                  <button
                                    onClick={() => setRemovingMemberId(null)}
                                    className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-xs font-medium hover:bg-gray-200"
                                  >Keep</button>
                                </span>
                              ) : (
                                <button
                                  onClick={() => setRemovingMemberId(tm.volunteer.id)}
                                  className="text-red-400 hover:text-red-600 text-xs font-medium shrink-0"
                                  title="Remove this person from the team entirely"
                                >Remove from team</button>
                              )
                            )}
                          </div>
                          {memberShifts.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {memberShifts.map((a) => (
                                <span key={a.id} className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-800 pl-1.5 pr-1 py-0.5 rounded-full">
                                  {a.shift.title} {fmt12(a.shift.startTime)}
                                  <button
                                    onClick={() => handleRemoveMemberShift(a.id, tm.volunteer.name, a.shift.title)}
                                    className="text-amber-500 hover:text-red-600 font-bold leading-none px-0.5"
                                    title={`Remove ${tm.volunteer.name} from ${a.shift.title} (frees the slot)`}
                                  >&times;</button>
                                </span>
                              ))}
                            </div>
                          )}
                          {memberShifts.length === 0 && (
                            <p className="text-xs text-gray-400 mt-1">{dragShiftId ? "Drop here to assign" : "No shifts assigned"}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Add new members inline (name + optional phone) */}
                  <div className="mt-3 flex flex-wrap gap-2 items-center">
                    <input
                      value={addMemberName}
                      onChange={(e) => setAddMemberName(e.target.value)}
                      placeholder="Add member by name..."
                      className="flex-1 min-w-[140px] border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-teal-400 outline-none"
                      onKeyDown={(e) => { if (e.key === "Enter") handleAddMember(team.id); }}
                    />
                    <input
                      type="tel"
                      value={addMemberPhone}
                      onChange={(e) => setAddMemberPhone(fmtPhoneInput(e.target.value))}
                      placeholder="Phone (optional)"
                      className="flex-1 min-w-[130px] border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-teal-400 outline-none"
                      onKeyDown={(e) => { if (e.key === "Enter") handleAddMember(team.id); }}
                    />
                    <button
                      onClick={() => handleAddMember(team.id)}
                      disabled={!addMemberName.trim()}
                      className="bg-teal-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-teal-800 disabled:opacity-40 disabled:cursor-not-allowed"
                    >Add</button>
                  </div>
                </>
              )}

              {/* ── MY TEAM SCHEDULE sub-tab ── */}
              {teamSubTab === "schedule" && (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-lg text-teal-900">{team.name} — Schedule</h3>
                    <div className="flex gap-2">
                      <button
                        onClick={() => exportTeamCsv(team)}
                        className="bg-gray-100 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-200"
                      >⬇ Export CSV</button>
                      <button
                        onClick={() => printTeamSchedule(team)}
                        className="bg-teal-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-teal-800"
                      >🖨 Print</button>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {team.members.map((tm) => {
                      const isMe = tm.volunteer.id === volunteer?.id;
                      const memberShifts = (tm.volunteer.assignments || []).filter((a) => a.status === "confirmed");
                      const pending = (tm.volunteer.assignments || []).filter((a) => a.status === "pending");
                      return (
                        <div key={tm.id} className={`rounded-xl border p-4 ${isMe ? "bg-teal-50 border-teal-200" : "bg-white border-gray-200"}`}>
                          <p className="font-semibold text-sm text-gray-800 mb-2">
                            {isMe ? <span className="text-teal-700">👑 {tm.volunteer.name} (you)</span> : tm.volunteer.name}
                          </p>
                          {memberShifts.length === 0 && pending.length === 0 ? (
                            <p className="text-xs text-gray-400">No shifts assigned yet</p>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {memberShifts.map((a) => (
                                <span key={a.id} className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full font-medium">
                                  ✓ {a.shift.title} {fmt12(a.shift.startTime)}–{fmt12(a.shift.endTime)}
                                </span>
                              ))}
                              {pending.map((a) => (
                                <span key={a.id} className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full">
                                  ⏳ {a.shift.title} {fmt12(a.shift.startTime)}–{fmt12(a.shift.endTime)}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
