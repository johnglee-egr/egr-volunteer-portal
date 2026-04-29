"use client";

import { useEffect, useState } from "react";

interface ShiftData {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  capacity: number;
  category?: { name: string };
  assignments: { id: string }[];
}

export default function Home() {
  const [shifts, setShifts] = useState<ShiftData[]>([]);
  const [settings, setSettings] = useState<{
    festivalName?: string;
    festivalDate?: string;
    festivalTime?: string;
    welcomeMessage?: string;
  }>({});

  useEffect(() => {
    fetch("/api/shifts").then((r) => r.json()).then(setShifts);
    fetch("/api/settings").then((r) => r.json()).then(setSettings);
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Hero */}
      <div className="text-center mb-12">
        <h1 className="text-5xl font-bold text-amber-900 mb-4">
          {settings.festivalName || "Harvest Beer Festival"}
        </h1>
        <p className="text-xl text-amber-700 mb-2">Volunteer Management Portal</p>
        {settings.festivalDate && (
          <p className="text-lg text-gray-600">{settings.festivalDate} {settings.festivalTime && `at ${settings.festivalTime}`}</p>
        )}
        {settings.welcomeMessage && (
          <p className="mt-4 text-gray-700 max-w-2xl mx-auto">{settings.welcomeMessage}</p>
        )}
      </div>

      {/* Quick Actions */}
      <div className="grid md:grid-cols-2 gap-6 mb-12">
        <a
          href="/volunteer"
          className="block p-8 bg-white rounded-xl shadow-md border-2 border-amber-200 hover:border-amber-400 hover:shadow-lg transition-all"
        >
          <h2 className="text-2xl font-bold text-amber-800 mb-2">Volunteer Portal</h2>
          <p className="text-gray-600">
            Sign up for shifts, view your schedule, request to work with a friend, or manage your assignments.
          </p>
        </a>
        <a
          href="/admin"
          className="block p-8 bg-white rounded-xl shadow-md border-2 border-amber-200 hover:border-amber-400 hover:shadow-lg transition-all"
        >
          <h2 className="text-2xl font-bold text-amber-800 mb-2">Admin Dashboard</h2>
          <p className="text-gray-600">
            Manage shifts, assign volunteers, send reminders, and configure festival settings.
          </p>
        </a>
      </div>

      {/* Available Shifts */}
      <section className="mb-12">
        <h2 className="text-3xl font-bold text-amber-900 mb-6">Available Shifts</h2>
        {shifts.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No shifts have been created yet. Check back soon!</p>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {shifts.map((shift) => {
              const filled = shift.assignments.length;
              const available = shift.capacity - filled;
              return (
                <div
                  key={shift.id}
                  className="bg-white rounded-lg shadow-sm border border-amber-100 p-5"
                >
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-lg text-amber-900">{shift.title}</h3>
                    {shift.category && <span className="bg-amber-200 text-amber-900 px-2 py-0.5 rounded-full text-xs font-medium">{shift.category.name}</span>}
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    {new Date(shift.date).toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                  <p className="text-sm text-gray-600">
                    {shift.startTime} - {shift.endTime}
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <div
                      className={`text-sm font-medium px-2 py-1 rounded ${
                        available > 0
                          ? "bg-green-100 text-green-800"
                          : "bg-red-100 text-red-800"
                      }`}
                    >
                      {available > 0 ? `${available} spot${available !== 1 ? "s" : ""} open` : "Full"}
                    </div>
                    <span className="text-xs text-gray-400">
                      {filled}/{shift.capacity} filled
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

    </div>
  );
}
