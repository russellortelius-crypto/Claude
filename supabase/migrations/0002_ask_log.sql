-- Persian Gulf Daily Summary: log of "Ask the data" questions.
--
-- Run once in Supabase: SQL Editor > New query > paste > Run.
-- Expected result: "Success. No rows returned."
--
-- The Worker (src/worker.js) adds one row per question it answers or fails to answer,
-- using the SUPABASE_SECRET_KEY secret. No IP address or other visitor detail is stored.
--
-- Access: private. Row level security is on and there are no policies, so the publishable
-- key can neither read nor write this table. The secret key bypasses row level security.
-- To read the log: Supabase > Table Editor > ask_log.

create table if not exists public.ask_log (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  question    text not null check (char_length(question) <= 500),
  page_date   date,                     -- the summary page the question came from, if any
  ok          boolean not null,         -- true when an answer came back
  answer      text,
  error       text,                     -- the message the visitor saw, when ok is false
  http_status integer not null,
  model       text,
  latency_ms  integer
);

create index if not exists ask_log_created_at_idx on public.ask_log (created_at desc);

alter table public.ask_log enable row level security;
revoke all on public.ask_log from anon, authenticated;
