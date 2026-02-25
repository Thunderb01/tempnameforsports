// player.js
export class Player {
  constructor({
    id,
    name,
    team = "",
    pos = "",
    year = "",
    marketLow = 0,
    marketHigh = 0,
    stats = {},
    tags = []
  }) {
    this.id = String(id);
    this.name = String(name);
    this.team = String(team);
    this.pos = String(pos);
    this.year = String(year);
    this.marketLow = Number(marketLow) || 0;
    this.marketHigh = Number(marketHigh) || 0;
    this.stats = stats || {};

    // tags: always store as an array of strings
    if (Array.isArray(tags)) {
      this.tags = tags.map(t => String(t).trim()).filter(Boolean);
    } else if (typeof tags === "string") {
      this.tags = tags
        .split(/[,|]/)
        .map(t => t.trim())
        .filter(Boolean);
    } else {
      this.tags = [];
    }
  }

  marketMid() {
    return Math.round((this.marketLow + this.marketHigh) / 2);
  }

  matchesQuery(q) {
    const s = (q || "").trim().toLowerCase();
    if (!s) return true;
    return (
      this.name.toLowerCase().includes(s) ||
      this.team.toLowerCase().includes(s) ||
      this.pos.toLowerCase().includes(s) ||
      this.year.toLowerCase().includes(s)
    );
  }

  static from(obj) {
    return obj instanceof Player ? obj : new Player(obj);
  }
}