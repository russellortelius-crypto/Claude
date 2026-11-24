-- Persian Gulf Daily Summary: tables for Supabase.
-- One table per data file in data/. Column names match the JSON fields, so a row
-- in a JSON file maps straight onto a row here.
--
-- Run once in Supabase: SQL Editor > New query > paste > Run.
-- Expected result: "Success. No rows returned."
--
-- Access: anyone with the publishable key can read (the site is public).
-- Only the secret (service role) key can write; it bypasses row level security.

-- ------------------------------------------------------------------ summaries
-- data/summaries/YYYY-MM-DD.json, one row per day.
create table if not exists public.summaries (
  date                     date primary key,
  title                    text not null,
  time_window              text not null,          -- "window" in the JSON (a reserved word in SQL)
  generated_at             timestamptz not null,
  note                     text,                   -- optional, e.g. marks the Nov 13 test run
  charts                   boolean not null default true,
  top_line                 text not null,
  launches_and_strikes     jsonb not null,         -- [{label, text, subitems?}]
  maritime_and_shipping    jsonb not null,         -- [{label, text, subitems?}]
  casualties_and_damage    jsonb not null,         -- a paragraph (JSON string) or a list of bullets
  diplomacy_and_statements jsonb not null,         -- [{label, text, subitems?}]
  chart_updates            text[] not null default '{}',
  sources                  jsonb not null,         -- [{outlet, title, url}]
  created_at               timestamptz not null default now(),
  constraint sources_not_empty check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) > 0)
);

-- ------------------------------------------------------------------ chart data
-- Append-only, like the JSON files: a correction is a new row with the same date
-- (or country), and the chart uses the last row. "id" keeps that order.
-- Missing numbers are null, never 0.

-- data/launches.json
create table if not exists public.launches (
  id                  bigint generated always as identity primary key,
  date                date not null,
  launched_since_jul7 integer not null check (launched_since_jul7 >= 0),
  source              text not null,
  created_at          timestamptz not null default now()
);

-- data/ship_incidents.json
create table if not exists public.ship_incidents (
  id                  bigint generated always as identity primary key,
  date                date not null,
  confirmed_incidents integer not null check (confirmed_incidents >= 0),
  seafarer_deaths     integer check (seafarer_deaths >= 0),
  source              text not null,
  created_at          timestamptz not null default now()
);

-- data/casualties.json
create table if not exists public.casualties (
  id         bigint generated always as identity primary key,
  country    text not null,
  killed     integer not null check (killed >= 0),
  injured    integer check (injured >= 0),
  as_of      date not null,
  note       text,
  source     text not null,
  created_at timestamptz not null default now()
);

-- data/uae.json
create table if not exists public.uae (
  id         bigint generated always as identity primary key,
  date       date not null,
  ballistic  integer not null check (ballistic >= 0),
  cruise     integer not null check (cruise >= 0),
  drones     integer not null check (drones >= 0),
  source     text not null,
  created_at timestamptz not null default now()
);

-- data/opening_wave.json
create table if not exists public.opening_wave (
  id         bigint generated always as identity primary key,
  country    text not null,
  missiles   integer not null check (missiles >= 0),
  drones     integer not null check (drones >= 0),
  source     text not null,
  created_at timestamptz not null default now()
);

create index if not exists launches_date_idx       on public.launches (date);
create index if not exists ship_incidents_date_idx on public.ship_incidents (date);
create index if not exists casualties_country_idx  on public.casualties (country);
create index if not exists uae_date_idx            on public.uae (date);

-- ------------------------------------------------------------------ access
-- Row level security on every table, with a read-only policy for everyone.
-- There are no insert/update/delete policies, so the publishable key cannot write.
do $$
declare
  t text;
begin
  foreach t in array array['summaries', 'launches', 'ship_incidents', 'casualties', 'uae', 'opening_wave']
  loop
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "Public read" on public.%I', t);
    execute format('create policy "Public read" on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end
$$;
