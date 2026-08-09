import { useState, useEffect } from "react";

// App-wide preference: are the raw NIL dollar valuations shown, or hidden behind
// the 2K-style Overall rating? Default HIDDEN — the Overall is the public-facing
// number; revealing dollar valuations is opt-in. Persisted in localStorage and
// synced across components via a custom event (no provider needed).

const KEY = "bp_nil_visible";
const EVT = "bp-nil-visible";

export function getNilVisible() {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

export function setNilVisible(v) {
  try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(EVT, { detail: !!v }));
}

export function useNilVisible() {
  const [visible, setVisible] = useState(getNilVisible);
  useEffect(() => {
    const sync = () => setVisible(getNilVisible());
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(EVT, sync); window.removeEventListener("storage", sync); };
  }, []);
  return [visible, () => setNilVisible(!getNilVisible())];
}
