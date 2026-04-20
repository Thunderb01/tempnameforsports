import { useState, useEffect } from "react";
import { getTeamLogos } from "@/lib/teamLogos";
import staticLogos from "@/data/teamLogos.json";

export function useTeamLogos() {
  const [logos, setLogos] = useState(staticLogos);
  useEffect(() => { getTeamLogos().then(setLogos); }, []);
  return logos;
}
