import { supabase } from "./supabase";
import staticLogos from "@/data/teamLogos.json";

let _promise = null;

export function getTeamLogos() {
  if (!_promise) {
    _promise = supabase
      .from("teams")
      .select("name, espn_id")
      .not("espn_id", "is", null)
      .then(({ data, error }) => {
        if (error || !data?.length) return staticLogos;
        const dbLogos = Object.fromEntries(
          data.map(r => [
            r.name,
            `https://a.espncdn.com/i/teamlogos/ncaa/500/${r.espn_id}.png`,
          ])
        );
        // Merge: DB takes precedence, static JSON fills gaps
        return { ...staticLogos, ...dbLogos };
      })
      .catch(() => {
        _promise = null; // allow retry next time
        return staticLogos;
      });
  }
  return _promise;
}
