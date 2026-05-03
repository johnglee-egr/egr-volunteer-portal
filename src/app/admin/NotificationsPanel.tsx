"use client";

import { useState, useEffect } from "react";

// ── Lightweight local types ──────────────────────────────────────────────────
interface Category { id: string; name: string; }
interface Team { id: string; name: string; }
interface Volunteer { id: string; name: string; email?: string; phone?: string; role?: string; }
interface NotificationRecord {
  id: string; type: string; recipient: string; subject?: string;
  message: string; status: string; sentAt?: string; createdAt: string;
}

interface NotificationTemplate {
  id: string; name: string; subject?: string; body: string;
  channel: string; isPrebuilt: boolean; createdAt: string;
}

interface NotificationSchedule {
  id: string; name: string; templateId: string;
  template: NotificationTemplate;
  groupType: string; groupValue?: string;
  relativeType?: string; relativeValue?: number; relativeTime?: string;
  sendAt?: string;
  isAutomatic: boolean; status: string; lastRunAt?: string; createdAt: string;
}

// ── Props ────────────────────────────────────────────────────────────────────
interface Props {
  categories: Category[];
  teams: Team[];
  volunteers: Volunteer[];
  notifications: NotificationRecord[];
  settings: { festivalDate?: string };
  inputClass: string;
  btnPrimary: string;
  onRefresh: () => void;
  onConfirm: (message: string, action: () => void, confirmLabel?: string) => void;
}

// ── Helper ───────────────────────────────────────────────────────────────────
const MERGE_TAGS = [
  { tag: "{volunteer_name}", desc: "Volunteer's full name" },
  { tag: "{shift_title}",    desc: "Name of their shift" },
  { tag: "{shift_date}",     desc: "Shift date (long format)" },
  { tag: "{shift_time}",     desc: "Shift start – end time (12h)" },
  { tag: "{portal_url}",     desc: "Link to volunteer portal" },
];

const CHANNEL_OPTIONS = [
  { value: "email", label: "Email only" },
  { value: "sms",   label: "SMS only" },
  { value: "both",  label: "Email + SMS" },
];

const GROUP_TYPES = [
  { value: "all",        label: "All volunteers" },
  { value: "category",   label: "By category" },
  { value: "timerange",  label: "By time range" },
  { value: "role",       label: "By role" },
  { value: "team",       label: "By team" },
  { value: "unassigned", label: "Unassigned volunteers" },
];

const ROLE_OPTIONS = [
  { value: "admin",     label: "Admin" },
  { value: "team_lead", label: "Team Lead" },
  { value: "volunteer", label: "Volunteer" },
];

const TIMING_OPTIONS = [
  { value: "days_before_festival", label: "Days before festival" },
  { value: "day_of",               label: "Day of festival" },
  { value: "fixed",                label: "Specific date & time" },
];

function labelForGroup(groupType: string, groupValue: string | undefined, categories: Category[], teams: Team[]) {
  if (groupType === "all") return "All volunteers";
  if (groupType === "unassigned") return "Unassigned volunteers";
  if (groupType === "category") {
    const cat = categories.find((c) => c.id === groupValue);
    return cat ? `Category: ${cat.name}` : `Category (${groupValue})`;
  }
  if (groupType === "team") {
    const t = teams.find((t) => t.id === groupValue);
    return t ? `Team: ${t.name}` : `Team (${groupValue})`;
  }
  if (groupType === "role") return `Role: ${groupValue}`;
  if (groupType === "timerange") return `Shifts ${groupValue}`;
  return groupType;
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    pending:   "bg-yellow-100 text-yellow-700",
    sent:      "bg-green-100 text-green-700",
    cancelled: "bg-gray-100 text-gray-600",
    failed:    "bg-red-100 text-red-700",
  };
  return `px-2 py-0.5 rounded text-xs font-medium ${map[status] ?? "bg-gray-100 text-gray-600"}`;
}

