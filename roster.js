// roster.js — Fetch a team's current roster from Sports Reference
// Uses allorigins.win as a CORS proxy (free, no key needed).
// Falls back gracefully if the fetch fails or the page structure changes.

// Sports Reference uses slug-based URLs like:
//   https://www.sports-reference.com/cbb/schools/rutgers/2025.html
// This map covers every D1 program. Add/fix slugs as needed.

export const TEAM_SLUGS = {
  "Abilene Christian":     "abilene-christian",
  "Air Force":             "air-force",
  "Akron":                 "akron",
  "Alabama":               "alabama",
  "Alabama A&M":           "alabama-am",
  "Alabama State":         "alabama-state",
  "Albany":                "albany-ny",
  "Alcorn State":          "alcorn-state",
  "American":              "american",
  "App State":             "appalachian-state",
  "Appalachian State":     "appalachian-state",
  "Arizona":               "arizona",
  "Arizona State":         "arizona-state",
  "Arkansas":              "arkansas",
  "Arkansas-Pine Bluff":   "arkansas-pine-bluff",
  "Arkansas State":        "arkansas-state",
  "Army":                  "army",
  "Auburn":                "auburn",
  "Austin Peay":           "austin-peay",
  "Ball State":            "ball-state",
  "Baylor":                "baylor",
  "Bellarmine":            "bellarmine",
  "Belmont":               "belmont",
  "Bethune-Cookman":       "bethune-cookman",
  "Boise State":           "boise-state",
  "Boston College":        "boston-college",
  "Boston University":     "boston-university",
  "Bowling Green":         "bowling-green",
  "Bradley":               "bradley",
  "Brown":                 "brown",
  "Bryant":                "bryant",
  "Bucknell":              "bucknell",
  "Buffalo":               "buffalo",
  "Butler":                "butler",
  "BYU":                   "brigham-young",
  "Cal Baptist":           "california-baptist",
  "Cal Poly":              "cal-poly",
  "Cal State Bakersfield": "california-state-bakersfield",
  "Cal State Fullerton":   "cal-state-fullerton",
  "Cal State Northridge":  "cal-state-northridge",
  "California":            "california",
  "Campbell":              "campbell",
  "Canisius":              "canisius",
  "Central Arkansas":      "central-arkansas",
  "Central Connecticut":   "central-connecticut",
  "Central Michigan":      "central-michigan",
  "Charleston":            "charleston",
  "Charlotte":             "charlotte",
  "Chattanooga":           "chattanooga",
  "Chicago State":         "chicago-state",
  "Cincinnati":            "cincinnati",
  "Clemson":               "clemson",
  "Cleveland State":       "cleveland-state",
  "Coastal Carolina":      "coastal-carolina",
  "Colgate":               "colgate",
  "Colorado":              "colorado",
  "Colorado State":        "colorado-state",
  "Columbia":              "columbia",
  "Connecticut":           "connecticut",
  "Coppin State":          "coppin-state",
  "Cornell":               "cornell",
  "Creighton":             "creighton",
  "Dartmouth":             "dartmouth",
  "Davidson":              "davidson",
  "Dayton":                "dayton",
  "Delaware":              "delaware",
  "Delaware State":        "delaware-state",
  "Denver":                "denver",
  "DePaul":                "depaul",
  "Detroit Mercy":         "detroit-mercy",
  "Drake":                 "drake",
  "Drexel":                "drexel",
  "Duke":                  "duke",
  "Duquesne":              "duquesne",
  "East Carolina":         "east-carolina",
  "East Tennessee State":  "east-tennessee-state",
  "Eastern Illinois":      "eastern-illinois",
  "Eastern Kentucky":      "eastern-kentucky",
  "Eastern Michigan":      "eastern-michigan",
  "Eastern Washington":    "eastern-washington",
  "Elon":                  "elon",
  "Evansville":            "evansville",
  "Fairfield":             "fairfield",
  "Fairleigh Dickinson":   "fairleigh-dickinson",
  "FIU":                   "florida-international",
  "Florida":               "florida",
  "Florida A&M":           "florida-am",
  "Florida Atlantic":      "florida-atlantic",
  "Florida Gulf Coast":    "florida-gulf-coast",
  "Florida State":         "florida-state",
  "Fordham":               "fordham",
  "Fresno State":          "fresno-state",
  "Furman":                "furman",
  "Gardner-Webb":          "gardner-webb",
  "George Mason":          "george-mason",
  "George Washington":     "george-washington",
  "Georgetown":            "georgetown",
  "Georgia":               "georgia",
  "Georgia Southern":      "georgia-southern",
  "Georgia State":         "georgia-state",
  "Georgia Tech":          "georgia-tech",
  "Gonzaga":               "gonzaga",
  "Grambling":             "grambling",
  "Grand Canyon":          "grand-canyon",
  "Green Bay":             "wisconsin-green-bay",
  "Hampton":               "hampton",
  "Hartford":              "hartford",
  "Harvard":               "harvard",
  "Hawaii":                "hawaii",
  "High Point":            "high-point",
  "Hofstra":               "hofstra",
  "Holy Cross":            "holy-cross",
  "Houston":               "houston",
  "Houston Baptist":       "houston-christian",
  "Howard":                "howard",
  "Idaho":                 "idaho",
  "Idaho State":           "idaho-state",
  "Illinois":              "illinois",
  "Illinois State":        "illinois-state",
  "Incarnate Word":        "incarnate-word",
  "Indiana":               "indiana",
  "Indiana State":         "indiana-state",
  "Iona":                  "iona",
  "Iowa":                  "iowa",
  "Iowa State":            "iowa-state",
  "IUPUI":                 "iupui",
  "Jackson State":         "jackson-state",
  "Jacksonville":          "jacksonville",
  "Jacksonville State":    "jacksonville-state",
  "James Madison":         "james-madison",
  "Kansas":                "kansas",
  "Kansas State":          "kansas-state",
  "Kennesaw State":        "kennesaw-state",
  "Kent State":            "kent-state",
  "Kentucky":              "kentucky",
  "La Salle":              "la-salle",
  "Lafayette":             "lafayette",
  "Lamar":                 "lamar",
  "Lehigh":                "lehigh",
  "Liberty":               "liberty",
  "Lindenwood":            "lindenwood",
  "Lipscomb":              "lipscomb",
  "Little Rock":           "little-rock",
  "Long Beach State":      "long-beach-state",
  "Long Island":           "long-island-university",
  "Longwood":              "longwood",
  "Louisiana":             "louisiana-lafayette",
  "Louisiana Tech":        "louisiana-tech",
  "Louisville":            "louisville",
  "Loyola Chicago":        "loyola-il",
  "Loyola Maryland":       "loyola-md",
  "Loyola Marymount":      "loyola-marymount",
  "LSU":                   "lsu",
  "Maine":                 "maine",
  "Manhattan":             "manhattan",
  "Marist":                "marist",
  "Marquette":             "marquette",
  "Marshall":              "marshall",
  "Maryland":              "maryland",
  "Maryland-Eastern Shore":"maryland-eastern-shore",
  "Massachusetts":         "massachusetts",
  "McNeese":               "mcneese-state",
  "Memphis":               "memphis",
  "Mercer":                "mercer",
  "Miami":                 "miami-fl",
  "Miami (OH)":            "miami-oh",
  "Michigan":              "michigan",
  "Michigan State":        "michigan-state",
  "Middle Tennessee":      "middle-tennessee",
  "Milwaukee":             "wisconsin-milwaukee",
  "Minnesota":             "minnesota",
  "Mississippi State":     "mississippi-state",
  "Mississippi Valley State": "mississippi-valley-state",
  "Missouri":              "missouri",
  "Missouri State":        "missouri-state",
  "Monmouth":              "monmouth",
  "Montana":               "montana",
  "Montana State":         "montana-state",
  "Morehead State":        "morehead-state",
  "Morgan State":          "morgan-state",
  "Mount St. Mary's":      "mount-st-marys",
  "Murray State":          "murray-state",
  "Navy":                  "navy",
  "Nebraska":              "nebraska",
  "Nevada":                "nevada",
  "New Hampshire":         "new-hampshire",
  "New Mexico":            "new-mexico",
  "New Mexico State":      "new-mexico-state",
  "New Orleans":           "new-orleans",
  "Niagara":               "niagara",
  "Nicholls":              "nicholls-state",
  "NJIT":                  "njit",
  "Norfolk State":         "norfolk-state",
  "North Alabama":         "north-alabama",
  "North Carolina":        "north-carolina",
  "North Carolina A&T":    "north-carolina-at",
  "North Carolina Central":"north-carolina-central",
  "North Carolina State":  "north-carolina-state",
  "NC State":              "north-carolina-state",
  "North Dakota":          "north-dakota",
  "North Dakota State":    "north-dakota-state",
  "North Florida":         "north-florida",
  "North Texas":           "north-texas",
  "Northeastern":          "northeastern",
  "Northern Arizona":      "northern-arizona",
  "Northern Colorado":     "northern-colorado",
  "Northern Illinois":     "northern-illinois",
  "Northern Iowa":         "northern-iowa",
  "Northern Kentucky":     "northern-kentucky",
  "Northwestern":          "northwestern",
  "Northwestern State":    "northwestern-state",
  "Notre Dame":            "notre-dame",
  "Oakland":               "oakland",
  "Ohio":                  "ohio",
  "Ohio State":            "ohio-state",
  "Oklahoma":              "oklahoma",
  "Oklahoma State":        "oklahoma-state",
  "Old Dominion":          "old-dominion",
  "Ole Miss":              "mississippi",
  "Omaha":                 "nebraska-omaha",
  "Oregon":                "oregon",
  "Oregon State":          "oregon-state",
  "Pacific":               "pacific",
  "Penn":                  "pennsylvania",
  "Penn State":            "penn-state",
  "Pepperdine":            "pepperdine",
  "Pittsburgh":            "pittsburgh",
  "Portland":              "portland",
  "Portland State":        "portland-state",
  "Prairie View A&M":      "prairie-view",
  "Presbyterian":          "presbyterian",
  "Princeton":             "princeton",
  "Providence":            "providence",
  "Purdue":                "purdue",
  "Purdue Fort Wayne":     "purdue-fort-wayne",
  "Queens":                "queens-nc",
  "Quinnipiac":            "quinnipiac",
  "Radford":               "radford",
  "Rhode Island":          "rhode-island",
  "Rice":                  "rice",
  "Richmond":              "richmond",
  "Rider":                 "rider",
  "Robert Morris":         "robert-morris",
  "Rutgers":               "rutgers",
  "Sacramento State":      "sacramento-state",
  "Saint Francis":         "saint-francis-pa",
  "Saint Joseph's":        "saint-josephs",
  "Saint Louis":           "saint-louis",
  "Saint Mary's":          "saint-marys-ca",
  "Saint Peter's":         "saint-peters",
  "Sam Houston":           "sam-houston-state",
  "Samford":               "samford",
  "San Diego":             "san-diego",
  "San Diego State":       "san-diego-state",
  "San Francisco":         "san-francisco",
  "San Jose State":        "san-jose-state",
  "Santa Barbara":         "california-santa-barbara",
  "Seton Hall":            "seton-hall",
  "Siena":                 "siena",
  "SMU":                   "southern-methodist",
  "South Alabama":         "south-alabama",
  "South Carolina":        "south-carolina",
  "South Carolina State":  "south-carolina-state",
  "South Dakota":          "south-dakota",
  "South Dakota State":    "south-dakota-state",
  "South Florida":         "south-florida",
  "Southeast Missouri State": "southeast-missouri-state",
  "Southeastern Louisiana":"southeastern-louisiana",
  "Southern":              "southern-university",
  "Southern Illinois":     "southern-illinois",
  "Southern Miss":         "southern-miss",
  "Southern Utah":         "southern-utah",
  "St. Bonaventure":       "st-bonaventure",
  "St. John's":            "st-johns",
  "Stanford":              "stanford",
  "Stephen F. Austin":     "stephen-f-austin",
  "Stetson":               "stetson",
  "Stony Brook":           "stony-brook",
  "Syracuse":              "syracuse",
  "TCU":                   "texas-christian",
  "Temple":                "temple",
  "Tennessee":             "tennessee",
  "Tennessee State":       "tennessee-state",
  "Tennessee Tech":        "tennessee-tech",
  "Texas":                 "texas",
  "Texas A&M":             "texas-am",
  "Texas A&M-Corpus Christi": "texas-am-corpus-christi",
  "Texas Southern":        "texas-southern",
  "Texas State":           "texas-state",
  "Texas Tech":            "texas-tech",
  "The Citadel":           "the-citadel",
  "Toledo":                "toledo",
  "Towson":                "towson",
  "Troy":                  "troy",
  "Tulane":                "tulane",
  "Tulsa":                 "tulsa",
  "UAB":                   "alabama-birmingham",
  "UC Davis":              "california-davis",
  "UC Irvine":             "california-irvine",
  "UC Riverside":          "california-riverside",
  "UC San Diego":          "california-san-diego",
  "UCF":                   "central-florida",
  "UCLA":                  "ucla",
  "UIC":                   "illinois-chicago",
  "UL Monroe":             "louisiana-monroe",
  "UMass Lowell":          "massachusetts-lowell",
  "UMBC":                  "maryland-baltimore-county",
  "UNC Asheville":         "north-carolina-asheville",
  "UNC Greensboro":        "north-carolina-greensboro",
  "UNC Wilmington":        "north-carolina-wilmington",
  "UNLV":                  "nevada-las-vegas",
  "USC":                   "southern-california",
  "USC Upstate":           "south-carolina-upstate",
  "UT Arlington":          "texas-arlington",
  "UT Martin":             "tennessee-martin",
  "UTEP":                  "texas-el-paso",
  "UTSA":                  "texas-san-antonio",
  "Utah":                  "utah",
  "Utah State":            "utah-state",
  "Utah Tech":             "utah-tech",
  "Utah Valley":           "utah-valley",
  "UCSB":                  "california-santa-barbara",
  "Valparaiso":            "valparaiso",
  "VCU":                   "virginia-commonwealth",
  "Vermont":               "vermont",
  "Villanova":             "villanova",
  "Virginia":              "virginia",
  "Virginia Tech":         "virginia-tech",
  "VMI":                   "virginia-military-institute",
  "Wagner":                "wagner",
  "Wake Forest":           "wake-forest",
  "Washington":            "washington",
  "Washington State":      "washington-state",
  "Weber State":           "weber-state",
  "West Virginia":         "west-virginia",
  "Western Carolina":      "western-carolina",
  "Western Illinois":      "western-illinois",
  "Western Kentucky":      "western-kentucky",
  "Western Michigan":      "western-michigan",
  "Wichita State":         "wichita-state",
  "William & Mary":        "william-mary",
  "Winthrop":              "winthrop",
  "Wisconsin":             "wisconsin",
  "Wofford":               "wofford",
  "Wright State":          "wright-state",
  "Wyoming":               "wyoming",
  "Xavier":                "xavier",
  "Yale":                  "yale",
  "Youngstown State":      "youngstown-state",
};

