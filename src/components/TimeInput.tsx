"use client";

import { useState, useRef, useEffect } from "react";

interface TimeInputProps {
  value: string; // 24h format "HH:MM"
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
}

// Format 24h "HH:MM" to display "h:MM AM/PM"
function to12h(t: string): string {
  if (!t) return "";
  const [hStr, mStr] = t.split(":");
  let h = parseInt(hStr);
  const m = mStr || "00";
  if (isNaN(h)) return t;
  const ampm = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m} ${ampm}`;
}

// Parse various time formats to 24h "HH:MM"
function parseTo24h(input: string): string | null {
  const s = input.trim();
  if (!s) return null;

  // Try "H:MM AM/PM" or "HH:MM AM/PM" or "H AM/PM" or "Hpm"
  const ampmMatch = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)$/i);
  if (ampmMatch) {
    let h = parseInt(ampmMatch[1]);
    const m = ampmMatch[2] || "00";
    const isPM = /p/i.test(ampmMatch[3]);
    if (h === 12 && !isPM) h = 0;
    else if (h !== 12 && isPM) h += 12;
    if (h >= 0 && h <= 23) {
      return `${String(h).padStart(2, "0")}:${m}`;
    }
  }

  // Try "HH:MM" (24h)
  const milMatch = s.match(/^(\d{1,2}):(\d{2})$/);
  if (milMatch) {
    const h = parseInt(milMatch[1]);
    if (h >= 0 && h <= 23) {
      return `${String(h).padStart(2, "0")}:${milMatch[2]}`;
    }
  }

  // Try just a number like "2" or "14"
  const numMatch = s.match(/^(\d{1,2})$/);
  if (numMatch) {
    const h = parseInt(numMatch[1]);
    if (h >= 0 && h <= 23) {
      return `${String(h).padStart(2, "0")}:00`;
    }
  }

  return null;
}

// Generate time options in 15-min increments
function generateTimeOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const val = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      options.push({ value: val, label: to12h(val) });
    }
  }
  return options;
}

const TIME_OPTIONS = generateTimeOptions();

export default function TimeInput({ value, onChange, className = "", placeholder }: TimeInputProps) {
  const [open, setOpen] = useState(false);
  const [inputText, setInputText] = useState(to12h(value));
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync display when value prop changes externally
  useEffect(() => {
    if (!inputRef.current || inputRef.current !== document.activeElement) {
      setInputText(to12h(value));
    }
  }, [value]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Scroll to closest time when dropdown opens — default to 12:00 PM if no value
  useEffect(() => {
    if (open && listRef.current) {
      const target = value || "12:00"; // Default to 12:00 PM (noon)
      const idx = TIME_OPTIONS.findIndex((o) => o.value >= target);
      if (idx >= 0) {
        const el = listRef.current.children[idx] as HTMLElement;
        if (el) el.scrollIntoView({ block: "center" });
        setHighlightedIndex(idx);
      }
    }
  }, [open, value]);

  const handleInputChange = (text: string) => {
    setInputText(text);
    // Try to parse as they type
    const parsed = parseTo24h(text);
    if (parsed) {
      onChange(parsed);
      // Scroll dropdown to match
      const idx = TIME_OPTIONS.findIndex((o) => o.value >= parsed);
      setHighlightedIndex(idx >= 0 ? idx : -1);
    }
  };

  const handleBlur = () => {
    // On blur, try to finalize the typed value
    const parsed = parseTo24h(inputText);
    if (parsed) {
      onChange(parsed);
      setInputText(to12h(parsed));
    } else if (value) {
      // Revert to last valid value
      setInputText(to12h(value));
    }
    // Small delay so click on dropdown option registers first
    setTimeout(() => setOpen(false), 150);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlightedIndex((prev) => Math.min(prev + 1, TIME_OPTIONS.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setHighlightedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && highlightedIndex >= 0) {
        const opt = TIME_OPTIONS[highlightedIndex];
        onChange(opt.value);
        setInputText(opt.label);
        setOpen(false);
      } else {
        const parsed = parseTo24h(inputText);
        if (parsed) {
          onChange(parsed);
          setInputText(to12h(parsed));
        }
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const selectOption = (opt: { value: string; label: string }) => {
    onChange(opt.value);
    setInputText(opt.label);
    setOpen(false);
  };

  // Scroll highlighted item into view
  useEffect(() => {
    if (open && listRef.current && highlightedIndex >= 0) {
      const el = listRef.current.children[highlightedIndex] as HTMLElement;
      if (el) el.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex, open]);

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={inputText}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || "e.g. 2:00 PM"}
          className={className || "w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none text-sm"}
          autoComplete="off"
        />
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={(e) => { e.preventDefault(); setOpen(!open); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </button>
      </div>

      {open && (
        <div
          ref={listRef}
          className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg"
        >
          {TIME_OPTIONS.map((opt, i) => (
            <div
              key={opt.value}
              onMouseDown={(e) => { e.preventDefault(); selectOption(opt); }}
              className={`px-3 py-1.5 text-sm cursor-pointer transition-colors ${
                opt.value === value
                  ? "bg-amber-100 text-amber-900 font-medium"
                  : highlightedIndex === i
                  ? "bg-amber-50 text-amber-800"
                  : "text-gray-700 hover:bg-gray-50"
              }`}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