// ── Component ────────────────────────────────────────────────────────────────
export default function NotificationsPanel({
  categories, teams, volunteers, notifications,
  settings, inputClass, btnPrimary, onRefresh, onConfirm,
}: Props) {
  type SubTab = "templates" | "schedules" | "send" | "history";
  const [subTab, setSubTab] = useState<SubTab>("send");

  // ─ Template state ─────────────────────────────────────────────────────────
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [editingTpl, setEditingTpl] = useState<NotificationTemplate | null>(null);
  const [showNewTpl, setShowNewTpl] = useState(false);
  const [tplName, setTplName] = useState("");
  const [tplSubject, setTplSubject] = useState("");
  const [tplBody, setTplBody] = useState("");
  const [tplChannel, setTplChannel] = useState("both");
  const [tplLoading, setTplLoading] = useState(false);
  const [tplError, setTplError] = useState("");

  // ─ Schedule state ─────────────────────────────────────────────────────────
  const [schedules, setSchedules] = useState<NotificationSchedule[]>([]);
  const [showNewSched, setShowNewSched] = useState(false);
  const [schedName, setSchedName] = useState("");
  const [schedTemplateId, setSchedTemplateId] = useState("");
  const [schedGroupType, setSchedGroupType] = useState("all");
  const [schedGroupValue, setSchedGroupValue] = useState("");
  const [schedTimingType, setSchedTimingType] = useState("days_before_festival");
  const [schedDaysBefore, setSchedDaysBefore] = useState("7");
  const [schedTime, setSchedTime] = useState("09:00");
  const [schedFixedAt, setSchedFixedAt] = useState("");
  const [schedAutomatic, setSchedAutomatic] = useState(true);
  const [schedLoading, setSchedLoading] = useState(false);
  const [schedError, setSchedError] = useState("");
  const [sendError, setSendError] = useState("");

  // ─ Send Now state ─────────────────────────────────────────────────────────
  const [sendTemplateId, setSendTemplateId] = useState("");
  const [sendGroupType, setSendGroupType] = useState("all");
  const [sendGroupValue, setSendGroupValue] = useState("");
  const [sendLoading, setSendLoading] = useState(false);
  const [sendResult, setSendResult] = useState<{ sent: number; volunteerCount: number; reachable?: number } | null>(null);

  // ─ Load data ──────────────────────────────────────────────────────────────
  const loadTemplates = async () => {
    const res = await fetch("/api/notification-templates");
    if (res.ok) setTemplates(await res.json());
  };
  const loadSchedules = async () => {
    const res = await fetch("/api/notification-schedules");
    if (res.ok) setSchedules(await res.json());
  };

  useEffect(() => {
    loadTemplates();
    loadSchedules();
  }, []);

  // ─ Templates CRUD ─────────────────────────────────────────────────────────
  const resetTplForm = () => {
    setTplName(""); setTplSubject(""); setTplBody(""); setTplChannel("both");
    setEditingTpl(null); setShowNewTpl(false); setTplError("");
  };

  const startEditTpl = (t: NotificationTemplate) => {
    setEditingTpl(t);
    setTplName(t.name);
    setTplSubject(t.subject || "");
    setTplBody(t.body);
    setTplChannel(t.channel);
    setShowNewTpl(false);
  };

  const saveTpl = async () => {
    if (!tplName || !tplBody) return;
    setTplLoading(true);
    setTplError("");
    const res = editingTpl
      ? await fetch("/api/notification-templates", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editingTpl.id, name: tplName, subject: tplSubject, body: tplBody, channel: tplChannel }),
        })
      : await fetch("/api/notification-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: tplName, subject: tplSubject, body: tplBody, channel: tplChannel }),
        });
    setTplLoading(false);
    if (res.ok) {
      resetTplForm();
      loadTemplates();
    } else {
      const data = await res.json().catch(() => ({}));
      setTplError(data.error || "Failed to save template. Please try again.");
    }
  };

  const deleteTpl = async (id: string) => {
    await fetch("/api/notification-templates", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    loadTemplates();
  };

  // ─ Schedules CRUD ─────────────────────────────────────────────────────────
  const resetSchedForm = () => {
    setShowNewSched(false);
    setSchedName(""); setSchedTemplateId(""); setSchedGroupType("all");
    setSchedGroupValue(""); setSchedTimingType("days_before_festival");
    setSchedDaysBefore("7"); setSchedTime("09:00"); setSchedFixedAt("");
    setSchedAutomatic(true);
  };

  const saveSched = async () => {
    if (!schedName || !schedTemplateId) return;
    setSchedLoading(true);

    const payload: Record<string, unknown> = {
      name: schedName,
      templateId: schedTemplateId,
      groupType: schedGroupType,
      groupValue: schedGroupValue || null,
      isAutomatic: schedAutomatic,
      status: "pending",
    };

    if (schedTimingType === "fixed") {
      payload.relativeType = "fixed";
      payload.sendAt = schedFixedAt ? new Date(schedFixedAt).toISOString() : null;
    } else if (schedTimingType === "days_before_festival") {
      payload.relativeType = "days_before_festival";
      payload.relativeValue = parseInt(schedDaysBefore) || 7;
      payload.relativeTime = schedTime;
    } else {
      payload.relativeType = "day_of";
      payload.relativeTime = schedTime;
    }

    const res = await fetch("/api/notification-schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setSchedLoading(false);
    if (res.ok) {
      resetSchedForm();
      loadSchedules();
    } else {
      const data = await res.json().catch(() => ({}));
      setSchedError(data.error || "Failed to save schedule. Please try again.");
    }
  };

  const deleteSched = async (id: string) => {
    await fetch("/api/notification-schedules", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    loadSchedules();
  };

  const toggleSchedAutomatic = async (s: NotificationSchedule) => {
    await fetch("/api/notification-schedules", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: s.id, isAutomatic: !s.isAutomatic }),
    });
    loadSchedules();
  };

  // ─ Send Now ───────────────────────────────────────────────────────────────
  const groupLabel = () => labelForGroup(sendGroupType, sendGroupValue, categories, teams);

  const selectedTpl = templates.find((t) => t.id === sendTemplateId);

  const doSend = async () => {
    if (!sendTemplateId || !sendGroupType) return;
    setSendLoading(true);
    setSendResult(null);
    setSendError("");
    try {
      const res = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "group", templateId: sendTemplateId, groupType: sendGroupType, groupValue: sendGroupValue || null }),
      });
      if (res.ok) {
        const data = await res.json();
        setSendResult(data);
        onRefresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setSendError(data.error || "Send failed. Please try again.");
      }
    } catch {
      setSendError("Network error. Please check your connection and try again.");
    }
    setSendLoading(false);
  };

  const handleSend = () => {
    if (!sendTemplateId) return;
    onConfirm(`Ready to send "${selectedTpl?.name ?? "notification"}" to ${groupLabel()}?`, doSend);
  };

  // ─ Group value selector (shared for send + schedule) ─────────────────────
  const renderGroupValueSelector = (
    groupType: string,
    groupValue: string,
    setGroupValue: (v: string) => void
  ) => {
    if (groupType === "category") {
      return (
        <select value={groupValue} onChange={(e) => setGroupValue(e.target.value)} className={inputClass}>
          <option value="">-- select category --</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      );
    }
    if (groupType === "team") {
      return (
        <select value={groupValue} onChange={(e) => setGroupValue(e.target.value)} className={inputClass}>
          <option value="">-- select team --</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      );
    }
    if (groupType === "role") {
      return (
        <select value={groupValue} onChange={(e) => setGroupValue(e.target.value)} className={inputClass}>
          <option value="">-- select role --</option>
          {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      );
    }
    if (groupType === "timerange") {
      // groupValue format: "HH:MM-HH:MM" — use regex to avoid splitting on colons
      const trMatch = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(groupValue);
      const trStart = trMatch ? trMatch[1] : "";
      const trEnd   = trMatch ? trMatch[2] : "";
      return (
        <div className="flex items-center gap-2">
          <input type="time" placeholder="Start" className={inputClass}
            value={trStart}
            onChange={(e) => setGroupValue(`${e.target.value}-${trEnd}`)} />
          <span className="text-gray-500">to</span>
          <input type="time" placeholder="End" className={inputClass}
            value={trEnd}
            onChange={(e) => setGroupValue(`${trStart}-${e.target.value}`)} />
        </div>
      );
    }
    return null;
  };

  // ─ Sub-tab nav ────────────────────────────────────────────────────────────
  const tabs: { key: SubTab; label: string }[] = [
    { key: "send",      label: "📤 Send Now" },
    { key: "templates", label: "📝 Templates" },
    { key: "schedules", label: "🗓 Schedules" },
    { key: "history",   label: "📋 History" },
  ];

  const subTabClass = (key: SubTab) =>
    `px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
      subTab === key
        ? "border-amber-600 text-amber-800 bg-white"
        : "border-transparent text-gray-500 hover:text-amber-700 hover:border-amber-300"
    }`;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      <h2 className="text-xl font-bold text-amber-900 mb-4">Notifications</h2>

      {/* Sub-tab bar */}
      <div className="flex gap-1 border-b border-amber-200 mb-6">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setSubTab(t.key)} className={subTabClass(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ===== SEND NOW ===== */}
      {subTab === "send" && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-amber-200 p-6 space-y-4">
            <h3 className="font-semibold text-amber-900 text-base">Send a notification now</h3>

            {/* Template picker */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Template</label>
              <select value={sendTemplateId} onChange={(e) => setSendTemplateId(e.target.value)} className={inputClass}>
                <option value="">-- select a template --</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.channel})</option>
                ))}
              </select>
            </div>

            {/* Template preview */}
            {selectedTpl && (
              <div className="bg-amber-50 rounded-lg p-4 text-sm space-y-1 border border-amber-100">
                {selectedTpl.subject && <p className="font-semibold text-amber-800">Subject: {selectedTpl.subject}</p>}
                <pre className="whitespace-pre-wrap text-gray-700 font-sans text-xs leading-relaxed">{selectedTpl.body}</pre>
                <p className="text-xs text-gray-400 pt-1">Channel: {selectedTpl.channel}</p>
              </div>
            )}

            {/* Recipient group */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Send to</label>
              <select value={sendGroupType} onChange={(e) => { setSendGroupType(e.target.value); setSendGroupValue(""); }} className={inputClass}>
                {GROUP_TYPES.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
            </div>

            {/* Group value sub-selector */}
            {["category", "team", "role", "timerange"].includes(sendGroupType) && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {sendGroupType === "category" ? "Category" :
                   sendGroupType === "team"     ? "Team" :
                   sendGroupType === "role"     ? "Role" : "Time window"}
                </label>
                {renderGroupValueSelector(sendGroupType, sendGroupValue, setSendGroupValue)}
              </div>
            )}

            {/* Recipient summary */}
            <p className="text-sm text-gray-600">
              Recipients: <span className="font-medium text-amber-800">{groupLabel()}</span>
            </p>

            <button
              onClick={handleSend}
              disabled={!sendTemplateId || sendLoading}
              className={`${btnPrimary} disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {sendLoading ? "Sending…" : "Send Now"}
            </button>

            {sendError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                ❌ {sendError}
              </div>
            )}
            {sendResult && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
                ✅ Sent {sendResult.sent} message(s) to {sendResult.reachable ?? sendResult.volunteerCount} reachable volunteer(s){sendResult.volunteerCount !== sendResult.reachable ? ` (${sendResult.volunteerCount} total in group)` : ""}.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== TEMPLATES ===== */}
      {subTab === "templates" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-600">
              Pre-built templates are provided by default. You can edit any template or create your own.
            </p>
            <button
              onClick={() => { resetTplForm(); setShowNewTpl(true); }}
              className={btnPrimary}
            >
              + New Template
            </button>
          </div>

          {/* Merge tag reference */}
          <div className="bg-amber-50 border border-amber-100 rounded-lg p-4">
            <p className="text-xs font-semibold text-amber-800 mb-2">Available merge tags:</p>
            <div className="flex flex-wrap gap-2">
              {MERGE_TAGS.map((m) => (
                <span key={m.tag} title={m.desc} className="font-mono text-xs bg-white border border-amber-200 px-2 py-0.5 rounded text-amber-700 cursor-default">
                  {m.tag}
                </span>
              ))}
            </div>
          </div>

          {/* New / edit form */}
          {(showNewTpl || editingTpl) && (
            <div className="bg-white rounded-xl border border-amber-200 p-5 space-y-4">
              <h3 className="font-semibold text-amber-900">{editingTpl ? `Editing: ${editingTpl.name}` : "New Template"}</h3>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Template Name *</label>
                  <input value={tplName} onChange={(e) => setTplName(e.target.value)} className={inputClass} placeholder="e.g. Week-Before Reminder" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Channel</label>
                  <select value={tplChannel} onChange={(e) => setTplChannel(e.target.value)} className={inputClass}>
                    {CHANNEL_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Subject (email)</label>
                <input value={tplSubject} onChange={(e) => setTplSubject(e.target.value)} className={inputClass} placeholder="EGR Harvest + Beer Festival — Volunteer Update" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Message Body *</label>
                <textarea value={tplBody} onChange={(e) => setTplBody(e.target.value)} className={`${inputClass} font-mono text-sm`} rows={8} placeholder="Hi {volunteer_name}, ..." />
              </div>
              {tplError && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg">{tplError}</div>}
              <div className="flex gap-3">
                <button onClick={saveTpl} disabled={tplLoading || !tplName || !tplBody} className={`${btnPrimary} disabled:opacity-50`}>
                  {tplLoading ? "Saving…" : editingTpl ? "Save Changes" : "Create Template"}
                </button>
                <button onClick={resetTplForm} className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Template list */}
          <div className="space-y-3">
            {templates.map((t) => (
              <div key={t.id} className={`bg-white rounded-xl border p-4 ${t.isPrebuilt ? "border-amber-100" : "border-blue-100"}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold text-amber-900">{t.name}</p>
                      {t.isPrebuilt && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">Pre-built</span>}
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{t.channel}</span>
                    </div>
                    {t.subject && <p className="text-xs text-gray-500 mb-1">Subject: {t.subject}</p>}
                    <p className="text-sm text-gray-600 line-clamp-2 whitespace-pre-line">{t.body}</p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => startEditTpl(t)}
                      className="text-xs px-3 py-1 rounded bg-amber-100 text-amber-700 hover:bg-amber-200 font-medium"
                    >
                      Edit
                    </button>
                    {!t.isPrebuilt && (
                      <button
                        onClick={() => onConfirm(`Delete template "${t.name}"?`, () => deleteTpl(t.id), "Yes, Delete")}
                        className="text-xs px-3 py-1 rounded bg-red-100 text-red-600 hover:bg-red-200 font-medium"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {templates.length === 0 && <p className="text-gray-500 text-center py-8">No templates yet.</p>}
          </div>
        </div>
      )}

      {/* ===== SCHEDULES ===== */}
      {subTab === "schedules" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-600">
              Schedule automatic notifications to fire at the right time.
            </p>
            <button onClick={() => { resetSchedForm(); setShowNewSched(true); }} className={btnPrimary}>
              + New Schedule
            </button>
          </div>

          {/* New schedule form */}
          {showNewSched && (
            <div className="bg-white rounded-xl border border-amber-200 p-5 space-y-4">
              <h3 className="font-semibold text-amber-900">New Notification Schedule</h3>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Schedule Name *</label>
                  <input value={schedName} onChange={(e) => setSchedName(e.target.value)} className={inputClass} placeholder="e.g. 1-Week Reminder — All Volunteers" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Template *</label>
                  <select value={schedTemplateId} onChange={(e) => setSchedTemplateId(e.target.value)} className={inputClass}>
                    <option value="">-- select template --</option>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Recipient group */}
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Send to</label>
                  <select value={schedGroupType} onChange={(e) => { setSchedGroupType(e.target.value); setSchedGroupValue(""); }} className={inputClass}>
                    {GROUP_TYPES.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                  </select>
                </div>
                {["category", "team", "role", "timerange"].includes(schedGroupType) && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {schedGroupType === "category" ? "Category" :
                       schedGroupType === "team"     ? "Team" :
                       schedGroupType === "role"     ? "Role" : "Time window"}
                    </label>
                    {renderGroupValueSelector(schedGroupType, schedGroupValue, setSchedGroupValue)}
                  </div>
                )}
              </div>

              {/* Timing */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">When to send</label>
                <select value={schedTimingType} onChange={(e) => setSchedTimingType(e.target.value)} className={inputClass}>
                  {TIMING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>

              {schedTimingType === "days_before_festival" && (
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Days before festival</label>
                    <input type="number" min="1" max="365" value={schedDaysBefore} onChange={(e) => setSchedDaysBefore(e.target.value)} className={inputClass} />
                    {settings.festivalDate && (
                      <p className="text-xs text-gray-400 mt-1">
                        Festival: {new Date(settings.festivalDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Send at time</label>
                    <input type="time" value={schedTime} onChange={(e) => setSchedTime(e.target.value)} className={inputClass} />
                  </div>
                </div>
              )}

              {schedTimingType === "day_of" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Send at time (on festival day)</label>
                  <input type="time" value={schedTime} onChange={(e) => setSchedTime(e.target.value)} className={inputClass} />
                </div>
              )}

              {schedTimingType === "fixed" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Send at (date & time)</label>
                  <input type="datetime-local" value={schedFixedAt} onChange={(e) => setSchedFixedAt(e.target.value)} className={inputClass} />
                </div>
              )}

              {/* Automatic toggle */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setSchedAutomatic(!schedAutomatic)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${schedAutomatic ? "bg-amber-600" : "bg-gray-300"}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${schedAutomatic ? "translate-x-6" : "translate-x-1"}`} />
                </button>
                <span className="text-sm text-gray-700">
                  {schedAutomatic ? "Send automatically when the time arrives" : "Manual trigger only"}
                </span>
              </div>

              {schedError && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg">{schedError}</div>}
              <div className="flex gap-3">
                <button onClick={saveSched} disabled={schedLoading || !schedName || !schedTemplateId} className={`${btnPrimary} disabled:opacity-50`}>
                  {schedLoading ? "Saving…" : "Create Schedule"}
                </button>
                <button onClick={resetSchedForm} className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Schedule list */}
          <div className="space-y-3">
            {schedules.map((s) => (
              <div key={s.id} className={`bg-white rounded-xl border p-4 ${s.isAutomatic ? "border-green-100" : "border-gray-100"}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="font-semibold text-amber-900">{s.name}</p>
                      <span className={statusBadge(s.status)}>{s.status}</span>
                      {s.isAutomatic && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">Auto</span>}
                    </div>
                    <p className="text-xs text-gray-500">Template: {s.template.name} · To: {labelForGroup(s.groupType, s.groupValue, categories, teams)}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {s.relativeType === "days_before_festival"
                        ? `${s.relativeValue} days before festival at ${s.relativeTime}`
                        : s.relativeType === "day_of"
                        ? `Day of festival at ${s.relativeTime}`
                        : s.sendAt
                        ? `Fixed: ${new Date(s.sendAt).toLocaleString()}`
                        : "Timing not set"}
                    </p>
                    {s.lastRunAt && <p className="text-xs text-gray-400">Last sent: {new Date(s.lastRunAt).toLocaleString()}</p>}
                  </div>
                  <div className="flex flex-col gap-2 items-end flex-shrink-0">
                    {/* Auto toggle */}
                    <button
                      onClick={() => toggleSchedAutomatic(s)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${s.isAutomatic ? "bg-amber-600" : "bg-gray-300"}`}
                      title={s.isAutomatic ? "Auto-send ON — click to disable" : "Auto-send OFF — click to enable"}
                    >
                      <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${s.isAutomatic ? "translate-x-5" : "translate-x-1"}`} />
                    </button>
                    {/* Manual fire */}
                    {s.status !== "sent" && (
                      <button
                        onClick={() => onConfirm(`Send "${s.template.name}" to ${labelForGroup(s.groupType, s.groupValue, categories, teams)} now?`, () => {
                          // Fire-and-forget — errors will surface in the notifications history
                          fetch("/api/notifications", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ type: "group", templateId: s.templateId, groupType: s.groupType, groupValue: s.groupValue ?? null }),
                          }).then((res) => {
                            if (res.ok) {
                              // Mark schedule as sent
                              fetch("/api/notification-schedules", {
                                method: "PUT",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ id: s.id, status: "sent", lastRunAt: new Date().toISOString() }),
                              }).then(() => { loadSchedules(); onRefresh(); });
                            }
                          });
                        })}
                        className="text-xs px-3 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 font-medium"
                      >
                        Send Now
                      </button>
                    )}
                    <button
                      onClick={() => onConfirm(`Delete schedule "${s.name}"?`, () => deleteSched(s.id), "Yes, Delete")}
                      className="text-xs px-3 py-1 rounded bg-red-100 text-red-600 hover:bg-red-200 font-medium"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {schedules.length === 0 && <p className="text-gray-500 text-center py-8">No schedules yet.</p>}
          </div>
        </div>
      )}

      {/* ===== HISTORY ===== */}
      {subTab === "history" && (
        <div>
          <div className="bg-white rounded-lg border border-amber-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-amber-50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-amber-900">Type</th>
                  <th className="text-left px-4 py-3 font-medium text-amber-900">Recipient</th>
                  <th className="text-left px-4 py-3 font-medium text-amber-900">Subject / Message</th>
                  <th className="text-left px-4 py-3 font-medium text-amber-900">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-amber-900">Sent</th>
                </tr>
              </thead>
              <tbody>
                {notifications.map((n) => (
                  <tr key={n.id} className="border-t border-amber-50 hover:bg-amber-50/50">
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${n.type === "email" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}>
                        {n.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-700 max-w-[140px] truncate">{n.recipient}</td>
                    <td className="px-4 py-3 text-gray-600 max-w-xs truncate">{n.subject || n.message.substring(0, 60)}</td>
                    <td className="px-4 py-3">
                      <span className={statusBadge(n.status)}>{n.status}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                      {n.sentAt ? new Date(n.sentAt).toLocaleString() : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {notifications.length === 0 && <p className="text-gray-500 text-center py-8">No notifications sent yet.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
