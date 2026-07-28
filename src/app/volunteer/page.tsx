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
  volunteer: { id: string; name: string; email?: string; phone?: string; assignments?: Assignment[] };
}

interface Team {
  id: string;
  name: string;
  leaderId: string;
  leader: { id: string; name: string };
  members: TeamMember[];
}

interface Volunteer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  assignments: Assignment[];
  pairRequests: { id: string; status: string; partner: { name: string } }[];
}

export default function VolunteerPortal() {
  const [step, setStep] = useState<"choose" | "lookup" | "register" | "team-setup" | "shift-choice" | "signup-complete" | "dashboard">("choose");
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
  const [showTeamForm, setShowTeamForm] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamMembers, setNewTeamMembers] = useState<{ name: string; isOver21: boolean | null }[]>([{ name: "", isOver21: null }]);
  const [teamSignUpShiftId, setTeamSignUpShiftId] = useState<string | null>(null);
  const [teamSignUpTeamId, setTeamSignUpTeamId] = useState<string | null>(null);

  // Tracks whether we're in a "first-time shift selection" session (new signup flow)
  const [isNewSignup, setIsNewSignup] = useState(false);

  // Shift ID pending confirmation after a duplicate-time warning
  const [dupWarningShiftId, setDupWarningShiftId] = useState<string | null>(null);

  // Shift selection drill-down: category → shift
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

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
        // Only send contactPref when both channels are provided; otherwise it's implied
        contactPref: (email && phone) ? contactPref : (email ? "email" : "sms"),
        isOver21,
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
      setStep(registerAsTeamLead ? "team-setup" : "dashboard");
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
    if (teamRes.ok) {
      const allTeams: Team[] = await teamRes.json();
      setMyTeams(allTeams.filter((t) => t.leaderId === volId));
    }
  };

  // Load teams when logging in
  const loadTeams = async (volId: string) => {
    const res = await fetch("/api/teams");
    if (res.ok) {
      const allTeams: Team[] = await res.json();
      setMyTeams(allTeams.filter((t) => t.leaderId === volId));
    }
  };

  const handleCreateTeam = async () => {
    if (!volunteer || !newTeamName.trim()) return;
    setError("");
    const validMembers = newTeamMembers
      .filter((m) => m.name.trim())
      .map((m) => ({ name: m.name.trim(), isOver21: m.isOver21 }));
    const res = await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newTeamName, leaderId: volunteer.id, memberNames: validMembers }),
    });
    if (res.ok) {
      setNewTeamName("");
      setNewTeamMembers([{ name: "", isOver21: null }]);
      if (step === "team-setup") {
        // Coming from registration — load teams then ask about shift selection
        refreshData();
        setStep("shift-choice");
      } else {
        setSuccess("Team created! You can now sign your team up for shifts.");
        setShowTeamForm(false);
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
                    className="flex-1 min-w-[140px] border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-teal-400 outline-none"
                    placeholder={`Member ${i + 1} name`}
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
              <button
                onClick={() => setNewTeamMembers([...newTeamMembers, { name: "", isOver21: null }])}
                className="text-teal-700 text-sm font-medium hover:text-teal-900 mt-1"
              >
                + Add Another Member
              </button>
            </div>

            {/* Actions */}
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
                setNewTeamMembers([{ name: "", isOver21: null }]);
                setStep("dashboard");
              }}
              className="w-full text-gray-500 text-sm hover:text-gray-700 transition-colors"
            >
              Skip for Now — I&apos;ll Set Up My Team Later
            </button>
          </div>
        </div>
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
            {volunteer?.role === "team_lead" && <span className="ml-2 text-sm bg-teal-100 text-teal-800 px-2 py-1 rounded-full align-middle">Team Lead</span>}
          </h1>
          <p className="text-gray-600 mt-1">
            {volunteer?.assignments.filter((a) => a.status === "confirmed").length || 0} active assignment(s)
          </p>
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
        {(volunteer?.role === "team_lead" || myTeams.length > 0 ? ["shifts", "my-schedule", "my-team"] as const : ["shifts", "my-schedule"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab
                ? "bg-white text-amber-900 shadow-sm"
                : "text-amber-700 hover:text-amber-900"
            }`}
          >
            {tab === "shifts" ? "Available Shifts" : tab === "my-schedule" ? "My Schedule" : "My Team"}
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
                      <div className="shrink-0">
                        {isConfirmed ? (
                          <span className="bg-green-100 text-green-700 px-4 py-2 rounded-lg text-sm font-medium inline-block">Confirmed</span>
                        ) : isPending ? (
                          <span className="bg-yellow-100 text-yellow-700 px-4 py-2 rounded-lg text-sm font-medium inline-block">Pending Approval</span>
                        ) : available > 0 ? (
                          <button
                            onClick={() => handleSignUp(shift.id)}
                            className="bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-800 transition-colors"
                          >
                            Request This Shift
                          </button>
                        ) : (
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
            <div className="text-sm text-gray-600 text-center sm:text-left">
              <span className="font-semibold text-green-700">✅ Done picking shifts?</span>
              {" "}Click Confirm to complete your sign-up.
            </div>
            <button
              onClick={() => { setIsNewSignup(false); setStep("signup-complete"); }}
              className="bg-green-700 text-white px-8 py-2.5 rounded-lg font-bold hover:bg-green-800 transition-colors whitespace-nowrap shadow-sm"
            >
              Confirm My Selection →
            </button>
          </div>
        </div>
      )}

      {/* My Schedule */}
      {activeTab === "my-schedule" && (
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
      {activeTab === "my-team" && (volunteer?.role === "team_lead" || myTeams.length > 0) && (
        <div>
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-teal-900">My Teams</h2>
            <button
              onClick={() => setShowTeamForm(!showTeamForm)}
              className="bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-teal-800 transition-colors"
            >
              {showTeamForm ? "Cancel" : "+ Create Team"}
            </button>
          </div>

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
                      className="flex-1 min-w-[140px] border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-teal-400 outline-none"
                      placeholder={`Member ${i + 1} name`}
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
                <button onClick={() => setNewTeamMembers([...newTeamMembers, { name: "", isOver21: null }])} className="text-teal-700 text-sm font-medium hover:text-teal-900">+ Add Another Member</button>
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
                  Sign Up Team for Shift
                </button>
              </div>

              {/* Team shift sign-up panel */}
              {teamSignUpTeamId === team.id && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                  <h4 className="font-medium text-amber-900 mb-3">Choose a shift for your team:</h4>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {shifts.filter((s) => {
                      const openSlots = s.capacity - s.assignments.length;
                      return openSlots > 0;
                    }).map((s) => (
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

              {/* Team Members */}
              <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2">
                {team.members.map((tm) => {
                  const isLeader = tm.volunteer.id === volunteer?.id;
                  return (
                    <div key={tm.id} className={`rounded-lg p-3 text-sm ${isLeader ? "bg-teal-50 border border-teal-200" : "bg-gray-50 border border-gray-200"}`}>
                      <div className="flex items-center gap-1 font-medium">
                        {isLeader && <span className="text-teal-600 text-xs font-bold">TL</span>}
                        {tm.volunteer.name}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Add new members inline */}
              <div className="mt-3 flex gap-2">
                <input
                  placeholder="Add member by name..."
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-teal-400 outline-none"
                  onKeyDown={async (e) => {
                    if (e.key === "Enter" && (e.target as HTMLInputElement).value.trim()) {
                      const memberName = (e.target as HTMLInputElement).value.trim();
                      await fetch("/api/teams", {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ id: team.id, addMembers: [{ name: memberName }] }),
                      });
                      (e.target as HTMLInputElement).value = "";
                      refreshData();
                    }
                  }}
                />
                <span className="text-xs text-gray-400 self-center whitespace-nowrap">Press Enter to add</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
