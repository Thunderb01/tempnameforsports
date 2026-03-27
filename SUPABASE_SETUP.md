# Supabase + Vercel Auth Setup

Complete guide to switching from access codes to real email/password accounts.
Estimated time: ~45 minutes.

---

## Part 1 — Supabase project

### 1.1 Create a free account
Go to https://supabase.com and sign up. Create a new project.
- Name it something like `beyond-the-portal`
- Pick any region (US East is fine)
- Set a strong database password (save it — you won't need it often)

### 1.2 Get your API keys
In your Supabase project dashboard:
`Settings → API`

Copy these two values — you'll need them shortly:
- **Project URL** — looks like `https://xxxxxxxxxxxx.supabase.co`
- **anon/public key** — a long JWT string

### 1.3 Create the `coaches` table
Go to `Table Editor → New table` and create a table called `coaches` with these columns:

| Column         | Type      | Default | Notes                          |
|----------------|-----------|---------|--------------------------------|
| id             | uuid      | gen_random_uuid() | Primary key     |
| created_at     | timestamp | now()   |                                |
| user_id        | uuid      |         | Foreign key → auth.users(id)   |
| team           | text      |         | e.g. "Rutgers"                 |
| display_name   | text      |         | Coach's name                   |
| role           | text      | 'coach' | 'coach' or 'admin'             |

Or run this in `SQL Editor`:

```sql
create table public.coaches (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamp with time zone default now(),
  user_id      uuid references auth.users(id) on delete cascade not null,
  team         text not null,
  display_name text,
  role         text default 'coach'
);

-- Only the coach themselves (or an admin) can read their own row
alter table public.coaches enable row level security;

create policy "Coaches can read own row"
  on public.coaches for select
  using (auth.uid() = user_id);
```

### 1.4 Configure Auth settings
In `Authentication → Providers`:
- Make sure **Email** is enabled
- Turn off **Confirm email** for now (you can turn it back on when you go live — it requires setting up an email sender)

In `Authentication → URL Configuration`:
- Set **Site URL** to your Vercel URL (you'll get this in Part 3 — come back and set it)
- Add `http://localhost:5173` to **Redirect URLs** for local dev

---

## Part 2 — Create coach accounts

You create accounts manually for each program you onboard. There's no self-signup
(coaches can't create their own accounts — you control who gets access).

### Option A: Supabase dashboard
`Authentication → Users → Invite user`
- Enter the coach's email
- They'll get an email with a magic link to set their password

### Option B: The admin script (recommended for bulk)
```bash
# Set your keys first
export SUPABASE_URL="https://eovdervlwpkrooxdxbnd.supabase.co"
export SUPABASE_SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVvdmRlcnZsd3Brcm9veGR4Ym5kIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDQxNzU3NiwiZXhwIjoyMDg5OTkzNTc2fQ.VLiPmQubYC28izibHRLhpW3fQaehlnq76hb-GHLOPZ0"  # Settings → API → service_role

python create_coach.py --email "coach@rutgers.edu" --team "Rutgers" --name "Coach Smith"
```

See `create_coach.py` in this repo.

---

## Part 3 — Deploy to Vercel

GitHub Pages won't work for this anymore because Supabase auth redirects need
a real domain with HTTPS. Vercel is free and takes 2 minutes.

### 3.1 Push to GitHub
Make sure your project is in a GitHub repo (it already is based on your setup).

```bash
git add .
git commit -m "Add Supabase auth"
git push
```

**Important:** Do NOT commit `data/team_codes_PRIVATE.csv` or any `.env` files.
Add this to `.gitignore`:
```
data/team_codes_PRIVATE.csv
.env
.env.local
```

### 3.2 Connect to Vercel
1. Go to https://vercel.com and sign in with GitHub
2. Click `Add New Project` → import your repo
3. No build settings needed (it's a static site) — just click Deploy
4. Copy your Vercel URL (e.g. `https://beyond-the-portal.vercel.app`)

### 3.3 Set environment variables in Vercel
In your Vercel project: `Settings → Environment Variables`

Add these two:
```
VITE_SUPABASE_URL      = https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY = your-anon-key-here
```

> If you're not using Vite (this project is plain HTML/JS), just hardcode the
> keys directly in `auth.js` — they're safe to expose client-side (Supabase's
> anon key is designed to be public). See the comment in `auth.js`.

### 3.4 Go back to Supabase and update the Site URL
`Authentication → URL Configuration → Site URL`
Set it to your Vercel URL.

---

## Part 4 — Local development

```bash
# Serve the project locally (any of these work)
python -m http.server 5173
# or
npx serve . -p 5173
# or install Live Server in VS Code
```

Visit `http://localhost:5173/login.html`

---

## Rotating or revoking access

To remove a coach's access: `Authentication → Users → [find user] → Delete`

To change their team assignment: update the `team` column in the `coaches` table.

To change their password: `Authentication → Users → [find user] → Send password reset`

---

## Season rollover

At the start of each season:
1. Run `python roster_scraper.py` to refresh `data/all_rosters.csv`
2. Push to GitHub → Vercel auto-deploys
3. No auth changes needed — accounts persist across seasons
