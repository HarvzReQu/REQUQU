"use client";

import { useEffect, useState } from "react";

type Mode = "light" | "dark" | "system";
const NEXT: Record<Mode, Mode> = { system: "light", light: "dark", dark: "system" };
const ICON: Record<Mode, string> = { system: "◐", light: "☀", dark: "☾" };
const LABEL: Record<Mode, string> = { system: "Follow system", light: "Light", dark: "Dark" };

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");

  // Read on mount rather than during render: the server has no localStorage, and
  // touching it during render would desync hydration.
  useEffect(() => {
    const saved = localStorage.getItem("reququ-theme") as Mode | null;
    if (saved) setMode(saved);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (mode === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", mode);
    localStorage.setItem("reququ-theme", mode);
  }, [mode]);

  return (
    <button className="icon-btn ghost" onClick={() => setMode(NEXT[mode])}
            title={`Theme: ${LABEL[mode]}`} aria-label={`Theme: ${LABEL[mode]}. Click to change.`}>
      <span aria-hidden style={{ fontSize: ".95rem" }}>{ICON[mode]}</span>
    </button>
  );
}