const SEASON = new Date().getMonth() >= 9
  ? new Date().getFullYear() + 1  // Oct-Dec → next season (e.g. 2025-26 = 2026)
  : new Date().getFullYear();     // Jan-Sep → current season

const PROXY = "https://api.allorigins.win/get?url=";

function srUrl(slug) {
  return `https://www.sports-reference.com/cbb/schools/${slug}/men/${SEASON}.html`;
}

// Parse position from SR roster (they use F, G, C, F-G etc.)
function normalizePos(raw) {
  const s = String(raw || "").trim().toUpperCase();
  if (s.startsWith("G")) return "Guard";
  if (s.startsWith("F")) return "Wing";
  if (s.startsWith("C")) return "Big";
  return raw || "";
}

// Map SR class strings to your app's format
function normalizeYear(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "fr" || s === "fr." || s.includes("fresh")) return "Freshman";
  if (s === "so" || s === "so." || s.includes("soph"))  return "Sophomore";
  if (s === "jr" || s === "jr." || s.includes("jun"))   return "Junior";
  if (s === "sr" || s === "sr." || s.includes("sen"))   return "Senior";
  if (s === "gr" || s.includes("grad"))                 return "Graduate";
  return raw || "";
}

/**
 * Fetch and parse a team's current roster from Sports Reference.
 * Returns an array of plain player objects shaped for your app.
 * Each player has source: "returning" to distinguish from portal targets.
 *
 * @param {string} teamName - Display name (e.g. "Rutgers")
 * @returns {Promise<Array>}
 */
