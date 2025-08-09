// src/ThemeToggle.jsx
import React, { useEffect, useState } from "react";

export default function ThemeToggle({ className = "" }) {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("ssTheme") || "classic"; } catch { return "classic"; }
  });

  useEffect(() => {
    const isArcade = theme === "arcade";
    document.body.classList.toggle("theme-arcade", isArcade);
    try { localStorage.setItem("ssTheme", theme); } catch {}
  }, [theme]);

  const label = theme === "arcade" ? "Arcade on" : "Arcade off";

  return (
    <button
      type="button"
      onClick={() => setTheme(theme === "arcade" ? "classic" : "arcade")}
      aria-pressed={theme === "arcade"}
      className={`btn toggle ${className}`}
      title="Toggle arcade theme"
    >
      {label}
    </button>
  );
}
