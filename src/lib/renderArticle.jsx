// Renders a news-article body (plain text + tiny markup) into React nodes.
// Supported inline markup, applied safely (no dangerouslySetInnerHTML — text is
// inserted as JS strings, so no HTML injection):
//   **bold**                         → <strong>
//   [text](https://url)              → external link (new tab)
//   [[p:<uuid>|Display Name]]        → clickable player chip → onPlayer(uuid, name)
// Blank line → new paragraph; single newline → <br>.

const chipBase = {
  display: "inline-flex", alignItems: "center", padding: "1px 8px", borderRadius: 20,
  fontSize: "0.92em", fontWeight: 600, lineHeight: 1.4,
  background: "rgba(91,156,246,.16)", color: "#5b9cf6", border: "1px solid rgba(91,156,246,.4)",
  whiteSpace: "nowrap",
};
const chipButton = { ...chipBase, cursor: "pointer", font: "inherit" };
const linkStyle  = { color: "#5b9cf6", textDecoration: "underline" };

const PATTERNS = [
  { name: "player", re: /\[\[p:([^|\]]+)\|([^\]]+)\]\]/ },
  { name: "link",   re: /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/ },
  { name: "bold",   re: /\*\*([^*]+)\*\*/ },
];

function parseInline(text, onPlayer, keyBase) {
  const nodes = [];
  let rest = text;
  let k = 0;
  while (rest.length) {
    let best = null;
    for (const p of PATTERNS) {
      const m = p.re.exec(rest);
      if (m && (best === null || m.index < best.m.index)) best = { p, m };
    }
    if (!best) { nodes.push(rest); break; }
    const { p, m } = best;
    if (m.index > 0) nodes.push(rest.slice(0, m.index));
    const key = `${keyBase}-${k++}`;
    if (p.name === "player") {
      const id = m[1].trim(), label = m[2];
      nodes.push(
        onPlayer
          ? <button key={key} type="button" style={chipButton} onClick={() => onPlayer(id, label)}>{label}</button>
          : <span key={key} style={chipBase}>{label}</span>
      );
    } else if (p.name === "link") {
      nodes.push(<a key={key} href={m[2]} target="_blank" rel="noreferrer" style={linkStyle}>{m[1]}</a>);
    } else {
      nodes.push(<strong key={key}>{m[1]}</strong>);
    }
    rest = rest.slice(m.index + m[0].length);
  }
  return nodes;
}

export function renderArticleBody(text, { onPlayer } = {}) {
  if (!text) return null;
  const paragraphs = String(text).replace(/\r\n/g, "\n").split(/\n{2,}/);
  return paragraphs.map((para, pi) => {
    const lines = para.split("\n");
    const inner = [];
    lines.forEach((line, li) => {
      if (li > 0) inner.push(<br key={`br-${pi}-${li}`} />);
      inner.push(...parseInline(line, onPlayer, `p${pi}l${li}`));
    });
    return <p key={`para-${pi}`} style={{ margin: "0 0 12px", lineHeight: 1.6 }}>{inner}</p>;
  });
}
