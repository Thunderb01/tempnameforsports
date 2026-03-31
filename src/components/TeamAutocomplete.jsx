import { useState, useRef, useEffect } from "react";

export function TeamAutocomplete({ value, onChange, teams, placeholder = "Search teams…" }) {
  const [query,    setQuery]    = useState(value || "");
  const [open,     setOpen]     = useState(false);
  const [focused,  setFocused]  = useState(false);
  const containerRef = useRef(null);

  // Keep query in sync if value changes externally
  useEffect(() => { setQuery(value || ""); }, [value]);

  // Close on outside click
  useEffect(() => {
    function onDown(e) {
      if (!containerRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const filtered = query.trim()
    ? teams.filter(t => t.toLowerCase().includes(query.trim().toLowerCase()))
    : teams;

  function select(team) {
    setQuery(team);
    setOpen(false);
    onChange(team);
  }

  function handleInput(e) {
    setQuery(e.target.value);
    setOpen(true);
    if (!e.target.value) onChange("");
  }

  function handleKeyDown(e) {
    if (e.key === "Escape") setOpen(false);
    if (e.key === "Enter" && filtered.length === 1) select(filtered[0]);
  }

  return (
    <div ref={containerRef} style={{ position: "relative", minWidth: 220 }}>
      <input
        className="input"
        type="text"
        placeholder={placeholder}
        value={query}
        onChange={handleInput}
        onFocus={() => { setFocused(true); setOpen(true); }}
        onBlur={() => setFocused(false)}
        onKeyDown={handleKeyDown}
        style={{ width: "100%" }}
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
          background: "#0e1521", border: "1px solid var(--border)", borderRadius: 8,
          maxHeight: 240, overflowY: "auto", zIndex: 300,
          boxShadow: "0 8px 24px rgba(0,0,0,.5)",
        }}>
          {filtered.map(t => (
            <div key={t}
              onMouseDown={e => { e.preventDefault(); select(t); }}
              style={{
                padding: "8px 12px", fontSize: 13, cursor: "pointer",
                background: t === value ? "rgba(91,156,246,.15)" : "transparent",
                color: t === value ? "#5b9cf6" : "inherit",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,.06)"}
              onMouseLeave={e => e.currentTarget.style.background = t === value ? "rgba(91,156,246,.15)" : "transparent"}
            >
              {t}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
