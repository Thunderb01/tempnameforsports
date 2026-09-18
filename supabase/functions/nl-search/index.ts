// supabase/functions/nl-search/index.ts
// Natural-language → Big Board filter translation.
//
// Takes a free-text scouting query ("6'5 wing who can shoot and defend") and
// asks Claude to translate it into the *exact* filter shape BoardPage.jsx
// already uses (posFilter/yearFilter/confFilter/heightMin.../advcFilters/...).
// This function does NOT rank or select players itself — it only produces
// filter criteria, which the frontend applies through the existing,
// already-tested filtering pipeline. Keeps this cheap, fast, and safe: a bad
// interpretation just yields a bad filter the user can see and correct, not
// a hallucinated player list.
//
// Deploy:
//   supabase functions deploy nl-search
// Secret required (Project Settings → Edge Functions, or `supabase secrets set`):
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// These two lists must stay in sync with BoardPage.jsx's YEAR_OPTIONS /
// conferences constants — duplicated here (rather than imported) because
// this function is a separate Deno runtime with no access to src/.
const YEAR_OPTIONS = ["Fr", "RS Fr", "So", "RS So", "Jr", "RS Jr", "Sr", "RS Sr", "Grad", "5th Year"];
const CONFERENCES = [
  "A10", "ACC", "AE", "ASun", "Amer",
  "B10", "B12", "BE", "BSky", "BSth", "BW",
  "CAA", "CUSA",
  "Horz",
  "Ivy",
  "MAAC", "MAC", "MEAC", "MVC", "MWC",
  "NEC",
  "OVC",
  "Pat",
  "SB", "SC", "SEC", "SWAC", "Slnd", "Sum",
  "WAC", "WCC",
];
const POSITIONS = ["Guard", "Wing", "Big"];

// Mirrors BoardPage.jsx's ADVC_FIELDS keys exactly — the frontend drops this
// straight into its advcFilters state, so the keys must match verbatim.
const STAT_FIELDS: { key: string; description: string }[] = [
  { key: "sei",  description: "Scoring Efficiency — BtP composite metric, percentile scale 0-100" },
  { key: "ath",  description: "Athleticism — BtP composite metric, percentile scale 0-100" },
  { key: "ris",  description: "Rim Impact — BtP composite metric, percentile scale 0-100" },
  { key: "dds",  description: "Defending — BtP composite metric, percentile scale 0-100" },
  { key: "cdi",  description: "Playmaking — BtP composite metric, percentile scale 0-100" },
  { key: "usg",  description: "Usage rate %, roughly 10-35 for most players" },
  { key: "ppg",  description: "Points per game" },
  { key: "rpg",  description: "Rebounds per game" },
  { key: "apg",  description: "Assists per game" },
  { key: "ast_tov", description: "Assist-to-turnover ratio" },
  { key: "fg_pct",  description: "Field goal % (0-100 scale, e.g. 45.6 not 0.456)" },
  { key: "3p_pct",  description: "Three-point % (0-100 scale)" },
  { key: "ft_pct",  description: "Free throw % (0-100 scale)" },
  { key: "marketLow",  description: "NIL market value estimate, low end, in dollars" },
  { key: "marketHigh", description: "NIL market value estimate, high end, in dollars" },
];

function buildSystemPrompt(): string {
  return `You translate a college basketball recruiter's natural-language search into structured filter criteria for a roster database. You do not answer questions or describe players — you ONLY extract filter criteria that match the schema you're given.

Valid positions (use exactly these strings): ${POSITIONS.join(", ")}
Valid class years (use exactly these strings): ${YEAR_OPTIONS.join(", ")}
Valid conferences (use exactly these abbreviations, or omit if the query names a school/conference not on this list): ${CONFERENCES.join(", ")}

Filterable stats (all are optional min/max ranges — only set the ones the query actually implies):
${STAT_FIELDS.map(f => `- ${f.key}: ${f.description}`).join("\n")}

Height is filtered in inches (e.g. 6'5" = 77 inches).

Rules:
- Only set a field if the query gives real signal for it. Leave everything else null — do not invent thresholds for stats the user didn't mention.
- "shoot" / "can shoot" implies a 3p_pct minimum around 33-35, not a hard cutoff — use judgment, keep it loose (e.g. min 33).
- "defend" / "two-way" implies a dds minimum around 55-60.
- "athletic" implies an ath minimum around 55-60.
- Vague size words ("long", "tall") without a number should NOT set a height range — only set height when the query gives an actual height or clear comparative signal.
- portalOnly should only be true if the query explicitly asks about players "in the portal" / "available" / "transferring" — otherwise leave it null.
- Always fill "summary" with one short plain-English sentence describing what you interpreted, e.g. "Wings 6'5\\" and up who shoot 33%+ from three." This is shown to the user so they can verify the interpretation.`;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query } = await req.json();
    if (!query || typeof query !== "string" || !query.trim()) {
      return new Response(JSON.stringify({ error: "Missing query" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
    const { z } = await import("zod");

    const range = z.object({
      min: z.number().nullable(),
      max: z.number().nullable(),
    }).nullable();

    const statsShape: Record<string, z.ZodTypeAny> = {};
    for (const f of STAT_FIELDS) statsShape[f.key] = range;

    const FilterSchema = z.object({
      positions: z.array(z.enum(POSITIONS as [string, ...string[]])).nullable(),
      years: z.array(z.enum(YEAR_OPTIONS as [string, ...string[]])).nullable(),
      conferences: z.array(z.string()).nullable(),
      heightMinInches: z.number().nullable(),
      heightMaxInches: z.number().nullable(),
      portalOnly: z.boolean().nullable(),
      stats: z.object(statsShape),
      summary: z.string(),
    });

    const client = new Anthropic();
    const response = await client.messages.parse({
      model: "claude-opus-5",
      max_tokens: 2048,
      system: buildSystemPrompt(),
      messages: [{ role: "user", content: query }],
      output_config: { format: zodOutputFormat(FilterSchema) },
    });

    if (!response.parsed_output) {
      return new Response(JSON.stringify({ error: "Could not interpret query" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(response.parsed_output), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("nl-search error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
