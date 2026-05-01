"use client";

import { useState, useEffect, useRef, useCallback, FormEvent } from "react";
import TimeInput from "@/components/TimeInput";

interface Volunteer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  role?: string;
}

interface Assignment {
  id: string;
  volunteerId: string;
  shiftId?: string;
  stationIndex?: number | null;
  status: string;
  assignedBy: string;
  volunteer: Volunteer;
  shift?: { id: string; title: string; startTime?: string; endTime?: string; categoryId?: string };
}

interface Category {
  id: string;
  name: string;
  description?: string;
  color?: string;
  sortOrder: number;
  type: string;
  stationCount: number;
  volsPerStation: number;
  shifts?: { id: string }[];
}

interface Shift {
  id: string;
  title: string;
  description?: string;
  date: string;
  startTime: string;
  endTime: string;
  capacity: number;
  stationNames?: string | null;
  categoryId: string;
  category: Category;
  assignments: Assignment[];
}

interface PendingAssignment {
  id: string;
  status: string;
  assignedBy: string;
  createdAt: string;
  volunteer: Volunteer;
  shift: Shift;
}

interface PairRequest {
  id: string;
  status: string;
  message?: string;
  createdAt?: string;
  requester: Volunteer;
  partner: Volunteer;
}

interface Notification {
  id: string;
  type: string;
  recipient: string;
  subject?: string;
  message: string;
  status: string;
  sentAt?: string;
  createdAt: string;
}

