-- ============================================================
-- News Board — coach-facing articles / upcoming-event posts.
-- Run in the Supabase SQL Editor. Safe to re-run (idempotent).
--
-- Superadmins author posts in /admin → News; coaches read published posts at
-- /news. Body is plain text with a tiny markup (**bold**, [text](url)) plus
-- inline player mentions written as [[p:<uuid>|Display Name]] that render as
-- chips opening the player modal.
-- ============================================================

create table if not exists public.news_posts (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  body         text,
  event_date   date,                                   -- optional "upcoming event" date
  status       text not null default 'draft' check (status in ('draft','published')),
  pinned       boolean not null default false,
  author_name  text,
  published_at timestamp with time zone,
  created_at   timestamp with time zone default now(),
  updated_at   timestamp with time zone default now()
);

create index if not exists news_posts_feed_idx on public.news_posts (status, pinned, published_at desc);

alter table public.news_posts enable row level security;

-- Coaches read published posts.
drop policy if exists "Authenticated read published news" on public.news_posts;
create policy "Authenticated read published news"
  on public.news_posts for select
  to authenticated
  using (status = 'published');

-- Superadmins manage everything (incl. drafts).
drop policy if exists "Superadmin manages news" on public.news_posts;
create policy "Superadmin manages news"
  on public.news_posts for all
  using      (exists (select 1 from public.coaches where coaches.user_id = auth.uid() and coaches.role = 'superadmin'))
  with check (exists (select 1 from public.coaches where coaches.user_id = auth.uid() and coaches.role = 'superadmin'));

-- Reuse the shared updated_at trigger fn (defined in schema.sql).
drop trigger if exists news_posts_updated_at on public.news_posts;
create trigger news_posts_updated_at
  before update on public.news_posts
  for each row execute function public.set_updated_at();

notify pgrst, 'reload schema';
