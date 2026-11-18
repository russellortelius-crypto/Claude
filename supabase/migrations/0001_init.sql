-- Gulf News Monitor schema. Run in the Supabase SQL editor, or with `supabase db push`.

create table if not exists public.articles (
  id           bigint generated always as identity primary key,
  url          text not null unique,
  title        text not null,
  source       text,
  description  text,
  published_at timestamptz,
  fetched_at   timestamptz not null default now()
);

create index if not exists articles_published_at_idx
  on public.articles (published_at desc nulls last);

create table if not exists public.briefings (
  id         bigint generated always as identity primary key,
  content    text not null,
  model      text,
  sources    jsonb not null default '[]'::jsonb, -- [{title, url, source}] in citation order
  created_at timestamptz not null default now()
);

create index if not exists briefings_created_at_idx
  on public.briefings (created_at desc);

-- Public can read; only the Worker (service role key, which bypasses RLS) can write.
alter table public.articles  enable row level security;
alter table public.briefings enable row level security;

drop policy if exists "Public read articles" on public.articles;
create policy "Public read articles" on public.articles for select using (true);

drop policy if exists "Public read briefings" on public.briefings;
create policy "Public read briefings" on public.briefings for select using (true);