export default function AdminDashboard() {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");

  const [activeTab, setActiveTab] = useState<
    "categories" | "volunteers" | "approvals" | "teams" | "notifications" | "settings"
  >("categories");

  const [categories, setCategories] = useState<Category[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [pairRequests, setPairRequests] = useState<PairRequest[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [pendingAssignments, setPendingAssignments] = useState<PendingAssignment[]>([]);

  interface VolunteerGroupMember { id: string; volunteer: Volunteer; }
  interface VolunteerGroup { id: string; name: string; status: string; message?: string; leader: Volunteer; members: VolunteerGroupMember[]; createdAt: string; }
  const [groups, setGroups] = useState<VolunteerGroup[]>([]);

  // Teams
  interface TeamMemberWithVol { id: string; volunteer: Volunteer & { assignments?: Assignment[] }; }
  interface Team { id: string; name: string; leader: Volunteer; members: TeamMemberWithVol[]; createdAt: string; }
  const [teams, setTeams] = useState<Team[]>([]);
  const [showTeamForm, setShowTeamForm] = useState(false);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [teamName, setTeamName] = useState("");
  const [teamLeaderId, setTeamLeaderId] = useState("");
  const [teamNewMembers, setTeamNewMembers] = useState<{ name: string }[]>([{ name: "" }]);
  const [assigningTeamId, setAssigningTeamId] = useState<string | null>(null);
  const [teamAssignMode, setTeamAssignMode] = useState<"shift" | "category">("shift");
  const [teamAssignTargetId, setTeamAssignTargetId] = useState("");

  // Volunteer detail modal
  const [viewingVolunteer, setViewingVolunteer] = useState<(Volunteer & { assignments?: Assignment[] }) | null>(null);
  // Manage assignments modal
  const [managingAssignmentsFor, setManagingAssignmentsFor] = useState<(Volunteer & { assignments?: Assignment[] }) | null>(null);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Forms
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [showShiftForm, setShowShiftForm] = useState(false);
  const [showVolunteerForm, setShowVolunteerForm] = useState(false);
  const [showAssignForm, setShowAssignForm] = useState<string | null>(null);
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [broadcastMessage, setBroadcastMessage] = useState("");

  // Bulk-assign state (Volunteers tab)
  const [selectedVolIds, setSelectedVolIds] = useState<Set<string>>(new Set());
  const [bulkAssignShiftId, setBulkAssignShiftId] = useState<string>("");
  // Team member expand/collapse (Volunteers tab)
  const [expandedTeamIds, setExpandedTeamIds] = useState<Set<string>>(new Set());

  // Format phone input as xxx-xxx-xxxx while typing
  const fmtPhoneInput = (v: string) => {
    const d = v.replace(/\D/g, "").slice(0, 10);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
    return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  };

  // Format phone number as (xxx) xxx-xxxx
  const formatPhone = (phone: string) => {
    const digits = phone.replace(/\D/g, '');
    const d = digits.startsWith('1') && digits.length === 11 ? digits.slice(1) : digits;
    if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
    return phone;
  };

  // Format 24h time string (HH:MM) to 12h (h:MM AM/PM)
  const fmt12 = (t: string) => {
    if (!t) return "";
    const [hStr, mStr] = t.split(":");
    let h = parseInt(hStr);
    const m = mStr || "00";
    const ampm = h >= 12 ? "PM" : "AM";
    if (h === 0) h = 12;
    else if (h > 12) h -= 12;
    return `${h}:${m} ${ampm}`;
  };

  // Category form — wizard steps
  const [catName, setCatName] = useState("");
  const [catDesc, setCatDesc] = useState("");
  const [catType, setCatType] = useState<"one-time" | "throughout" | "">(""); // step 2
  // One-time fields
  const [catOneTimeCount, setCatOneTimeCount] = useState("5");
  const [catOneTimeStart, setCatOneTimeStart] = useState("");
  const [catOneTimeEnd, setCatOneTimeEnd] = useState("");
  // Throughout fields
  const [catShiftCount, setCatShiftCount] = useState("3");
  const [catStationCount, setCatStationCount] = useState("1");
  const [catVolsPerStation, setCatVolsPerStation] = useState("2");
  // Custom shift time overrides: null means use calculated default
  const [catShiftBlocks, setCatShiftBlocks] = useState<{ startTime: string; endTime: string }[]>([]);
  const [editingBlockIndex, setEditingBlockIndex] = useState<number | null>(null);
  const [editingBlockField, setEditingBlockField] = useState<"start" | "end" | null>(null);
  // Wizard step tracker
  const [catStep, setCatStep] = useState(1);

  const resetCategoryForm = () => {
    setCatName(""); setCatDesc(""); setCatType(""); setCatStep(1);
    setCatOneTimeCount("5"); setCatOneTimeStart(""); setCatOneTimeEnd("");
    setCatShiftCount("3"); setCatStationCount("1"); setCatVolsPerStation("2");
    setCatShiftBlocks([]); setEditingBlockIndex(null); setEditingBlockField(null);
  };

  // Parse festival time from settings — handles many formats:
  // "12:00pm-6:00pm", "12:00 PM - 6:00 PM", "12pm-6pm", "noon-6pm", etc.
  const parseFestivalTimes = () => {
    const timeStr = (settings.festivalTime || "").trim();
    if (!timeStr) return null;

    // Match each time token: optional hour, optional :mm, optional am/pm
    const TOKEN = /(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/gi;
    const tokens: { h: number; m: number }[] = [];

    // Split on common separator patterns first
    const parts = timeStr.split(/\s*[-–to]\s*/i);
    for (const part of parts) {
      TOKEN.lastIndex = 0;
      const m = TOKEN.exec(part.trim());
      if (!m) continue;
      let h = parseInt(m[1]);
      const min = parseInt(m[2] || "0");
      const mer = (m[3] || "").toLowerCase().replace(/\./g, "");
      if (mer === "pm" && h !== 12) h += 12;
      if (mer === "am" && h === 12) h = 0;
      // If no meridiem, guess: hours < 8 are likely PM (festival context)
      if (!mer && h > 0 && h < 8) h += 12;
      tokens.push({ h, m: min });
    }

    if (tokens.length < 2) return null;
    const [start, end] = tokens;
    const fmt = (t: { h: number; m: number }) =>
      `${String(t.h).padStart(2, "0")}:${String(t.m).padStart(2, "0")}`;
    return { start: { ...start, str: fmt(start) }, end: { ...end, str: fmt(end) } };
  };

  // Generate default equal shift blocks from festival time
  const generateDefaultBlocks = (numShifts: number) => {
    const times = parseFestivalTimes();
    if (!times) return [];
    const startMin = times.start.h * 60 + times.start.m;
    const endMin = times.end.h * 60 + times.end.m;
    const totalMin = endMin - startMin;
    const blockMin = Math.floor(totalMin / numShifts);
    const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

    const blocks = [];
    for (let i = 0; i < numShifts; i++) {
      const bStart = startMin + i * blockMin;
      const bEnd = i === numShifts - 1 ? endMin : bStart + blockMin;
      blocks.push({ startTime: fmt(bStart), endTime: fmt(bEnd) });
    }
    return blocks;
  };

  // Get the current shift blocks (custom overrides or calculated defaults)
  const calculateShiftBlocks = () => {
    const numShifts = parseInt(catShiftCount) || 1;
    if (catShiftBlocks.length === numShifts) return catShiftBlocks;
    return generateDefaultBlocks(numShifts);
  };

  // Recalculate blocks when shift count changes
  const handleShiftCountChange = (newCount: string) => {
    setCatShiftCount(newCount);
    const n = parseInt(newCount) || 1;
    setCatShiftBlocks(generateDefaultBlocks(n));
    setEditingBlockIndex(null);
    setEditingBlockField(null);
  };

  // Update a single block's time
  const updateBlockTime = (index: number, field: "startTime" | "endTime", value: string) => {
    const blocks = [...(catShiftBlocks.length === (parseInt(catShiftCount) || 1) ? catShiftBlocks : generateDefaultBlocks(parseInt(catShiftCount) || 1))];
    blocks[index] = { ...blocks[index], [field]: value };
    setCatShiftBlocks(blocks);
  };

  // Calculate totals for preview
  const calcThroughoutTotals = () => {
    const numShifts = parseInt(catShiftCount) || 1;
    const stations = parseInt(catStationCount) || 1;
    const volsPer = parseInt(catVolsPerStation) || 1;
    const totalSlots = numShifts * stations * volsPer;
    const perShift = stations * volsPer;
    return { numShifts, stations, volsPer, totalSlots, perShift };
  };

  // Edit category — reuses the same wizard fields, just with editingCatId set
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editCatName, setEditCatName] = useState("");
  const [editCatDesc, setEditCatDesc] = useState("");

  const startEditCategory = (cat: Category) => {
    const catShifts = shifts.filter((s) => s.categoryId === cat.id)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    setEditingCatId(cat.id);
    // Pre-populate wizard fields from saved metadata
    setCatName(cat.name);
    setCatDesc(cat.description || "");
    setCatType(cat.type === "one-time" ? "one-time" : "throughout");
    if (cat.type === "one-time" && catShifts.length === 1) {
      setCatOneTimeCount(String(catShifts[0].capacity));
      setCatOneTimeStart(catShifts[0].startTime);
      setCatOneTimeEnd(catShifts[0].endTime);
    } else {
      setCatShiftCount(String(catShifts.length || 1));
      setCatStationCount(String(cat.stationCount || 1));
      setCatVolsPerStation(String(cat.volsPerStation || 1));
      // Pre-populate actual shift times from existing shifts
      if (catShifts.length > 0) {
        setCatShiftBlocks(catShifts.map((s) => ({ startTime: s.startTime, endTime: s.endTime })));
      }
    }
    setEditingBlockIndex(null);
    setEditingBlockField(null);
    setCatStep(1);
    setShowCategoryForm(true);
  };

  // Shift form
  const [shiftTitle, setShiftTitle] = useState("");
  const [shiftDesc, setShiftDesc] = useState("");
  const [shiftDate, setShiftDate] = useState("");
  const [shiftStart, setShiftStart] = useState("");
  const [shiftEnd, setShiftEnd] = useState("");
  const [shiftCapacity, setShiftCapacity] = useState("5");
  const [shiftCategoryId, setShiftCategoryId] = useState("");

  // Volunteer form
  const [volName, setVolName] = useState("");
  const [volEmail, setVolEmail] = useState("");
  const [volPhone, setVolPhone] = useState("");

  // Post-create assignment panel
  const [newlyCreatedVol, setNewlyCreatedVol] = useState<{ id: string; name: string } | null>(null);
  const [postCreateMode, setPostCreateMode] = useState<"none" | "team" | "pair">("none");
  const [postCreateTeamId, setPostCreateTeamId] = useState("");
  const [postCreatePairWithId, setPostCreatePairWithId] = useState("");

  // Category drill-down (double-click a category to see its shifts)
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  // Station drag-and-drop state
  const [stationDrag, setStationDrag] = useState<{ assignmentId: string; fromShiftId: string; fromStationIndex: number } | null>(null);

  // Station name inline editing
  const [editingStationKey, setEditingStationKey] = useState<string | null>(null);
  const [editingStationName, setEditingStationName] = useState("");

  // Drag-and-drop state for categories
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const handleDragStart = useCallback((index: number) => {
    dragItem.current = index;
    setDragIndex(index);
  }, []);

  const handleDragEnter = useCallback((index: number) => {
    dragOverItem.current = index;
  }, []);

  const handleDragEnd = useCallback(async () => {
    if (dragItem.current === null || dragOverItem.current === null || dragItem.current === dragOverItem.current) {
      setDragIndex(null);
      return;
    }

    const reordered = [...categories];
    const [draggedItem] = reordered.splice(dragItem.current, 1);
    reordered.splice(dragOverItem.current, 0, draggedItem);

    // Optimistic update
    setCategories(reordered);
    setDragIndex(null);
    dragItem.current = null;
    dragOverItem.current = null;

    // Persist new order
    const reorderPayload = reordered.map((cat, i) => ({ id: cat.id, sortOrder: i }));
    await fetch("/api/categories", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reorder: reorderPayload }),
    });
  }, [categories]);

  // Settings
  const [settings, setSettings] = useState({
    festivalName: "",
    festivalDate: "",
    festivalTime: "",
    contactEmail: "",
    contactPhone: "",
    welcomeMessage: "",
  });

  const handleLogin = async () => {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      setAuthenticated(true);
      loadData();
    } else {
      setAuthError("Invalid password");
    }
  };

  const loadData = async () => {
    const [c, s, v, p, n, st, pa, g, t] = await Promise.all([
      fetch("/api/categories").then((r) => r.json()),
      fetch("/api/shifts").then((r) => r.json()),
      fetch("/api/volunteers").then((r) => r.json()),
      fetch("/api/pair-requests").then((r) => r.json()),
      fetch("/api/notifications").then((r) => r.json()),
      fetch("/api/settings").then((r) => r.json()),
      fetch("/api/assignments?status=pending").then((r) => r.json()),
      fetch("/api/groups").then((r) => r.json()),
      fetch("/api/teams").then((r) => r.json()),
    ]);
    setCategories(c);
    setShifts(s);
    setVolunteers(v);
    setPairRequests(p);
    setNotifications(n);
    setPendingAssignments(pa);
    setGroups(g);
    setTeams(Array.isArray(t) ? t : []);
    setSettings({
      festivalName: st.festivalName || "",
      festivalDate: st.festivalDate || "",
      festivalTime: st.festivalTime || "",
      contactEmail: st.contactEmail || "",
      contactPhone: st.contactPhone || "",
      welcomeMessage: st.welcomeMessage || "",
    });
  };

  const clearMessages = () => { setError(""); setSuccess(""); };

  // Category CRUD
  const handleCreateCategory = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    clearMessages();

    // Create the category
    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: catName,
        description: catDesc || null,
        type: catType || "throughout",
        stationCount: catType === "throughout" ? parseInt(catStationCount) || 1 : 1,
        volsPerStation: catType === "throughout" ? parseInt(catVolsPerStation) || 1 : parseInt(catOneTimeCount) || 1,
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Failed to create category.");
      return;
    }

    const newCat = await res.json();
    const festDate = settings.festivalDate ? new Date(settings.festivalDate).toISOString().split("T")[0] : "";

    // Auto-create shifts based on wizard answers
    if (catType === "one-time") {
      // Single shift with specified volunteers and time
      await fetch("/api/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `${catName}`,
          description: catDesc || null,
          date: festDate || new Date().toISOString().split("T")[0],
          startTime: catOneTimeStart,
          endTime: catOneTimeEnd,
          capacity: catOneTimeCount,
          categoryId: newCat.id,
        }),
      });
      setSuccess(`Category "${catName}" created with 1 shift (${catOneTimeCount} volunteers needed).`);
    } else if (catType === "throughout") {
      const blocks = calculateShiftBlocks();
      const stations = parseInt(catStationCount) || 1;
      const volsPer = parseInt(catVolsPerStation) || 1;
      const perShift = stations * volsPer;

      for (let i = 0; i < blocks.length; i++) {
        await fetch("/api/shifts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: `${catName} — Shift ${i + 1}`,
            description: stations > 1
              ? `${stations} station${stations > 1 ? "s" : ""}, ${volsPer} volunteer${volsPer > 1 ? "s" : ""} per station`
              : catDesc || null,
            date: festDate || new Date().toISOString().split("T")[0],
            startTime: blocks[i].startTime,
            endTime: blocks[i].endTime,
            capacity: perShift,
            categoryId: newCat.id,
            stationCount: stations,
          }),
        });
      }
      const totals = calcThroughoutTotals();
      setSuccess(
        `Category "${catName}" created with ${blocks.length} shift${blocks.length > 1 ? "s" : ""} ` +
        `(${totals.perShift} per shift, ${totals.totalSlots} total volunteer slots).`
      );
    } else {
      setSuccess(`Category "${catName}" created.`);
    }

    setShowCategoryForm(false);
    resetCategoryForm();
    loadData();
  };

  const handleUpdateCategory = async (id?: string) => {
    const catId = id || editingCatId;
    if (!catId) return;
    clearMessages();

    // Update the category metadata
    const res = await fetch("/api/categories", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: catId,
        name: catName,
        description: catDesc || null,
        type: catType || "throughout",
        stationCount: catType === "throughout" ? parseInt(catStationCount) || 1 : 1,
        volsPerStation: catType === "throughout" ? parseInt(catVolsPerStation) || 1 : parseInt(catOneTimeCount) || 1,
      }),
    });
    if (!res.ok) {
      try {
        const data = await res.json();
        setError(data.error || "Failed to update category.");
      } catch {
        setError("Failed to update category.");
      }
      return;
    }

    // Delete existing shifts for this category (that have no confirmed assignments)
    // and recreate based on new wizard answers
    const existingShifts = shifts.filter((s) => s.categoryId === catId);
    const shiftsWithAssignments = existingShifts.filter((s) => s.assignments.some((a) => a.status === "confirmed"));

    // Delete unassigned shifts
    for (const s of existingShifts) {
      if (!s.assignments.some((a) => a.status === "confirmed")) {
        await fetch("/api/shifts", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: s.id }),
        });
      }
    }

    const festDate = settings.festivalDate ? new Date(settings.festivalDate).toISOString().split("T")[0] : "";

    if (catType === "one-time") {
      // Only create if no existing shift with assignments
      if (shiftsWithAssignments.length === 0) {
        await fetch("/api/shifts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: catName,
            description: catDesc || null,
            date: festDate || new Date().toISOString().split("T")[0],
            startTime: catOneTimeStart,
            endTime: catOneTimeEnd,
            capacity: catOneTimeCount,
            categoryId: catId,
          }),
        });
      }
      setSuccess(`Category "${catName}" updated.`);
    } else if (catType === "throughout") {
      const blocks = calculateShiftBlocks();
      const stations = parseInt(catStationCount) || 1;
      const volsPer = parseInt(catVolsPerStation) || 1;
      const perShift = stations * volsPer;

      // Create new shifts for blocks that don't already have assigned shifts
      const existingCount = shiftsWithAssignments.length;
      for (let i = existingCount; i < blocks.length; i++) {
        await fetch("/api/shifts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: `${catName} — Shift ${i + 1}`,
            description: stations > 1
              ? `${stations} station${stations > 1 ? "s" : ""}, ${volsPer} volunteer${volsPer > 1 ? "s" : ""} per station`
              : catDesc || null,
            date: festDate || new Date().toISOString().split("T")[0],
            startTime: blocks[i].startTime,
            endTime: blocks[i].endTime,
            capacity: perShift,
            categoryId: catId,
            stationCount: stations,
          }),
        });
      }

      if (shiftsWithAssignments.length > 0) {
        setSuccess(`Category "${catName}" updated. ${shiftsWithAssignments.length} shift(s) with assignments were kept. New shifts created as needed.`);
      } else {
        setSuccess(`Category "${catName}" updated with ${blocks.length} shifts.`);
      }
    } else {
      setSuccess(`Category "${catName}" updated.`);
    }

    setShowCategoryForm(false);
    setEditingCatId(null);
    setSelectedCategoryId(null);
    resetCategoryForm();
    loadData();
  };

  const handleDeleteCategory = async (id: string) => {
    clearMessages();
    const res = await fetch("/api/categories", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      loadData();
    } else {
      const data = await res.json();
      setError(data.error || "Failed to delete category.");
    }
  };

  // Shift CRUD
  const handleCreateShift = async (e: FormEvent) => {
    e.preventDefault();
    clearMessages();
    const res = await fetch("/api/shifts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: shiftTitle,
        description: shiftDesc || null,
        date: shiftDate,
        startTime: shiftStart,
        endTime: shiftEnd,
        capacity: shiftCapacity,
        categoryId: shiftCategoryId,
      }),
    });
    if (res.ok) {
      setSuccess("Shift created!");
      setShowShiftForm(false);
      setShiftTitle(""); setShiftDesc(""); setShiftDate(""); setShiftStart(""); setShiftEnd("");
      setShiftCapacity("5"); setShiftCategoryId("");
      loadData();
    }
  };

  const handleDeleteShift = async (id: string) => {
    clearMessages();
    await fetch("/api/shifts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    loadData();
  };

  // Volunteer CRUD
  const handleCreateVolunteer = async (e: FormEvent) => {
    e.preventDefault();
    clearMessages();
    if (!volPhone) {
      setError("A phone number is required so we can send shift reminders.");
      return;
    }
    const res = await fetch("/api/volunteers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: volName, email: volEmail || null, phone: volPhone }),
    });
    if (res.ok) {
      const created = await res.json();
      setSuccess(`${created.name} added!`);
      setShowVolunteerForm(false);
      setNewlyCreatedVol({ id: created.id, name: created.name });
      setPostCreateMode("none");
      setPostCreateTeamId("");
      setPostCreatePairWithId("");
      setVolName(""); setVolEmail(""); setVolPhone("");
      loadData();
    } else {
      const data = await res.json();
      setError(data.error || "Failed to add volunteer.");
    }
  };

  const handlePostCreateAssign = async () => {
    if (!newlyCreatedVol) return;
    clearMessages();
    if (postCreateMode === "team" && postCreateTeamId) {
      const res = await fetch("/api/teams", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: postCreateTeamId, addMembers: [{ name: newlyCreatedVol.name }] }),
      });
      if (res.ok) {
        setSuccess(`${newlyCreatedVol.name} added to team!`);
        loadData();
      } else {
        const data = await res.json();
        setError(data.error || "Failed to add to team.");
      }
    } else if (postCreateMode === "pair" && postCreatePairWithId) {
      const partner = volunteers.find((v: Volunteer) => v.id === postCreatePairWithId);
      if (!partner) return;
      const res = await fetch("/api/pair-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requesterId: newlyCreatedVol.id, partnerName: partner.name }),
      });
      if (res.ok) {
        setSuccess(`${newlyCreatedVol.name} paired with ${partner.name}!`);
        loadData();
      } else {
        const data = await res.json();
        setError(data.error || "Failed to create pair.");
      }
    }
    setNewlyCreatedVol(null);
    setPostCreateMode("none");
    setPostCreateTeamId("");
    setPostCreatePairWithId("");
  };

  const handleDeleteVolunteer = async (v: Volunteer) => {
    if (!confirm(`Delete ${v.name}? This will remove all their assignments, pair requests, and team memberships. This cannot be undone.`)) return;
    clearMessages();
    const res = await fetch("/api/volunteers", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: v.id }),
    });
    if (res.ok) {
      setSuccess(`${v.name} has been deleted.`);
      loadData();
    } else {
      const data = await res.json();
      setError(data.error || "Failed to delete volunteer.");
    }
  };

  // Assignment
  const handleAssign = async (volunteerId: string, shiftId: string, stationIdx?: number) => {
    clearMessages();
    const shift = shifts.find((s) => s.id === shiftId);
    const cat = shift ? categories.find((c) => c.id === shift.categoryId) : null;

    // Auto-find station if not provided
    let stationIndex = stationIdx;
    if (stationIndex === undefined && shift && cat && cat.type === "throughout" && cat.stationCount > 1) {
      const idx = findFirstEmptySlot(shift, cat);
      if (idx !== null) stationIndex = idx;
    }

    const res = await fetch("/api/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ volunteerId, shiftId, assignedBy: "admin", ...(stationIndex !== undefined ? { stationIndex } : {}) }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Assignment failed.");
      return;
    }

    // Auto-assign any approved pair partners to the same shift
    const partnerIds = getApprovedPartnerIds(volunteerId);
    const assignedPartners: string[] = [];
    for (const partnerId of partnerIds) {
      // Skip if partner is already assigned to this shift
      const alreadyAssigned = shift?.assignments.some((a) => a.volunteerId === partnerId && a.status === "confirmed");
      if (alreadyAssigned) continue;

      // Find a station slot for the partner (same station if possible, else next available)
      let partnerStation = stationIndex;
      if (partnerStation !== undefined && shift && cat) {
        // Re-fetch current state from the freshly-loaded shifts won't work yet, so just use same station
        // The partner goes to the same station (they're a pair)
      }

      const partnerRes = await fetch("/api/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ volunteerId: partnerId, shiftId, assignedBy: "admin", ...(partnerStation !== undefined ? { stationIndex: partnerStation } : {}) }),
      });

      if (partnerRes.ok) {
        const partnerVol = volunteers.find((v: Volunteer) => v.id === partnerId);
        if (partnerVol) assignedPartners.push(partnerVol.name);
      }
    }

    const partnerMsg = assignedPartners.length > 0
      ? ` Also auto-assigned partner${assignedPartners.length > 1 ? "s" : ""}: ${assignedPartners.join(", ")}.`
      : "";
    setSuccess(`Volunteer assigned!${partnerMsg}`);
    setShowAssignForm(null);
    loadData();
  };

  const handleUnassign = async (assignmentId: string) => {
    clearMessages();
    await fetch("/api/assignments", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignmentId }),
    });
    loadData();
  };

  // Station name rename — propagates to all sibling shifts in the same category
  // that still have the old default/matching name at the same station index
  const handleRenameStation = async (shiftId: string, stationIndex: number, name: string) => {
    // Find the current (old) name at this station in this shift
    const thisShift = shifts.find((s) => s.id === shiftId);
    const getNames = (s: Shift) => {
      try { return s.stationNames ? JSON.parse(s.stationNames) : []; } catch { return []; }
    };

    // Find all sibling shifts in the same category — always propagate to all of them
    const siblingShifts = shifts.filter(
      (s) => s.categoryId === thisShift?.categoryId && s.id !== shiftId
    );

    // Rename the primary shift
    const res = await fetch("/api/shifts/stations", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shiftId, stationIndex, name }),
    });

    if (res.ok) {
      // Propagate to siblings
      await Promise.all(
        siblingShifts.map((s) =>
          fetch("/api/shifts/stations", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ shiftId: s.id, stationIndex, name }),
          })
        )
      );

      // Update all affected shifts in local state immediately
      const allAffectedIds = new Set([shiftId, ...siblingShifts.map((s) => s.id)]);
      setShifts((prev) =>
        prev.map((s) => {
          if (!allAffectedIds.has(s.id)) return s;
          const names = [...getNames(s)];
          while (names.length <= stationIndex) names.push(`Station ${names.length + 1}`);
          names[stationIndex] = name;
          return { ...s, stationNames: JSON.stringify(names) };
        })
      );
    }
    loadData();
  };

  // Update assignment stationIndex — also moves paired partner if applicable
  const handleUpdateStationIndex = async (assignmentId: string, stationIndex: number, skipPartner?: boolean) => {
    await fetch("/api/assignments", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignmentId, stationIndex }),
    });

    // Move paired partner together (unless we're already handling the partner)
    if (!skipPartner) {
      // Find the assignment to get volunteerId and shiftId
      for (const shift of shifts) {
        const assignment = shift.assignments.find((a) => a.id === assignmentId);
        if (assignment) {
          const partnerIds = getApprovedPartnerIds(assignment.volunteerId);
          if (partnerIds.length > 0) {
            // Find partner's assignment in the same shift
            for (const pid of partnerIds) {
              const partnerAssignment = shift.assignments.find((a) => a.volunteerId === pid && a.status === "confirmed");
              if (partnerAssignment) {
                // Move partner to same station (or adjacent if full)
                const cat = categories.find((c) => c.id === shift.categoryId);
                const volsPer = cat?.volsPerStation || 1;
                const stationMap = getStationAssignments(shift, cat!);
                const currentSlots = stationMap.get(stationIndex) || [];
                // Check if there's room in the target station (accounting for the volunteer we just moved in)
                if (currentSlots.length < volsPer) {
                  await handleUpdateStationIndex(partnerAssignment.id, stationIndex, true);
                } else {
                  // Try adjacent stations
                  const stationCount = cat?.stationCount || 1;
                  let placed = false;
                  for (let offset = 1; offset < stationCount; offset++) {
                    for (const tryIdx of [stationIndex + offset, stationIndex - offset]) {
                      if (tryIdx >= 0 && tryIdx < stationCount) {
                        const trySlots = stationMap.get(tryIdx) || [];
                        if (trySlots.length < volsPer) {
                          await handleUpdateStationIndex(partnerAssignment.id, tryIdx, true);
                          placed = true;
                          break;
                        }
                      }
                    }
                    if (placed) break;
                  }
                }
              }
            }
          }
          break;
        }
      }
    }
  };

  // Get station names for a shift, generating defaults if needed
  const getStationNames = (shift: Shift, cat: Category): string[] => {
    if (shift.stationNames) {
      try { return JSON.parse(shift.stationNames); } catch { /* fall through */ }
    }
    const count = cat.stationCount || 1;
    return Array.from({ length: count }, (_, i) => `Station ${i + 1}`);
  };

  // Distribute assignments across stations for display (assigns stationIndex where missing)
  const getStationAssignments = (shift: Shift, cat: Category): Map<number, Assignment[]> => {
    const stationCount = cat.stationCount || 1;
    const volsPer = cat.volsPerStation || 1;
    const map = new Map<number, Assignment[]>();
    for (let i = 0; i < stationCount; i++) map.set(i, []);

    // Separate assigned (have stationIndex) vs unassigned
    const withStation: Assignment[] = [];
    const withoutStation: Assignment[] = [];
    for (const a of shift.assignments) {
      if (a.stationIndex !== null && a.stationIndex !== undefined && a.stationIndex >= 0 && a.stationIndex < stationCount) {
        withStation.push(a);
      } else {
        withoutStation.push(a);
      }
    }

    // Place assigned ones
    for (const a of withStation) {
      map.get(a.stationIndex!)!.push(a);
    }

    // Distribute unassigned across stations with empty slots
    for (const a of withoutStation) {
      let placed = false;
      for (let i = 0; i < stationCount; i++) {
        if (map.get(i)!.length < volsPer) {
          map.get(i)!.push(a);
          placed = true;
          break;
        }
      }
      if (!placed) {
        // Overflow: place in first station
        map.get(0)!.push(a);
      }
    }

    return map;
  };

  // Find first empty slot across stations
  const findFirstEmptySlot = (shift: Shift, cat: Category): number | null => {
    const stationCount = cat.stationCount || 1;
    const volsPer = cat.volsPerStation || 1;
    const stationMap = getStationAssignments(shift, cat);
    for (let i = 0; i < stationCount; i++) {
      if (stationMap.get(i)!.length < volsPer) return i;
    }
    return null;
  };

  // Get approved pair partner IDs for a volunteer
  const getApprovedPartnerIds = (volunteerId: string): string[] => {
    const partners: string[] = [];
    for (const pr of pairRequests) {
      if (pr.status !== "approved") continue;
      if (pr.requester.id === volunteerId) partners.push(pr.partner.id);
      if (pr.partner.id === volunteerId) partners.push(pr.requester.id);
    }
    return partners;
  };

  // Check if a volunteer is paired with anyone (approved pair request)
  const isPaired = (volunteerId: string): boolean => getApprovedPartnerIds(volunteerId).length > 0;

  // Pair requests
  const handlePairAction = async (id: string, status: string) => {
    await fetch("/api/pair-requests", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });

    // If approved, auto-assign the partner to the same shifts as the requester (and vice versa)
    if (status === "approved") {
      const pr = pairRequests.find((p) => p.id === id);
      if (pr) {
        const requesterId = pr.requester.id;
        const partnerId = pr.partner.id;

        // Get all current assignments for both
        const requesterAssignments = shifts.flatMap((s) =>
          s.assignments.filter((a) => a.volunteerId === requesterId && a.status === "confirmed").map((a) => ({ shiftId: s.id, stationIndex: a.stationIndex }))
        );
        const partnerAssignments = shifts.flatMap((s) =>
          s.assignments.filter((a) => a.volunteerId === partnerId && a.status === "confirmed").map((a) => ({ shiftId: s.id, stationIndex: a.stationIndex }))
        );

        // Assign partner to requester's shifts (if not already there)
        const partnerShiftIds = new Set(partnerAssignments.map((a) => a.shiftId));
        for (const ra of requesterAssignments) {
          if (!partnerShiftIds.has(ra.shiftId)) {
            // Try to place in same or adjacent station
            const shift = shifts.find((s) => s.id === ra.shiftId);
            const cat = shift ? categories.find((c) => c.id === shift.categoryId) : null;
            let stationIdx = ra.stationIndex ?? undefined;
            // If same station is full, find next available
            if (shift && cat && stationIdx !== undefined) {
              const stationMap = getStationAssignments(shift, cat);
              const volsPer = cat.volsPerStation || 1;
              if ((stationMap.get(stationIdx)?.length || 0) >= volsPer) {
                const empty = findFirstEmptySlot(shift, cat);
                stationIdx = empty ?? undefined;
              }
            }
            await fetch("/api/assignments", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ volunteerId: partnerId, shiftId: ra.shiftId, assignedBy: "admin", ...(stationIdx !== undefined ? { stationIndex: stationIdx } : {}) }),
            });
          }
        }

        // Assign requester to partner's shifts (if not already there)
        const requesterShiftIds = new Set(requesterAssignments.map((a) => a.shiftId));
        for (const pa of partnerAssignments) {
          if (!requesterShiftIds.has(pa.shiftId)) {
            const shift = shifts.find((s) => s.id === pa.shiftId);
            const cat = shift ? categories.find((c) => c.id === shift.categoryId) : null;
            let stationIdx = pa.stationIndex ?? undefined;
            if (shift && cat && stationIdx !== undefined) {
              const stationMap = getStationAssignments(shift, cat);
              const volsPer = cat.volsPerStation || 1;
              if ((stationMap.get(stationIdx)?.length || 0) >= volsPer) {
                const empty = findFirstEmptySlot(shift, cat);
                stationIdx = empty ?? undefined;
              }
            }
            await fetch("/api/assignments", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ volunteerId: requesterId, shiftId: pa.shiftId, assignedBy: "admin", ...(stationIdx !== undefined ? { stationIndex: stationIdx } : {}) }),
            });
          }
        }

        setSuccess(`Partner request approved! ${pr.requester.name} and ${pr.partner.name} have been assigned to the same shifts.`);
      }
    }

    loadData();
  };

  // Notifications
  const handleSendReminder = async (shiftId: string) => {
    clearMessages();
    const res = await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "reminder", shiftId }),
    });
    if (res.ok) {
      const data = await res.json();
      setSuccess(`Reminders sent to ${data.sent} volunteer(s)!`);
      loadData();
    }
  };

  const handleBroadcast = async () => {
    clearMessages();
    if (!broadcastMessage) return;
    const res = await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "broadcast", customMessage: broadcastMessage }),
    });
    if (res.ok) {
      setSuccess("Broadcast sent!");
      setBroadcastMessage("");
      setShowBroadcast(false);
      loadData();
    }
  };

  // Settings
  const handleSaveSettings = async () => {
    clearMessages();
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    setSuccess("Settings saved!");
  };

  // Reusable category wizard form (used for both new and inline edit)
  const renderCategoryForm = (isInline?: boolean) => (
    <div className={`bg-white rounded-xl border p-6 ${isInline ? "mt-2 mb-0" : "mb-6"} space-y-5 ${editingCatId ? "border-blue-300 bg-blue-50/30" : "border-amber-200"}`}>
      {editingCatId && (
        <div className="flex items-center justify-between">
          <div className="bg-blue-100 text-blue-800 px-4 py-2 rounded-lg text-sm font-medium">
            Editing: {categories.find((c) => c.id === editingCatId)?.name || "Category"}
          </div>
          <button type="button" onClick={() => { setShowCategoryForm(false); setEditingCatId(null); resetCategoryForm(); }} className="text-gray-400 hover:text-gray-600 text-xl font-bold">&times;</button>
        </div>
      )}
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-2">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
              catStep === s ? "bg-amber-700 text-white" :
              catStep > s ? "bg-green-500 text-white" :
              "bg-gray-200 text-gray-500"
            }`}>{catStep > s ? "✓" : s}</div>
            {s < 3 && <div className={`w-8 h-0.5 ${catStep > s ? "bg-green-500" : "bg-gray-200"}`} />}
          </div>
        ))}
        <span className="ml-3 text-sm text-gray-500">
          {catStep === 1 ? "Name & Type" : catStep === 2 ? "Details" : "Review & Confirm"}
        </span>
      </div>

      {/* STEP 1: Name + Type */}
      {catStep === 1 && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category Name *</label>
            <input value={catName} onChange={(e) => setCatName(e.target.value)} className={inputClass} placeholder="e.g. Pour, Set-Up, VIP" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
            <input value={catDesc} onChange={(e) => setCatDesc(e.target.value)} className={inputClass} placeholder="What volunteers in this category do..." />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Is this a one-time task or throughout the festival?</label>
            <div className="grid sm:grid-cols-2 gap-3">
              <button type="button" onClick={() => setCatType("one-time")} className={`p-4 rounded-lg border-2 text-left transition-all ${catType === "one-time" ? "border-amber-500 bg-amber-50" : "border-gray-200 hover:border-gray-300"}`}>
                <p className="font-bold text-amber-900">One-Time</p>
                <p className="text-xs text-gray-500 mt-1">A single task at a specific time (e.g. Set-Up, Break-Down)</p>
              </button>
              <button type="button" onClick={() => setCatType("throughout")} className={`p-4 rounded-lg border-2 text-left transition-all ${catType === "throughout" ? "border-amber-500 bg-amber-50" : "border-gray-200 hover:border-gray-300"}`}>
                <p className="font-bold text-amber-900">Throughout Festival</p>
                <p className="text-xs text-gray-500 mt-1">Multiple shifts across the event (e.g. Pour, Trash, Ice)</p>
              </button>
            </div>
          </div>
          <div className="flex justify-end">
            <button type="button" onClick={() => {
              if (!catName) { setError("Category name is required."); return; }
              if (!catType) { setError("Please select one-time or throughout."); return; }
              clearMessages();
              // Auto-generate shift blocks when entering step 2 for "throughout" categories
              if (catType === "throughout" && catShiftBlocks.length === 0) {
                const n = parseInt(catShiftCount) || 3;
                const blocks = generateDefaultBlocks(n);
                if (blocks.length > 0) setCatShiftBlocks(blocks);
              }
              setCatStep(2);
            }} className={btnPrimary}>Next →</button>
          </div>
        </div>
      )}

      {/* STEP 2: One-time details */}
      {catStep === 2 && catType === "one-time" && (
        <div className="space-y-4">
          <h3 className="font-bold text-amber-900">One-Time: {catName}</h3>
          <p className="text-sm text-gray-500">How many volunteers are needed and when?</p>
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Volunteers Needed *</label>
              <input type="number" min="1" value={catOneTimeCount} onChange={(e) => setCatOneTimeCount(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Time *</label>
              <TimeInput value={catOneTimeStart} onChange={setCatOneTimeStart} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Time *</label>
              <TimeInput value={catOneTimeEnd} onChange={setCatOneTimeEnd} className={inputClass} />
            </div>
          </div>
          <div className="flex justify-between">
            <button type="button" onClick={() => setCatStep(1)} className="text-amber-700 text-sm font-medium hover:underline">← Back</button>
            <button type="button" onClick={() => { if (!catOneTimeStart || !catOneTimeEnd) { setError("Start and end time required."); return; } clearMessages(); setCatStep(3); }} className={btnPrimary}>Next →</button>
          </div>
        </div>
      )}

      {/* STEP 2: Throughout details */}
      {catStep === 2 && catType === "throughout" && (
        <div className="space-y-4">
          <h3 className="font-bold text-amber-900">Throughout Festival: {catName}</h3>
          {parseFestivalTimes()
            ? <p className="text-sm text-gray-500">Festival runs <strong>{settings.festivalTime}</strong>. Shift times are divided equally — click any time to adjust.</p>
            : <p className="text-sm text-red-600">⚠️ Festival time not set or not readable. Go to <strong>Settings</strong> and set the festival time (e.g. "12:00 PM - 6:00 PM"), then come back.</p>
          }
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">How many shifts across the festival? *</label>
            <input type="number" min="1" max="20" value={catShiftCount} onChange={(e) => handleShiftCountChange(e.target.value)} className={inputClass + " max-w-[200px]"} />
            {parseFestivalTimes() && parseInt(catShiftCount) > 0 && (
              <div className="mt-3">
                <p className="text-xs text-gray-500 mb-2">Click any time to edit it, or type directly (e.g. &quot;2:30 PM&quot;).</p>
                <div className="flex flex-wrap gap-2">
                  {calculateShiftBlocks().map((b, i) => (
                    <div key={i} className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm flex items-center gap-1.5">
                      <span className="text-xs text-gray-400 font-medium">Shift {i + 1}:</span>
                      <div className="w-28"><TimeInput value={b.startTime} onChange={(val) => updateBlockTime(i, "startTime", val)} className="w-full border border-amber-300 rounded px-1.5 py-0.5 text-sm focus:ring-2 focus:ring-amber-400 outline-none bg-white" /></div>
                      <span className="text-gray-400">–</span>
                      <div className="w-28"><TimeInput value={b.endTime} onChange={(val) => updateBlockTime(i, "endTime", val)} className="w-full border border-amber-300 rounded px-1.5 py-0.5 text-sm focus:ring-2 focus:ring-amber-400 outline-none bg-white" /></div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          {parseInt(catShiftCount) > 0 && (
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">How many stations need these shifts?</label>
                <input type="number" min="1" value={catStationCount} onChange={(e) => setCatStationCount(e.target.value)} className={inputClass} />
                <p className="text-xs text-gray-400 mt-1">e.g. 15 beer stations, 4 trash zones</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Volunteers per station per shift?</label>
                <input type="number" min="1" value={catVolsPerStation} onChange={(e) => setCatVolsPerStation(e.target.value)} className={inputClass} />
                <p className="text-xs text-gray-400 mt-1">e.g. 2 pourers per station</p>
              </div>
            </div>
          )}
          {parseInt(catShiftCount) > 0 && (() => {
            const t = calcThroughoutTotals();
            return (
              <div className="bg-amber-50 border border-amber-300 rounded-lg p-4">
                <p className="font-bold text-amber-900 mb-2">Summary</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                  <div className="bg-white rounded-lg p-3 border border-amber-200"><p className="text-2xl font-bold text-amber-900">{t.numShifts}</p><p className="text-xs text-gray-500">Shift{t.numShifts !== 1 ? "s" : ""}</p></div>
                  <div className="bg-white rounded-lg p-3 border border-amber-200"><p className="text-2xl font-bold text-amber-900">{t.stations}</p><p className="text-xs text-gray-500">Station{t.stations !== 1 ? "s" : ""}</p></div>
                  <div className="bg-white rounded-lg p-3 border border-amber-200"><p className="text-2xl font-bold text-amber-900">{t.perShift}</p><p className="text-xs text-gray-500">Per Shift</p></div>
                  <div className="bg-white rounded-lg p-3 border border-amber-200"><p className="text-2xl font-bold text-green-700">{t.totalSlots}</p><p className="text-xs text-gray-500">Total Volunteers</p></div>
                </div>
                {t.stations > 1 && (<p className="text-xs text-gray-600 mt-3 text-center">{t.stations} stations &times; {t.volsPer} volunteer{t.volsPer > 1 ? "s" : ""} = {t.perShift} per shift &times; {t.numShifts} shifts = <strong>{t.totalSlots} total</strong></p>)}
              </div>
            );
          })()}
          <div className="flex justify-between">
            <button type="button" onClick={() => setCatStep(1)} className="text-amber-700 text-sm font-medium hover:underline">← Back</button>
            <button type="button" onClick={() => { if (!parseFestivalTimes()) { setError("Festival time not set. Go to Settings and set the festival time first."); return; } clearMessages(); setCatStep(3); }} className={btnPrimary}>Next →</button>
          </div>
        </div>
      )}

      {/* STEP 3: Review & Create/Update */}
      {catStep === 3 && (
        <div className="space-y-4">
          <h3 className="font-bold text-amber-900 text-lg">Review &amp; {editingCatId ? "Update" : "Create"}</h3>
          <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Category:</span><span className="font-bold text-amber-900">{catName}</span></div>
            {catDesc && (<div className="flex justify-between"><span className="text-gray-500">Description:</span><span className="text-gray-700">{catDesc}</span></div>)}
            <div className="flex justify-between"><span className="text-gray-500">Type:</span><span className="font-medium">{catType === "one-time" ? "One-Time" : "Throughout Festival"}</span></div>
            {catType === "one-time" && (
              <>
                <div className="flex justify-between"><span className="text-gray-500">Time:</span><span>{fmt12(catOneTimeStart)} – {fmt12(catOneTimeEnd)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Volunteers needed:</span><span className="font-bold text-green-700">{catOneTimeCount}</span></div>
                <hr className="border-gray-200" /><p className="text-xs text-gray-500">1 shift will be created for the festival date.</p>
              </>
            )}
            {catType === "throughout" && (() => {
              const t = calcThroughoutTotals();
              const blocks = calculateShiftBlocks();
              return (
                <>
                  <div className="flex justify-between"><span className="text-gray-500">Shifts:</span><span>{t.numShifts}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Stations:</span><span>{t.stations}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Volunteers per station:</span><span>{t.volsPer}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Per shift capacity:</span><span className="font-bold">{t.perShift}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Total volunteers needed:</span><span className="font-bold text-green-700">{t.totalSlots}</span></div>
                  <hr className="border-gray-200" />
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Shifts to be created:</p>
                    {blocks.map((b, i) => (<p key={i} className="text-xs text-gray-600">{catName} — Shift {i + 1}: {fmt12(b.startTime)} – {fmt12(b.endTime)} ({t.perShift} volunteers)</p>))}
                  </div>
                </>
              );
            })()}
          </div>
          <div className="flex justify-between">
            <button type="button" onClick={() => setCatStep(2)} className="text-amber-700 text-sm font-medium hover:underline">← Back</button>
            <button type="button" onClick={() => editingCatId ? handleUpdateCategory() : handleCreateCategory()} className={btnPrimary + " px-8"}>
              {editingCatId ? "Update Category & Shifts" : "Create Category & Shifts"}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // Login screen
  if (!authenticated) {
    return (
      <div className="max-w-sm mx-auto mt-20 px-4">
        <div className="bg-white rounded-xl shadow-md p-8 border border-amber-200">
          <h1 className="text-2xl font-bold text-amber-900 mb-6 text-center">Admin Login</h1>
          {authError && <div className="bg-red-50 text-red-700 p-3 rounded mb-4 text-sm">{authError}</div>}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            placeholder="Admin password"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 mb-4 focus:ring-2 focus:ring-amber-400 outline-none"
          />
          <button
            onClick={handleLogin}
            className="w-full bg-amber-700 text-white py-2 rounded-lg font-medium hover:bg-amber-800 transition-colors"
          >
            Login
          </button>
        </div>
      </div>
    );
  }

  const inputClass = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400 outline-none";
  const btnPrimary = "bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-800 transition-colors";
  const btnDanger = "bg-red-100 text-red-700 px-3 py-1.5 rounded text-xs font-medium hover:bg-red-200";

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
        <h1 className="text-3xl font-bold text-amber-900">Admin Dashboard</h1>
        <div className="flex gap-2 text-sm flex-wrap">
          <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full font-medium">
            {volunteers.length} volunteer{volunteers.length !== 1 ? "s" : ""} signed up
          </span>
          <span className="bg-amber-100 text-amber-800 px-3 py-1 rounded-full font-medium">
            {shifts.reduce((sum, s) => sum + s.assignments.filter((a: {status:string}) => a.status === "confirmed").length, 0)} of {shifts.reduce((sum, s) => sum + s.capacity, 0)} volunteers assigned
          </span>
        </div>
      </div>

      {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg mb-4 text-sm">{error}</div>}
      {success && <div className="bg-green-50 text-green-700 p-3 rounded-lg mb-4 text-sm">{success}</div>}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 mb-6 bg-amber-100 rounded-lg p-1">
        {(["categories", "volunteers", "approvals", "teams", "notifications", "settings"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); clearMessages(); }}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab
                ? "bg-white text-amber-900 shadow-sm"
                : "text-amber-700 hover:text-amber-900"
            }`}
          >
            {tab === "categories" ? "Categories & Shifts" :
             tab === "approvals" ? <>Approvals {(() => { const total = pendingAssignments.length + pairRequests.filter(pr => pr.status === "pending").length + volunteers.filter((v: Volunteer) => (v as Volunteer & {pendingRole?:string}).pendingRole === "team_lead").length; return total > 0 ? <span className="ml-1 bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">{total}</span> : null; })()}</> :
             tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* ========= CATEGORIES TAB ========= */}
      {activeTab === "categories" && !selectedCategoryId && (
        <div>
          <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
            <h2 className="text-xl font-bold text-amber-900">Categories &amp; Shifts</h2>
            <div className="flex flex-wrap gap-2">
              <a
                href="/api/export?type=master&format=html"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-amber-100 text-amber-700 px-3 py-2 rounded text-xs font-medium hover:bg-amber-200"
                title="Print master schedule (every confirmed assignment)"
              >🖨 Master Sheet</a>
              <a
                href="/api/export?type=master&format=csv"
                className="bg-amber-100 text-amber-700 px-3 py-2 rounded text-xs font-medium hover:bg-amber-200"
                title="Download master schedule CSV"
              >📥 Master CSV</a>
              <a
                href="/api/export?type=coverage&format=html"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-orange-100 text-orange-700 px-3 py-2 rounded text-xs font-medium hover:bg-orange-200"
                title="View coverage gap report"
              >📊 Coverage</a>
              <button onClick={() => {
                if (showCategoryForm) { resetCategoryForm(); setEditingCatId(null); }
                setShowCategoryForm(!showCategoryForm);
              }} className={btnPrimary}>
                {showCategoryForm ? "Cancel" : "+ New Category"}
              </button>
            </div>
          </div>

          {showCategoryForm && !editingCatId && renderCategoryForm()}

          <p className="text-xs text-gray-500 mb-3 italic">Drag categories to reorder. Double-click to view shifts.</p>

          <div className="space-y-2">
            {categories.map((cat, index) => (
              <div key={cat.id}>
              <div
                draggable={!editingCatId}
                onDragStart={() => handleDragStart(index)}
                onDragEnter={() => handleDragEnter(index)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => e.preventDefault()}
                onDoubleClick={() => { if (!editingCatId) setSelectedCategoryId(cat.id); }}
                className={`bg-white rounded-lg border p-5 transition-all ${
                  dragIndex === index
                    ? "border-amber-500 opacity-50 scale-[0.98]"
                    : editingCatId === cat.id
                    ? "border-blue-400 shadow-md"
                    : "border-amber-100 hover:border-amber-300 hover:shadow-sm"
                } ${editingCatId && editingCatId !== cat.id ? "opacity-40" : ""} cursor-grab active:cursor-grabbing select-none`}
              >
                {(() => {
                  const catShifts = shifts.filter((s) => s.categoryId === cat.id);
                  const totalNeeded = catShifts.reduce((sum, s) => sum + s.capacity, 0);
                  const totalAssigned = catShifts.reduce((sum, s) => sum + s.assignments.filter((a) => a.status === "confirmed").length, 0);
                  const isOneTime = catShifts.length === 1;
                  const assignedVols = isOneTime ? catShifts[0]?.assignments.filter((a) => a.status === "confirmed").map((a) => a.volunteer) || [] : [];
                  const pctFull = totalNeeded > 0 ? Math.round((totalAssigned / totalNeeded) * 100) : 0;

                  return (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {/* Drag handle */}
                        <div className="text-gray-300 hover:text-gray-500 flex flex-col gap-0.5 shrink-0" title="Drag to reorder">
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="5" cy="3" r="1.5"/><circle cx="11" cy="3" r="1.5"/><circle cx="5" cy="8" r="1.5"/><circle cx="11" cy="8" r="1.5"/><circle cx="5" cy="13" r="1.5"/><circle cx="11" cy="13" r="1.5"/></svg>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400 font-mono w-5">{index + 1}.</span>
                            <h3 className="font-bold text-amber-900 text-lg">{cat.name}</h3>
                            {/* Assigned / Total */}
                            <span className={`text-sm font-medium ml-1 ${
                              totalAssigned >= totalNeeded && totalNeeded > 0 ? "text-green-600" : "text-gray-500"
                            }`}>
                              {totalAssigned} / {totalNeeded}
                            </span>
                            {totalNeeded > 0 && (
                              <div className="hidden sm:flex items-center gap-1 ml-1">
                                <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all ${
                                      pctFull >= 100 ? "bg-green-500" : pctFull >= 50 ? "bg-amber-500" : "bg-red-400"
                                    }`}
                                    style={{ width: `${Math.min(pctFull, 100)}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-gray-400">{pctFull}%</span>
                              </div>
                            )}
                          </div>
                          {/* For throughout categories, show double-click hint */}
                          {cat.type === "throughout" && (
                            <p className="text-xs italic text-gray-400 ml-8 mt-0.5">Double-click to manage shifts</p>
                          )}
                          {/* For one-time categories, show assigned volunteer names */}
                          {isOneTime && assignedVols.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-1.5 ml-8">
                              {assignedVols.map((v) => (
                                <button
                                  key={v.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const fullVol = volunteers.find((vol) => vol.id === v.id);
                                    if (fullVol) setViewingVolunteer(fullVol as Volunteer & { assignments?: Assignment[] });
                                  }}
                                  className="bg-green-50 border border-green-200 text-green-800 px-2 py-0.5 rounded-full text-xs font-medium hover:bg-green-100 hover:border-green-300 transition-colors cursor-pointer"
                                  title={`View ${v.name}'s info`}
                                >
                                  {v.name}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 ml-8 sm:ml-0 shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedCategoryId(cat.id);
                          }}
                          className="bg-amber-100 text-amber-800 px-3 py-1.5 rounded text-xs font-medium hover:bg-amber-200"
                        >
                          View Shifts
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            startEditCategory(cat);
                          }}
                          className="bg-blue-100 text-blue-700 px-3 py-1.5 rounded text-xs font-medium hover:bg-blue-200"
                        >
                          Edit
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleDeleteCategory(cat.id); }} className={btnDanger}>
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
              {/* Inline edit form appears directly below the category being edited */}
              {showCategoryForm && editingCatId === cat.id && renderCategoryForm(true)}
              </div>
            ))}
            {categories.length === 0 && (
              <p className="text-gray-500 text-center py-8">No categories yet. Create your first volunteer category above.</p>
            )}
          </div>
        </div>
      )}

      {/* ========= CATEGORY DRILL-DOWN (Shifts for a category) ========= */}
      {activeTab === "categories" && selectedCategoryId && (() => {
        const selectedCat = categories.find((c) => c.id === selectedCategoryId);
        const categoryShifts = shifts.filter((s) => s.categoryId === selectedCategoryId);
        return (
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelectedCategoryId(null)}
                  className="bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-800 transition-colors flex items-center gap-1"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 12L6 8l4-4"/></svg>
                  Return to Categories
                </button>
                <h2 className="text-xl font-bold text-amber-900">
                  {selectedCat?.name} <span className="text-gray-400 font-normal text-base">({categoryShifts.length} shift{categoryShifts.length !== 1 ? "s" : ""})</span>
                </h2>
              </div>
              <button
                onClick={() => {
                  setShiftCategoryId(selectedCategoryId);
                  setShowShiftForm(!showShiftForm);
                }}
                className={btnPrimary}
              >
                {showShiftForm ? "Cancel" : `+ New ${selectedCat?.name} Shift`}
              </button>
            </div>

            {showShiftForm && (
              <form onSubmit={handleCreateShift} className="bg-white rounded-xl border border-amber-200 p-6 mb-6 space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Shift Title *</label>
                    <input value={shiftTitle} onChange={(e) => setShiftTitle(e.target.value)} className={inputClass} placeholder="Beer Tent Setup" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                    <input value={selectedCat?.name || ""} className={inputClass + " bg-gray-50"} disabled />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
                    <input type="date" value={shiftDate} onChange={(e) => setShiftDate(e.target.value)} className={inputClass} required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Capacity</label>
                    <input type="number" min="1" value={shiftCapacity} onChange={(e) => setShiftCapacity(e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Start Time *</label>
                    <TimeInput value={shiftStart} onChange={setShiftStart} className={inputClass} placeholder="e.g. 2:00 PM" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">End Time *</label>
                    <TimeInput value={shiftEnd} onChange={setShiftEnd} className={inputClass} placeholder="e.g. 6:00 PM" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea value={shiftDesc} onChange={(e) => setShiftDesc(e.target.value)} className={inputClass} rows={2} placeholder="What volunteers will be doing..." />
                </div>
                <button type="submit" className={btnPrimary}>Create Shift</button>
              </form>
            )}

            <div className="space-y-4">
              {categoryShifts.map((shift) => {
                const stationNames = selectedCat ? getStationNames(shift, selectedCat) : [];
                const stationCount = selectedCat?.stationCount || 1;
                const volsPer = selectedCat?.volsPerStation || 1;
                const stationMap = selectedCat ? getStationAssignments(shift, selectedCat) : new Map<number, Assignment[]>();
                const isThroughout = selectedCat?.type === "throughout" && stationCount > 1;

                return (
                <div key={shift.id} className="bg-white rounded-lg border border-amber-100 p-5">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div>
                      <h3 className="font-bold text-lg text-amber-900">{shift.title}</h3>
                      <div className="text-sm text-gray-600 mt-1 space-y-0.5">
                        <p>{fmt12(shift.startTime)} - {fmt12(shift.endTime)}</p>
                        <p>{shift.assignments.length}/{shift.capacity} volunteers assigned</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <a
                        href={`/api/export?type=shift&shiftId=${shift.id}&format=html`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-gray-100 text-gray-700 px-3 py-1.5 rounded text-xs font-medium hover:bg-gray-200"
                        title="Print roster for this shift"
                      >🖨 Roster</a>
                      <button onClick={() => handleSendReminder(shift.id)} className="bg-blue-100 text-blue-700 px-3 py-1.5 rounded text-xs font-medium hover:bg-blue-200">
                        Send Reminders
                      </button>
                      <button onClick={() => setShowAssignForm(showAssignForm === shift.id ? null : shift.id)} className="bg-green-100 text-green-700 px-3 py-1.5 rounded text-xs font-medium hover:bg-green-200">
                        + Assign
                      </button>
                      <button onClick={() => handleDeleteShift(shift.id)} className={btnDanger}>Delete</button>
                    </div>
                  </div>

                  {showAssignForm === shift.id && (
                    <div className="mt-3 p-3 bg-green-50 rounded-lg">
                      <p className="text-sm font-medium text-green-900 mb-2">Assign a volunteer:</p>
                      <div className="flex flex-wrap gap-2">
                        {volunteers
                          .filter((v) => !shift.assignments.some((a) => a.volunteerId === v.id && a.status === "confirmed"))
                          .map((v) => (
                            <button
                              key={v.id}
                              onClick={() => handleAssign(v.id, shift.id)}
                              className={`bg-white border px-3 py-1 rounded text-xs hover:bg-green-100 ${
                                v.role === "team_lead"
                                  ? "text-teal-800 border-teal-400 font-semibold"
                                  : "text-green-800 border-green-300"
                              }`}
                              title={v.role === "team_lead" ? "Team Lead — can be assigned independently from their team" : undefined}
                            >
                              {v.role === "team_lead" && "👑 "}{v.name}
                            </button>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Station grid for throughout categories */}
                  {isThroughout && (
                    <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                      {stationNames.map((sName: string, sIdx: number) => {
                        const stationAssignments = stationMap.get(sIdx) || [];
                        const editKey = `${shift.id}-${sIdx}`;
                        return (
                          <div key={sIdx} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                            {/* Station name - clickable to edit */}
                            {editingStationKey === editKey ? (
                              <input
                                autoFocus
                                className="w-full text-sm font-semibold text-amber-900 border border-amber-400 rounded px-1.5 py-0.5 mb-2 focus:ring-2 focus:ring-amber-400 outline-none bg-white"
                                value={editingStationName}
                                onChange={(e) => setEditingStationName(e.target.value)}
                                onBlur={() => {
                                  if (editingStationName.trim()) handleRenameStation(shift.id, sIdx, editingStationName.trim());
                                  setEditingStationKey(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    if (editingStationName.trim()) handleRenameStation(shift.id, sIdx, editingStationName.trim());
                                    setEditingStationKey(null);
                                  }
                                  if (e.key === "Escape") setEditingStationKey(null);
                                }}
                              />
                            ) : (
                              <button
                                className="text-sm font-semibold text-amber-900 hover:text-amber-700 mb-2 text-left w-full cursor-text truncate"
                                onClick={() => { setEditingStationKey(editKey); setEditingStationName(sName); }}
                                title="Click to rename station"
                              >
                                {sName}
                              </button>
                            )}

                            {/* Volunteer slots */}
                            <div className="space-y-1.5">
                              {Array.from({ length: volsPer }, (_, slotIdx) => {
                                const assignment = stationAssignments[slotIdx];
                                if (assignment) {
                                  return (
                                    <div
                                      key={assignment.id}
                                      draggable
                                      onDragStart={() => setStationDrag({ assignmentId: assignment.id, fromShiftId: shift.id, fromStationIndex: sIdx })}
                                      onDragEnd={() => setStationDrag(null)}
                                      onDragOver={(e) => e.preventDefault()}
                                      onDrop={async (e) => {
                                        e.preventDefault();
                                        if (!stationDrag || stationDrag.assignmentId === assignment.id) return;
                                        const fromIdx = stationDrag.fromStationIndex;
                                        // Swap both volunteers first (skipPartner=true so we handle partners explicitly)
                                        await handleUpdateStationIndex(stationDrag.assignmentId, sIdx, true);
                                        await handleUpdateStationIndex(assignment.id, fromIdx, true);
                                        // Now move partners: dragged vol's partner → sIdx, displaced vol's partner → fromIdx
                                        const allAssignments = shifts.flatMap((s) => s.assignments);
                                        const draggedAssignment = allAssignments.find((a) => a.id === stationDrag.assignmentId);
                                        if (draggedAssignment) {
                                          for (const pid of getApprovedPartnerIds(draggedAssignment.volunteerId)) {
                                            const pa = shift.assignments.find((a) => a.volunteerId === pid && a.status === "confirmed");
                                            if (pa) await handleUpdateStationIndex(pa.id, sIdx, true);
                                          }
                                        }
                                        for (const pid of getApprovedPartnerIds(assignment.volunteerId)) {
                                          const pa = shift.assignments.find((a) => a.volunteerId === pid && a.status === "confirmed");
                                          if (pa) await handleUpdateStationIndex(pa.id, fromIdx, true);
                                        }
                                        setStationDrag(null);
                                        loadData();
                                      }}
                                      className={`flex items-center justify-between rounded px-2 py-1 text-xs cursor-grab active:cursor-grabbing ${
                                        isPaired(assignment.volunteerId)
                                          ? "bg-purple-100 border border-purple-400"
                                          : "bg-green-100 border border-green-300"
                                      }`}
                                    >
                                      <span
                                        className={`font-medium truncate cursor-pointer ${isPaired(assignment.volunteerId) ? "text-purple-900" : "text-green-900"}`}
                                        onDoubleClick={() => {
                                          setActiveTab("volunteers");
                                          setSelectedCategoryId(null);
                                          setViewingVolunteer(assignment.volunteer as Volunteer & { assignments?: Assignment[] });
                                        }}
                                        title="Double-click to view volunteer details"
                                      >{assignment.volunteer.role === "team_lead" && <span title="Team Lead" className="mr-0.5">👑</span>}{isPaired(assignment.volunteerId) && <span title="Partnered volunteer" className="mr-0.5">🔗</span>}{assignment.volunteer.name}</span>
                                      <button onClick={() => handleUnassign(assignment.id)} className="text-red-500 hover:text-red-700 ml-1 shrink-0">&times;</button>
                                    </div>
                                  );
                                }
                                return (
                                  <div
                                    key={`empty-${sIdx}-${slotIdx}`}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={async (e) => {
                                      e.preventDefault();
                                      if (!stationDrag) return;
                                      // Move the volunteer (skip partner logic, we handle it explicitly)
                                      await handleUpdateStationIndex(stationDrag.assignmentId, sIdx, true);
                                      // Force partner to the exact same station
                                      const draggedAssignment = shift.assignments.find((a) => a.id === stationDrag.assignmentId);
                                      if (draggedAssignment) {
                                        for (const pid of getApprovedPartnerIds(draggedAssignment.volunteerId)) {
                                          const pa = shift.assignments.find((a) => a.volunteerId === pid && a.status === "confirmed");
                                          if (pa) await handleUpdateStationIndex(pa.id, sIdx, true);
                                        }
                                      }
                                      setStationDrag(null);
                                      loadData();
                                    }}
                                    className="border-2 border-dashed border-gray-300 rounded px-2 py-1 text-xs text-gray-400 text-center"
                                  >
                                    empty
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Simple pill view for non-station shifts */}
                  {!isThroughout && shift.assignments.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {shift.assignments.map((a) => (
                        <div key={a.id} className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs ${isPaired(a.volunteerId) ? "bg-purple-50 border border-purple-300" : "bg-amber-50 border border-amber-200"}`}>
                          <span
                            className="font-medium cursor-pointer"
                            onDoubleClick={() => {
                              setActiveTab("volunteers");
                              setSelectedCategoryId(null);
                              setViewingVolunteer(a.volunteer as Volunteer & { assignments?: Assignment[] });
                            }}
                            title="Double-click to view volunteer details"
                          >{a.volunteer.role === "team_lead" && <span title="Team Lead" className="mr-0.5">👑</span>}{isPaired(a.volunteerId) && <span className="mr-0.5">🔗</span>}{a.volunteer.name}</span>
                          <span className="text-gray-400">({a.assignedBy})</span>
                          <button onClick={() => handleUnassign(a.id)} className="text-red-500 hover:text-red-700 ml-1">&times;</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                );
              })}
              {categoryShifts.length === 0 && (
                <div className="text-center py-12 bg-white rounded-lg border border-amber-100">
                  <p className="text-gray-500 mb-3">No shifts in this category yet.</p>
                  <button
                    onClick={() => {
                      setShiftCategoryId(selectedCategoryId);
                      setShowShiftForm(true);
                    }}
                    className={btnPrimary}
                  >
                    + Create First Shift
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ========= VOLUNTEERS TAB ========= */}
      {activeTab === "volunteers" && (
        <div>
          <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
            <h2 className="text-xl font-bold text-amber-900">Manage Volunteers</h2>
            <div className="flex flex-wrap gap-2">
              <a
                href="/api/export?type=volunteers&format=csv"
                className="bg-blue-100 text-blue-700 px-3 py-2 rounded text-xs font-medium hover:bg-blue-200"
                title="Download volunteer roster as CSV"
              >📥 Export CSV</a>
              <a
                href="/api/export?type=volunteers&format=html"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-blue-100 text-blue-700 px-3 py-2 rounded text-xs font-medium hover:bg-blue-200"
                title="Open printable roster in new tab"
              >🖨 Print Roster</a>
              <button onClick={() => setShowVolunteerForm(!showVolunteerForm)} className={btnPrimary}>
                {showVolunteerForm ? "Cancel" : "+ Add Volunteer"}
              </button>
            </div>
          </div>

          {/* Bulk-assign action bar (visible when volunteers are selected) */}
          {selectedVolIds.size > 0 && (
            <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 mb-4 flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-amber-900">
                {selectedVolIds.size} selected
              </span>
              <span className="text-gray-400 text-sm">→</span>
              <select
                value={bulkAssignShiftId}
                onChange={(e) => setBulkAssignShiftId(e.target.value)}
                className="border border-amber-300 rounded px-2 py-1 text-sm bg-white"
              >
                <option value="">Pick a shift…</option>
                {[...shifts]
                  .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.startTime.localeCompare(b.startTime))
                  .map((s: Shift) => {
                    const cat = categories.find((c: Category) => c.id === s.categoryId);
                    const filled = s.assignments.filter((a) => a.status === "confirmed").length;
                    return (
                      <option key={s.id} value={s.id}>
                        {cat?.name || ""} — {s.title} ({fmt12(s.startTime)}, {filled}/{s.capacity})
                      </option>
                    );
                  })}
              </select>
              <button
                disabled={!bulkAssignShiftId}
                onClick={async () => {
                  clearMessages();
                  const res = await fetch("/api/assignments/bulk", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      shiftId: bulkAssignShiftId,
                      volunteerIds: Array.from(selectedVolIds),
                    }),
                  });
                  if (res.ok) {
                    const data = await res.json();
                    const parts = [`${data.added} assigned`];
                    if (data.already) parts.push(`${data.already} already on shift`);
                    if (data.errors) parts.push(`${data.errors} errored`);
                    setSuccess(parts.join(", "));
                    setSelectedVolIds(new Set());
                    setBulkAssignShiftId("");
                    loadData();
                  } else {
                    const data = await res.json();
                    setError(data.error || "Bulk assign failed.");
                  }
                }}
                className="bg-green-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-green-700 disabled:opacity-50"
              >
                Assign to Shift
              </button>
              <span className="text-gray-300 text-sm">|</span>
              <button
                onClick={async () => {
                  const names = Array.from(selectedVolIds)
                    .map((id) => volunteers.find((v: Volunteer) => v.id === id)?.name)
                    .filter(Boolean)
                    .join(", ");
                  if (!confirm(`Permanently delete ${selectedVolIds.size} volunteer${selectedVolIds.size !== 1 ? "s" : ""}?\n\n${names}\n\nAll their assignments, pair requests, and team memberships will be removed. This cannot be undone.`)) return;
                  clearMessages();
                  let deleted = 0;
                  let failed = 0;
                  for (const id of Array.from(selectedVolIds)) {
                    const res = await fetch("/api/volunteers", {
                      method: "DELETE",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ id }),
                    });
                    if (res.ok) deleted++;
                    else failed++;
                  }
                  setSelectedVolIds(new Set());
                  if (failed === 0) setSuccess(`${deleted} volunteer${deleted !== 1 ? "s" : ""} deleted.`);
                  else setError(`${deleted} deleted, ${failed} failed.`);
                  loadData();
                }}
                className="bg-red-100 text-red-700 px-3 py-1.5 rounded text-sm font-medium hover:bg-red-200"
              >
                🗑 Delete Selected
              </button>
              <button
                onClick={() => setSelectedVolIds(new Set())}
                className="text-gray-600 hover:text-gray-800 text-sm"
              >
                Clear
              </button>
            </div>
          )}

          {showVolunteerForm && (
            <form onSubmit={handleCreateVolunteer} className="bg-white rounded-xl border border-amber-200 p-6 mb-6 space-y-4">
              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                  <input value={volName} onChange={(e) => setVolName(e.target.value)} className={inputClass} required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone *</label>
                  <input type="tel" value={volPhone} onChange={(e) => setVolPhone(fmtPhoneInput(e.target.value))} className={inputClass} required placeholder="555-123-4567" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email <span className="text-gray-400 font-normal">(optional)</span></label>
                  <input type="email" value={volEmail} onChange={(e) => setVolEmail(e.target.value)} className={inputClass} />
                </div>
              </div>
              <button type="submit" className={btnPrimary}>Add Volunteer</button>
            </form>
          )}

          {/* Post-create assignment panel */}
          {newlyCreatedVol && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-5 mb-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-green-600 text-lg">✅</span>
                <span className="font-semibold text-green-900">{newlyCreatedVol.name} added!</span>
                <span className="text-sm text-gray-500 ml-1">— assign them now? <span className="text-gray-400">(optional)</span></span>
              </div>
              <div className="flex flex-wrap gap-3 mb-4">
                <label className={`flex items-center gap-2 cursor-pointer px-4 py-2 rounded-lg border-2 transition-colors text-sm font-medium ${postCreateMode === "team" ? "border-amber-500 bg-amber-50 text-amber-800" : "border-gray-200 bg-white text-gray-700"}`}>
                  <input type="radio" name="postCreate" value="team" checked={postCreateMode === "team"}
                    onChange={() => { setPostCreateMode("team"); setPostCreatePairWithId(""); }}
                    className="accent-amber-600" />
                  👥 Add to a Team
                </label>
                <label className={`flex items-center gap-2 cursor-pointer px-4 py-2 rounded-lg border-2 transition-colors text-sm font-medium ${postCreateMode === "pair" ? "border-purple-500 bg-purple-50 text-purple-800" : "border-gray-200 bg-white text-gray-700"}`}>
                  <input type="radio" name="postCreate" value="pair" checked={postCreateMode === "pair"}
                    onChange={() => { setPostCreateMode("pair"); setPostCreateTeamId(""); }}
                    className="accent-purple-600" />
                  🤝 Pair with a Volunteer
                </label>
              </div>
              {postCreateMode === "team" && (
                <select value={postCreateTeamId} onChange={(e) => setPostCreateTeamId(e.target.value)}
                  className={inputClass + " mb-4 max-w-sm"}>
                  <option value="">Select a team…</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>{t.name} (led by {t.leader.name})</option>
                  ))}
                </select>
              )}
              {postCreateMode === "pair" && (
                <select value={postCreatePairWithId} onChange={(e) => setPostCreatePairWithId(e.target.value)}
                  className={inputClass + " mb-4 max-w-sm"}>
                  <option value="">Select a volunteer to pair with…</option>
                  {volunteers.filter((v: Volunteer) => v.id !== newlyCreatedVol.id).map((v: Volunteer) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              )}
              <div className="flex gap-3">
                {postCreateMode !== "none" && (postCreateTeamId || postCreatePairWithId) && (
                  <button onClick={handlePostCreateAssign} className={btnPrimary}>
                    Confirm Assignment
                  </button>
                )}
                <button
                  onClick={() => { setNewlyCreatedVol(null); setPostCreateMode("none"); }}
                  className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors">
                  Skip
                </button>
              </div>
            </div>
          )}

          <div className="bg-white rounded-lg border border-amber-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-amber-50">
                <tr>
                  <th className="px-3 py-3 w-8">
                    <input
                      type="checkbox"
                      checked={volunteers.length > 0 && selectedVolIds.size === volunteers.length}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedVolIds(new Set(volunteers.map((v: Volunteer) => v.id)));
                        else setSelectedVolIds(new Set());
                      }}
                      className="w-4 h-4 cursor-pointer"
                      title="Select all"
                    />
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-amber-900">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-amber-900">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-amber-900 w-48 max-w-[12rem]">Email</th>
                  <th className="text-left px-4 py-3 font-medium text-amber-900 w-36 max-w-[9rem]">Phone</th>
                  <th className="text-left px-4 py-3 font-medium text-amber-900">Assignments</th>
                  <th className="text-left px-4 py-3 font-medium text-amber-900">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  // Build ordered list: teams/groups first (lead + expanded members), then standalones.
                  // Groups are legacy data (created before Teams replaced Groups UI) — both are
                  // processed here so existing group structures still collapse correctly.
                  type RichVol = Volunteer & { assignments?: Assignment[]; _teamId?: string; _memberCount?: number; _indent?: boolean };
                  const ordered: RichVol[] = [];
                  const seen = new Set<string>();

                  const processLeaderAndMembers = (leaderId: string, groupOrTeamId: string, memberIds: string[]) => {
                    const lead = volunteers.find((v: Volunteer) => v.id === leaderId) as RichVol | undefined;
                    if (!lead || seen.has(lead.id)) return;
                    // Count members excluding the leader (leader has their own row)
                    const nonLeaderIds = memberIds.filter((id) => id !== leaderId);
                    ordered.push({ ...lead, _teamId: groupOrTeamId, _memberCount: nonLeaderIds.length });
                    seen.add(lead.id);
                    for (const memberId of memberIds) {
                      if (memberId === leaderId) continue;
                      const mv = volunteers.find((v: Volunteer) => v.id === memberId) as RichVol | undefined;
                      if (!mv || seen.has(mv.id)) continue;
                      seen.add(mv.id);
                      if (expandedTeamIds.has(groupOrTeamId)) {
                        ordered.push({ ...mv, _indent: true });
                      }
                    }
                  };

                  // Teams (primary system)
                  for (const team of teams) {
                    processLeaderAndMembers(
                      team.leader.id,
                      team.id,
                      team.members.map((m: TeamMemberWithVol) => m.volunteer.id)
                    );
                  }
                  // Groups (legacy — volunteers registered via old Group system)
                  for (const grp of groups) {
                    processLeaderAndMembers(
                      grp.leader.id,
                      grp.id,
                      grp.members.map((m: VolunteerGroupMember) => m.volunteer.id)
                    );
                  }

                  for (const v of volunteers as RichVol[]) {
                    if (!seen.has(v.id)) ordered.push(v);
                  }

                  return ordered.map((v) => (
                    <tr key={v.id} className={`border-t border-amber-50 hover:bg-amber-50/50 ${selectedVolIds.has(v.id) ? "bg-amber-50/70" : ""} ${v._indent ? "bg-blue-50/30" : ""}`}>
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selectedVolIds.has(v.id)}
                          onChange={(e) => {
                            const next = new Set(selectedVolIds);
                            if (e.target.checked) next.add(v.id);
                            else next.delete(v.id);
                            setSelectedVolIds(next);
                          }}
                          className="w-4 h-4 cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3 font-medium">
                        <div className="flex items-center gap-1">
                          {v._teamId != null ? (
                            /* Team lead — show expand/collapse toggle */
                            <button
                              onClick={() => setExpandedTeamIds((prev) => {
                                const n = new Set(prev);
                                n.has(v._teamId!) ? n.delete(v._teamId!) : n.add(v._teamId!);
                                return n;
                              })}
                              className="w-4 h-4 flex items-center justify-center text-amber-600 hover:text-amber-900 flex-shrink-0 text-[10px]"
                              title={expandedTeamIds.has(v._teamId) ? "Collapse team members" : `Show ${v._memberCount} member${v._memberCount !== 1 ? "s" : ""}`}
                            >
                              {expandedTeamIds.has(v._teamId) ? "▼" : "▶"}
                            </button>
                          ) : v._indent ? (
                            /* Team member — indented tree connector */
                            <span className="pl-4 text-gray-400 text-xs flex-shrink-0">└</span>
                          ) : (
                            /* Standalone volunteer — spacer to keep alignment */
                            <span className="w-4 flex-shrink-0" />
                          )}
                          <span>{v.name}</span>
                          {v._teamId != null && !expandedTeamIds.has(v._teamId) && (v._memberCount ?? 0) > 0 && (
                            <span className="text-gray-400 text-xs ml-0.5">+{v._memberCount}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {(() => {
                          if (v.role === "team_lead") {
                            const ledTeam = teams.find((t: Team) => t.leader.id === v.id);
                            return (
                              <span className="inline-flex items-center gap-1 bg-teal-100 text-teal-800 text-xs px-2 py-0.5 rounded-full font-medium">
                                👑 Team Lead{ledTeam ? ` — ${ledTeam.name}` : ""}
                              </span>
                            );
                          }
                          const memberTeam = teams.find((t: Team) => t.members.some((m: TeamMemberWithVol) => m.volunteer.id === v.id));
                          if (memberTeam) {
                            return (
                              <span className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-full font-medium">
                                👥 {memberTeam.name} — lead: {memberTeam.leader.name}
                              </span>
                            );
                          }
                          const partnerIds = getApprovedPartnerIds(v.id);
                          if (partnerIds.length > 0) {
                            const partnerNames = partnerIds.map((pid) => volunteers.find((vol: Volunteer) => vol.id === pid)?.name || "Unknown").join(", ");
                            return (
                              <span className="inline-flex items-center gap-1 bg-purple-100 text-purple-800 text-xs px-2 py-0.5 rounded-full font-medium">
                                🔗 Partnered w/ {partnerNames}
                              </span>
                            );
                          }
                          return (
                            <span className="inline-flex items-center gap-1 bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full">
                              🙋 Individual
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-gray-600 w-48 max-w-[12rem] truncate">{v.email || "-"}</td>
                      <td className="px-4 py-3 text-gray-600 w-36 max-w-[9rem]">{v.phone ? formatPhone(v.phone) : "-"}</td>
                      <td className="px-4 py-3">
                        {(() => {
                          const assignments = v.assignments || [];
                          if (assignments.length === 0) return <span className="text-gray-400">None</span>;
                          return (
                            <div className="flex flex-wrap gap-1">
                              {assignments.map((a) => (
                                <span key={a.id} className="inline-block bg-amber-100 text-amber-800 text-xs px-2 py-0.5 rounded-full whitespace-nowrap">
                                  {a.shift?.title || "Unknown shift"}
                                </span>
                              ))}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            onClick={() => setManagingAssignmentsFor(v as Volunteer & { assignments?: Assignment[] })}
                            className="bg-amber-100 text-amber-700 px-3 py-1 rounded text-xs font-medium hover:bg-amber-200"
                          >
                            Change Assignments
                          </button>
                          <button
                            onClick={async () => {
                              clearMessages();
                              const res = await fetch("/api/notifications", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ type: "reminder", volunteerId: v.id }),
                              });
                              if (res.ok) setSuccess(`Reminders sent to ${v.name}!`);
                            }}
                            className="bg-blue-100 text-blue-700 px-3 py-1 rounded text-xs font-medium hover:bg-blue-200"
                          >
                            Send Reminder
                          </button>
                          <a
                            href={`/api/export?type=volunteer&volunteerId=${v.id}&format=html`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="bg-gray-100 text-gray-700 px-3 py-1 rounded text-xs font-medium hover:bg-gray-200"
                            title="Print this volunteer's schedule"
                          >
                            🖨 Schedule
                          </a>
                          <button
                            onClick={() => handleDeleteVolunteer(v)}
                            className="bg-red-100 text-red-700 px-3 py-1 rounded text-xs font-medium hover:bg-red-200"
                            title="Permanently delete this volunteer"
                          >
                            🗑 Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
            {volunteers.length === 0 && (
              <p className="text-gray-500 text-center py-8">No volunteers yet.</p>
            )}
          </div>
        </div>
      )}

      {/* ========= APPROVALS TAB (unified timeline) ========= */}
      {activeTab === "approvals" && (() => {
        type ApprovalItem = {
          id: string;
          type: "shift" | "partner" | "team_lead";
          createdAt: string;
          render: () => React.ReactNode;
        };

        const items: ApprovalItem[] = [];

        // Shift sign-ups
        for (const pa of pendingAssignments) {
          items.push({
            id: `pa-${pa.id}`,
            type: "shift",
            createdAt: pa.createdAt,
            render: () => (
              <>
                <p className="font-medium">
                  <button
                    onClick={() => setViewingVolunteer(pa.volunteer as Volunteer & { assignments?: Assignment[] })}
                    className="text-amber-900 font-bold hover:underline"
                  >
                    {pa.volunteer.name}
                  </button>
                  {" wants to join "}
                  <span className="text-amber-900 font-bold">{pa.shift.title}</span>
                </p>
                <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-2">
                  <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded">{pa.shift.category?.name}</span>
                  <span>{fmt12(pa.shift.startTime)} – {fmt12(pa.shift.endTime)}</span>
                  <span>{new Date(pa.shift.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                </div>
              </>
            ),
          });
        }

        // Partner requests
        for (const pr of pairRequests.filter((p) => p.status === "pending")) {
          items.push({
            id: `pr-${pr.id}`,
            type: "partner",
            createdAt: pr.createdAt || new Date().toISOString(),
            render: () => (
              <>
                <p className="font-medium">
                  <span className="text-amber-900">{pr.requester.name}</span>
                  {" wants to be partnered with "}
                  <span className="text-amber-900">{pr.partner.name}</span>
                </p>
                {pr.message && <p className="text-sm text-gray-500 mt-1 italic">&quot;{pr.message}&quot;</p>}
              </>
            ),
          });
        }

        // Team lead requests
        for (const v of volunteers.filter((vol: Volunteer) => (vol as Volunteer & { pendingRole?: string }).pendingRole === "team_lead")) {
          items.push({
            id: `tl-${v.id}`,
            type: "team_lead",
            createdAt: (v as Volunteer & { createdAt?: string }).createdAt || new Date().toISOString(),
            render: () => (
              <>
                <p className="font-medium text-amber-900">
                  {v.name} <span className="font-normal text-gray-600">is requesting the Team Lead role</span>
                </p>
                <p className="text-xs text-gray-500 mt-1">{v.email || v.phone || "No contact info"}</p>
              </>
            ),
          });
        }

        // Sort oldest-first (FIFO is fairer for volunteers)
        items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

        const TYPE_META: Record<ApprovalItem["type"], { label: string; chip: string; border: string }> = {
          shift:     { label: "Shift Sign-up",       chip: "bg-blue-100 text-blue-800",       border: "border-blue-100" },
          partner:   { label: "Partner Request",     chip: "bg-purple-100 text-purple-800",   border: "border-purple-100" },
          team_lead: { label: "Team Lead Request",   chip: "bg-teal-100 text-teal-800",       border: "border-teal-100" },
        };

        const since = (iso: string): string => {
          const ms = Date.now() - new Date(iso).getTime();
          const m = Math.floor(ms / 60000);
          if (m < 1) return "just now";
          if (m < 60) return `${m}m ago`;
          const h = Math.floor(m / 60);
          if (h < 24) return `${h}h ago`;
          return `${Math.floor(h / 24)}d ago`;
        };

        const approveItem = async (item: ApprovalItem) => {
          clearMessages();
          if (item.type === "shift") {
            const pa = pendingAssignments.find((p) => `pa-${p.id}` === item.id);
            if (!pa) return;
            const res = await fetch("/api/assignments", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ assignmentId: pa.id, status: "confirmed" }),
            });
            if (res.ok) {
              // Auto-add approved partners
              const partnerIds = getApprovedPartnerIds(pa.volunteer.id);
              const auto: string[] = [];
              for (const pid of partnerIds) {
                const onShift = shifts.find((s) => s.id === pa.shift.id)?.assignments.some((a) => a.volunteerId === pid);
                if (!onShift) {
                  const pr = await fetch("/api/assignments", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ volunteerId: pid, shiftId: pa.shift.id, assignedBy: "admin" }),
                  });
                  if (pr.ok) {
                    const pv = volunteers.find((v: Volunteer) => v.id === pid);
                    if (pv) auto.push(pv.name);
                  }
                }
              }
              setSuccess(`${pa.volunteer.name} approved for ${pa.shift.title}.${auto.length ? ` Partner${auto.length > 1 ? "s" : ""}: ${auto.join(", ")}.` : ""}`);
              loadData();
            }
          } else if (item.type === "partner") {
            const id = item.id.replace("pr-", "");
            await handlePairAction(id, "approved");
          } else if (item.type === "team_lead") {
            const id = item.id.replace("tl-", "");
            const v = volunteers.find((vol: Volunteer) => vol.id === id);
            await fetch("/api/volunteers", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, approvePendingRole: "team_lead" }) });
            setSuccess(`${v?.name || "Volunteer"} is now a Team Lead!`);
            loadData();
          }
        };

        const denyItem = async (item: ApprovalItem) => {
          clearMessages();
          if (item.type === "shift") {
            const pa = pendingAssignments.find((p) => `pa-${p.id}` === item.id);
            if (!pa) return;
            await fetch("/api/assignments", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ assignmentId: pa.id, status: "denied" }),
            });
            setSuccess(`${pa.volunteer.name} denied for ${pa.shift.title}.`);
            loadData();
          } else if (item.type === "partner") {
            await handlePairAction(item.id.replace("pr-", ""), "denied");
          } else if (item.type === "team_lead") {
            const id = item.id.replace("tl-", "");
            const v = volunteers.find((vol: Volunteer) => vol.id === id);
            await fetch("/api/volunteers", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, denyPendingRole: "team_lead" }) });
            setSuccess(`${v?.name || "Volunteer"}'s Team Lead request denied.`);
            loadData();
          }
        };

        return (
          <div>
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="text-xl font-bold text-amber-900">Approvals</h2>
              <p className="text-sm text-gray-500">
                {items.length === 0 ? "All caught up" : `${items.length} pending`}
                {" • "}
                <span className="text-green-700">simple shift sign-ups auto-approve via triage</span>
              </p>
            </div>
            {items.length === 0 ? (
              <div className="bg-white rounded-lg border border-amber-100 p-12 text-center">
                <p className="text-4xl mb-2">✅</p>
                <p className="text-gray-600">No pending approvals.</p>
                <p className="text-xs text-gray-400 mt-1">The triage agent handles routine shift sign-ups automatically.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {items.map((item) => {
                  const meta = TYPE_META[item.type];
                  return (
                    <div key={item.id} className={`bg-white rounded-lg border ${meta.border} p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${meta.chip}`}>
                            {meta.label}
                          </span>
                          <span className="text-xs text-gray-400">{since(item.createdAt)}</span>
                        </div>
                        {item.render()}
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button onClick={() => approveItem(item)} className="bg-green-100 text-green-700 px-4 py-2 rounded text-sm font-medium hover:bg-green-200">Approve</button>
                        <button onClick={() => denyItem(item)} className={btnDanger + " px-4 py-2"}>Deny</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* ========= VOLUNTEER DETAIL MODAL ========= */}
      {viewingVolunteer && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setViewingVolunteer(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-xl font-bold text-amber-900">{viewingVolunteer.name}</h3>
              <button onClick={() => setViewingVolunteer(null)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-gray-500 w-16">Email:</span>
                <span className="font-medium">{viewingVolunteer.email || "—"}</span>
                {viewingVolunteer.email && (
                  <a href={`mailto:${viewingVolunteer.email}`} className="text-blue-600 hover:underline text-xs">Send</a>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500 w-16">Phone:</span>
                <span className="font-medium">{viewingVolunteer.phone || "—"}</span>
                {viewingVolunteer.phone && (
                  <a href={`tel:${viewingVolunteer.phone}`} className="text-blue-600 hover:underline text-xs">Call</a>
                )}
              </div>
              <hr className="border-gray-200" />
              <p className="font-medium text-gray-700">Assigned Shifts:</p>
              {(() => {
                const volShifts = shifts.filter((s) =>
                  s.assignments.some((a) => a.volunteer.id === viewingVolunteer.id && a.status === "confirmed")
                );
                return volShifts.length > 0 ? (
                  <div className="space-y-1.5">
                    {volShifts.map((s) => (
                      <div key={s.id} className="bg-amber-50 border border-amber-200 rounded px-3 py-2 text-xs">
                        <span className="font-medium">{s.title}</span>
                        <span className="text-gray-500 ml-2">{fmt12(s.startTime)} – {fmt12(s.endTime)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-400 text-xs">No shifts assigned yet.</p>
                );
              })()}
            </div>
            <button onClick={() => setViewingVolunteer(null)} className="mt-5 w-full bg-gray-100 text-gray-700 py-2 rounded-lg text-sm font-medium hover:bg-gray-200">
              Close
            </button>
          </div>
        </div>
      )}

      {/* ========= MANAGE ASSIGNMENTS MODAL ========= */}
      {managingAssignmentsFor && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setManagingAssignmentsFor(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-xl font-bold text-amber-900">Assignments for {managingAssignmentsFor.name}</h3>
              <button onClick={() => setManagingAssignmentsFor(null)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>

            {/* Current assignments */}
            <div className="mb-5">
              <p className="font-medium text-gray-700 text-sm mb-2">Current Assignments</p>
              {(managingAssignmentsFor.assignments && managingAssignmentsFor.assignments.length > 0) ? (
                <div className="space-y-2">
                  {managingAssignmentsFor.assignments.map((a) => (
                    <div key={a.id} className="flex items-center justify-between bg-green-50 border border-green-200 rounded px-3 py-2 text-sm">
                      <span className="font-medium text-green-900">{a.shift?.title || "Unknown shift"}</span>
                      <button
                        onClick={async () => {
                          await fetch("/api/assignments", {
                            method: "DELETE",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ assignmentId: a.id }),
                          });
                          await loadData();
                          // Refresh the volunteer data for the modal
                          const res = await fetch("/api/volunteers");
                          const vols = await res.json();
                          const updated = vols.find((vol: Volunteer) => vol.id === managingAssignmentsFor.id);
                          if (updated) setManagingAssignmentsFor(updated);
                        }}
                        className="text-red-600 hover:text-red-800 text-xs font-medium px-2 py-0.5 bg-red-50 border border-red-200 rounded hover:bg-red-100"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-400 text-xs">No current assignments.</p>
              )}
            </div>

            {/* Available shifts to assign */}
            <div>
              <p className="font-medium text-gray-700 text-sm mb-2">Available Shifts</p>
              {(() => {
                const assignedShiftIds = new Set((managingAssignmentsFor.assignments || []).map((a) => a.shift?.id).filter(Boolean));
                const grouped = categories.reduce<Record<string, { category: Category; shifts: Shift[] }>>((acc, cat) => {
                  const catShifts = shifts.filter((s) => s.categoryId === cat.id && !assignedShiftIds.has(s.id) && s.assignments.length < s.capacity);
                  if (catShifts.length > 0) acc[cat.id] = { category: cat, shifts: catShifts };
                  return acc;
                }, {});
                const groups = Object.values(grouped);
                if (groups.length === 0) return <p className="text-gray-400 text-xs">No available shifts.</p>;
                return (
                  <div className="space-y-3">
                    {groups.map(({ category, shifts: catShifts }) => (
                      <div key={category.id}>
                        <p className="text-xs font-semibold text-amber-800 mb-1">{category.name}</p>
                        <div className="space-y-1">
                          {catShifts.map((s) => (
                            <div key={s.id} className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded px-3 py-2 text-sm">
                              <div>
                                <span className="font-medium">{s.title}</span>
                                <span className="text-gray-500 text-xs ml-2">{fmt12(s.startTime)} - {fmt12(s.endTime)}</span>
                                <span className="text-gray-400 text-xs ml-2">({s.assignments.length}/{s.capacity})</span>
                              </div>
                              <button
                                onClick={async () => {
                                  await fetch("/api/assignments", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ volunteerId: managingAssignmentsFor.id, shiftId: s.id, assignedBy: "admin" }),
                                  });
                                  await loadData();
                                  const res = await fetch("/api/volunteers");
                                  const vols = await res.json();
                                  const updated = vols.find((vol: Volunteer) => vol.id === managingAssignmentsFor.id);
                                  if (updated) setManagingAssignmentsFor(updated);
                                }}
                                className="text-green-600 hover:text-green-800 text-xs font-medium px-2 py-0.5 bg-green-50 border border-green-200 rounded hover:bg-green-100"
                              >
                                Assign
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            <button onClick={() => setManagingAssignmentsFor(null)} className="mt-5 w-full bg-gray-100 text-gray-700 py-2 rounded-lg text-sm font-medium hover:bg-gray-200">
              Close
            </button>
          </div>
        </div>
      )}

      {/* ========= TEAMS TAB ========= */}
      {activeTab === "teams" && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-amber-900">Manage Teams</h2>
            <button onClick={() => { setShowTeamForm(!showTeamForm); setEditingTeamId(null); setTeamName(""); setTeamLeaderId(""); setTeamNewMembers([{ name: "" }]); }} className={btnPrimary}>
              {showTeamForm ? "Cancel" : "+ Create Team"}
            </button>
          </div>

          {/* Create / Edit Team Form */}
          {showTeamForm && (
            <div className="bg-white rounded-xl border border-teal-200 p-6 mb-6 space-y-4">
              <h3 className="font-bold text-teal-900">{editingTeamId ? "Edit Team" : "Create New Team"}</h3>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Team Name *</label>
                  <input value={teamName} onChange={(e) => setTeamName(e.target.value)} className={inputClass} placeholder="e.g., Smith Family Crew" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Team Lead *</label>
                  <select value={teamLeaderId} onChange={(e) => setTeamLeaderId(e.target.value)} className={inputClass}>
                    <option value="">Select a team lead...</option>
                    {volunteers.filter((v: Volunteer) => v.role === "team_lead").map((v: Volunteer) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                    <option disabled>──────────</option>
                    {volunteers.filter((v: Volunteer) => v.role !== "team_lead").map((v: Volunteer) => (
                      <option key={v.id} value={v.id}>{v.name} (not yet a team lead)</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Team Members</label>
                {teamNewMembers.map((m, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <input
                      value={m.name}
                      onChange={(e) => { const updated = [...teamNewMembers]; updated[i] = { name: e.target.value }; setTeamNewMembers(updated); }}
                      className={inputClass + " flex-1"}
                      placeholder={`Member ${i + 1} name`}
                    />
                    {teamNewMembers.length > 1 && (
                      <button onClick={() => setTeamNewMembers(teamNewMembers.filter((_, j) => j !== i))} className="text-red-500 hover:text-red-700 text-sm px-2">Remove</button>
                    )}
                  </div>
                ))}
                <button onClick={() => setTeamNewMembers([...teamNewMembers, { name: "" }])} className="text-teal-700 text-sm font-medium hover:text-teal-900">+ Add Another Member</button>
              </div>

              <button
                onClick={async () => {
                  if (!teamName || !teamLeaderId) { setError("Team name and leader required."); return; }
                  clearMessages();

                  // Auto-promote to team_lead if not already
                  const leader = volunteers.find((v: Volunteer) => v.id === teamLeaderId);
                  if (leader && leader.role !== "team_lead") {
                    await fetch("/api/volunteers", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: teamLeaderId, role: "team_lead" }) });
                  }

                  if (editingTeamId) {
                    // Update existing team
                    const validMembers = teamNewMembers.filter((m) => m.name.trim());
                    await fetch("/api/teams", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ id: editingTeamId, name: teamName, addMembers: validMembers }),
                    });
                    setSuccess("Team updated!");
                  } else {
                    // Create new team
                    const validMembers = teamNewMembers.filter((m) => m.name.trim());
                    const res = await fetch("/api/teams", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ name: teamName, leaderId: teamLeaderId, memberNames: validMembers }),
                    });
                    if (res.ok) setSuccess("Team created!");
                    else { const d = await res.json(); setError(d.error || "Failed to create team."); }
                  }

                  setShowTeamForm(false);
                  setEditingTeamId(null);
                  setTeamName("");
                  setTeamLeaderId("");
                  setTeamNewMembers([{ name: "" }]);
                  loadData();
                }}
                className="bg-teal-700 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-teal-800"
              >
                {editingTeamId ? "Update Team" : "Create Team"}
              </button>
            </div>
          )}

          {/* Teams List */}
          <div className="space-y-4">
            {teams.length === 0 && <p className="text-gray-500 text-center py-8">No teams yet. Create one or have a Team Lead create one from the volunteer portal.</p>}
            {teams.map((team) => (
              <div key={team.id} className="bg-white rounded-xl border border-teal-100 p-5 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-lg">👥</span>
                      <h3 className="font-bold text-lg text-teal-900">{team.name}</h3>
                      <span className="text-xs bg-teal-100 text-teal-800 px-2 py-0.5 rounded-full">{team.members.length} members</span>
                    </div>
                    <p className="text-sm text-gray-600 mt-1">Led by <strong>{team.leader.name}</strong> ({team.leader.email || team.leader.phone || "no contact"})</p>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => {
                        setEditingTeamId(team.id);
                        setTeamName(team.name);
                        setTeamLeaderId(team.leader.id);
                        setTeamNewMembers([{ name: "" }]);
                        setShowTeamForm(true);
                      }}
                      className="bg-teal-100 text-teal-700 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-teal-200"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setAssigningTeamId(assigningTeamId === team.id ? null : team.id)}
                      className="bg-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-amber-700"
                    >
                      Assign Team
                    </button>
                    <button
                      onClick={async () => {
                        if (!confirm(`Delete team "${team.name}"? Members will remain as volunteers.`)) return;
                        await fetch("/api/teams", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: team.id }) });
                        loadData();
                      }}
                      className="bg-red-100 text-red-700 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-200"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {/* Assign Team Panel */}
                {assigningTeamId === team.id && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                    <h4 className="font-medium text-amber-900 mb-3">Assign Team to:</h4>
                    <div className="flex gap-2 mb-3">
                      <button onClick={() => setTeamAssignMode("shift")} className={`px-3 py-1 rounded text-xs font-medium ${teamAssignMode === "shift" ? "bg-amber-700 text-white" : "bg-white text-amber-700 border border-amber-300"}`}>Specific Shift</button>
                      <button onClick={() => setTeamAssignMode("category")} className={`px-3 py-1 rounded text-xs font-medium ${teamAssignMode === "category" ? "bg-amber-700 text-white" : "bg-white text-amber-700 border border-amber-300"}`}>Fill Category</button>
                    </div>
                    {teamAssignMode === "shift" ? (
                      <select value={teamAssignTargetId} onChange={(e) => setTeamAssignTargetId(e.target.value)} className={inputClass + " mb-3"}>
                        <option value="">Select shift...</option>
                        {shifts.map((s: Shift) => (
                          <option key={s.id} value={s.id}>{s.title} ({s.startTime} - {s.endTime})</option>
                        ))}
                      </select>
                    ) : (
                      <select value={teamAssignTargetId} onChange={(e) => setTeamAssignTargetId(e.target.value)} className={inputClass + " mb-3"}>
                        <option value="">Select category...</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    )}
                    <button
                      onClick={async () => {
                        if (!teamAssignTargetId) { setError("Please select a target."); return; }
                        clearMessages();
                        const body: Record<string, string> = { id: team.id };
                        if (teamAssignMode === "shift") body.assignShiftId = teamAssignTargetId;
                        else body.assignCategoryId = teamAssignTargetId;
                        const res = await fetch("/api/teams", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
                        if (res.ok) { setSuccess(`Team "${team.name}" assigned successfully!`); setAssigningTeamId(null); setTeamAssignTargetId(""); loadData(); }
                        else { const d = await res.json(); setError(d.error || "Assignment failed."); }
                      }}
                      className="bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-800"
                    >
                      Assign All {team.members.length} Members
                    </button>
                  </div>
                )}

                {/* Member List */}
                <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {team.members.map((tm) => {
                    const isLeader = tm.volunteer.id === team.leader.id;
                    const assignments = (tm.volunteer as Volunteer & { assignments?: Assignment[] }).assignments || [];
                    return (
                      <div key={tm.id} className={`rounded-lg p-3 text-sm ${isLeader ? "bg-teal-50 border border-teal-200" : "bg-gray-50 border border-gray-200"}`}>
                        <div className="flex items-center gap-1 font-medium">
                          {isLeader && <span className="text-teal-600 text-xs font-bold" title="Team Lead">TL</span>}
                          {tm.volunteer.name}
                        </div>
                        {assignments.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {assignments.map((a: Assignment) => (
                              <span key={a.id} className="bg-amber-100 text-amber-800 text-xs px-1.5 py-0.5 rounded">{a.shift?.title}</span>
                            ))}
                          </div>
                        )}
                        {!isLeader && (
                          <button
                            onClick={async () => {
                              await fetch("/api/teams", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: team.id, removeMembers: [tm.volunteer.id] }) });
                              loadData();
                            }}
                            className="text-red-500 text-xs mt-1 hover:text-red-700"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ========= NOTIFICATIONS TAB ========= */}
      {activeTab === "notifications" && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-amber-900">Notifications</h2>
            <button onClick={() => setShowBroadcast(!showBroadcast)} className={btnPrimary}>
              {showBroadcast ? "Cancel" : "Broadcast Message"}
            </button>
          </div>

          {showBroadcast && (
            <div className="bg-white rounded-xl border border-amber-200 p-6 mb-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Message to all volunteers</label>
                <textarea
                  value={broadcastMessage}
                  onChange={(e) => setBroadcastMessage(e.target.value)}
                  className={inputClass}
                  rows={4}
                  placeholder="Important update about the festival..."
                />
              </div>
              <button onClick={handleBroadcast} className={btnPrimary}>Send to All Volunteers</button>
            </div>
          )}

          <div className="bg-white rounded-lg border border-amber-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-amber-50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-amber-900">Type</th>
                  <th className="text-left px-4 py-3 font-medium text-amber-900">Recipient</th>
                  <th className="text-left px-4 py-3 font-medium text-amber-900">Subject</th>
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
                    <td className="px-4 py-3">{n.recipient}</td>
                    <td className="px-4 py-3 text-gray-600 max-w-xs truncate">{n.subject || n.message.substring(0, 50)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        n.status === "sent" ? "bg-green-100 text-green-700" :
                        n.status === "failed" ? "bg-red-100 text-red-700" :
                        "bg-yellow-100 text-yellow-700"
                      }`}>
                        {n.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
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

      {/* ========= SETTINGS TAB ========= */}
      {activeTab === "settings" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-amber-900">Festival Settings</h2>
            <button onClick={handleSaveSettings} className={btnPrimary}>Save Settings</button>
          </div>
          <div className="bg-white rounded-xl border border-amber-200 p-6 space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Festival Name</label>
                <input value={settings.festivalName} onChange={(e) => setSettings({ ...settings, festivalName: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Festival Date</label>
                <input value={settings.festivalDate} onChange={(e) => setSettings({ ...settings, festivalDate: e.target.value })} className={inputClass} placeholder="October 18, 2026" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Festival Time</label>
                <input value={settings.festivalTime} onChange={(e) => setSettings({ ...settings, festivalTime: e.target.value })} className={inputClass} placeholder="2:00 PM - 10:00 PM" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Email</label>
                <input value={settings.contactEmail} onChange={(e) => setSettings({ ...settings, contactEmail: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Phone</label>
                <input value={settings.contactPhone} onChange={(e) => setSettings({ ...settings, contactPhone: e.target.value })} className={inputClass} />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Welcome Message</label>
              <textarea value={settings.welcomeMessage} onChange={(e) => setSettings({ ...settings, welcomeMessage: e.target.value })} className={inputClass} rows={3} placeholder="Thank you for volunteering at our festival!" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
