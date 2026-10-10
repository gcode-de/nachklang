"use client";
import { useEffect, useState } from "react";
export default function ThemeToggle() {
  const [theme, setTheme] = useState("dark");
  useEffect(() => {
    try {
      const stored = localStorage.getItem("nachklang-theme");
      if (stored === "light") {
        setTheme(stored);
        document.documentElement.dataset.theme = stored;
      }
    } catch {
      /* Theme still works when browser storage is unavailable. */
    }
  }, []);
  return (
    <button
      className="theme-toggle secondary"
      aria-label={
        theme === "dark"
          ? "Hellen Modus aktivieren"
          : "Dunklen Modus aktivieren"
      }
      onClick={() => {
        const next = theme === "dark" ? "light" : "dark";
        setTheme(next);
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem("nachklang-theme", next);
        } catch {}
      }}
    >
      {theme === "dark" ? "☀ Hell" : "◐ Dunkel"}
    </button>
  );
}