export async function fetchTeamRoster(teamName) {
  const slug = TEAM_SLUGS[teamName];
  if (!slug) throw new Error(`No Sports Reference slug found for "${teamName}". Check TEAM_SLUGS in roster.js.`);

  const targetUrl = srUrl(slug);
  const proxyUrl  = PROXY + encodeURIComponent(targetUrl);

  const res = await fetch(proxyUrl);
  if (!res.ok) throw new Error(`Proxy request failed (${res.status})`);

  const json = await res.json();
  const html  = json.contents;
  if (!html) throw new Error("Empty response from proxy");

  // Parse the HTML in a sandboxed document
  const doc = new DOMParser().parseFromString(html, "text/html");

  // SR roster table has id="roster"
  const table = doc.querySelector("table#roster");
  if (!table) throw new Error(`Could not find roster table for ${teamName}. Sports Reference may have changed their page structure.`);

  const headers = Array.from(table.querySelectorAll("thead th"))
    .map(th => th.getAttribute("data-stat") || th.textContent.trim());

  const rows = Array.from(table.querySelectorAll("tbody tr"))
    .filter(tr => !tr.classList.contains("thead")); // skip any mid-table header rows

  const players = rows.map((tr, i) => {
    const cells = {};
    tr.querySelectorAll("td, th").forEach(td => {
      const key = td.getAttribute("data-stat");
      if (key) cells[key] = td.textContent.trim();
    });

    // SR roster columns: player, pos, class, height, weight, hometown, ...
    const name = cells["player"] || cells["name_display"] || "";
    if (!name) return null;

    const pos  = normalizePos(cells["pos"]);
    const year = normalizeYear(cells["class"]);

    const id = `ret_${String(name).trim().toLowerCase().replace(/\s+/g, "_")}__${slug}`;

    return {
      id,
      name:        name.trim(),
      team:        teamName,
      pos,
      year,
      marketLow:   0,
      marketHigh:  0,
      tags:        [],
      playmakerTags: [],
      shootingTags:  [],
      stats:       cells, // raw SR stats for reference
      source:      "returning", // key flag — distinguishes from portal targets
    };
  }).filter(Boolean);

  if (!players.length) throw new Error(`Parsed 0 players for ${teamName}. Table may have changed.`);

  return players;
}

/**
 * Get a sorted list of all team names we have slugs for.
 */
export function getTeamNames() {
  return Object.keys(TEAM_SLUGS).sort();
}
