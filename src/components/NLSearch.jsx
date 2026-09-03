import { useState } from "react";
import { supabase } from "@/lib/supabase";

// Natural-language search bar for the Big Board. Sends free text to the
// nl-search Supabase Edge Function, which translates it into the same filter
// shape BoardPage.jsx's own controls use, then hands the parsed result back
// via onApply — this component never touches player data or ranking itself.
export function NLSearch({ onApply }) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!query.trim() || loading) return;
    setLoading(true);
    setError("");
    try {
      const { data, error: fnError } = await supabase.functions.invoke("nl-search", {
        body: { query: query.trim() },
      });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      onApply(data);
      setSummary(data.summary || "Filters applied.");
    } catch (err) {
      console.error("nl-search failed:", err);
      setError("Couldn't interpret that — try rephrasing, or use the filters below directly.");
      setSummary("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      background: "var(--panel)", border: "1px solid var(--border)",
      borderRadius: 10, padding: "14px 20px", marginBottom: 14,
    }}>
      <form onSubmit={submit} style={{ display: "flex", gap: 8 }}>
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder={`Describe who you're looking for… e.g. "6'5" wing who can shoot and defend"`}
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={loading || !query.trim()}>
          {loading ? "Thinking…" : "Ask AI"}
        </button>
      </form>
      {summary && !error && (
        <div style={{
          marginTop: 10, fontSize: 12, color: "#5b9cf6",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <span style={{ opacity: .8 }}>✦ {summary}</span>
          <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "1px 8px" }}
            onClick={() => setSummary("")}>
            Dismiss
          </button>
        </div>
      )}
      {error && (
        <div style={{ marginTop: 10, fontSize: 12, color: "#f87171" }}>{error}</div>
      )}
    </div>
  );
}
