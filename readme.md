# Beyond the Portal

Modern roster construction platform for D1 programs.

## Stack

| Layer    | Technology |
|----------|------------|
| Frontend | React 18 + Vite |
| Auth + DB | Supabase (Postgres + Auth) |
| Hosting  | Vercel (free tier) |
| Scraping | Python (requests + BeautifulSoup + pandas) |

---

## Quick start

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/beyond-the-portal
cd beyond-the-portal
npm install
```

### 2. Set up Supabase

1. Create a free project at https://supabase.com
2. Go to **SQL Editor** and run the contents of `supabase/schema.sql`
3. Go to **Settings → API** and copy your **Project URL** and **anon key**

### 3. Configure environment

```bash
cp .env.example .env.local
```

Edit `.env.local`:
```
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### 4. Run locally

```bash
npm run dev
# → http://localhost:5173
```

### 5. Create your first coach account

```powershell
$env:SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
$env:SUPABASE_SERVICE_KEY="your-service-role-key"

python create_coach.py --email you@program.edu --team "Rutgers" --name "Coach Smith"
```

### 6. Populate roster data

```bash
python scraper_to_supabase.py --teams "Rutgers" "Duke" "Kentucky"
```

### 7. Import your portal board

Go to **Supabase → Table Editor → portal_board → Insert → Import CSV**
and upload your existing `BeyondThePortal_GM_Tool - Import_Board.csv`.

---

## Deploy to Vercel

```bash
# Push to GitHub first
git add . && git commit -m "Initial commit" && git push

# Then at vercel.com:
# 1. Import your GitHub repo
# 2. Add environment variables (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY)
# 3. Deploy
```

Set your Vercel URL in Supabase: **Authentication → URL Configuration → Site URL**

---

## Project structure

```
beyond-the-portal/
├── src/
│   ├── components/
│   │   ├── PlayerCard.jsx       # Reusable player row
│   │   ├── PlayerModal.jsx      # Player detail modal
│   │   ├── ProtectedRoute.jsx   # Auth guard for routes
│   │   └── SiteHeader.jsx       # Nav + sign out
│   ├── hooks/
│   │   ├── useAuth.js           # Session + coach profile state
│   │   └── useRosterBoard.js    # All board/roster/shortlist logic
│   ├── lib/
│   │   └── supabase.js          # Supabase client (reads .env.local)
│   ├── pages/
│   │   ├── AppPage.jsx          # Roster builder (3-panel view)
│   │   ├── BoardPage.jsx        # Full board with table/card toggle
│   │   ├── LoginPage.jsx        # Sign in + forgot password
│   │   └── ResetPasswordPage.jsx
│   ├── styles/
│   │   └── global.css
│   └── main.jsx                 # Router entry point
├── supabase/
│   └── schema.sql               # Run this in Supabase SQL Editor
├── scraper_to_supabase.py       # Scrape BBRef rosters → Supabase
├── create_coach.py              # Create/manage coach accounts
├── roster_scraper.py            # Legacy CSV scraper (kept for reference)
├── .env.example
├── package.json
└── vite.config.js
```

---

## Season rollover

At the start of each season:

```bash
# Refresh rosters for your active programs
python scraper_to_supabase.py --teams "Rutgers" "Duke" --replace

# Re-import your updated portal board CSV via Supabase Table Editor
# (truncate the table first, then re-import)
```

No code changes, no redeployment needed — data updates are live instantly.

---

## Managing coaches

```bash
# Add a coach
python create_coach.py --email coach@rutgers.edu --team "Rutgers" --name "Coach Smith"

# Bulk add from CSV (columns: email, team, name)
python create_coach.py --csv new_coaches.csv

# List all coaches
python create_coach.py --list

# Remove a coach
python create_coach.py --delete coach@rutgers.edu
```
