# Gulf Watch

A Cloudflare Workers site with continuously updated coverage of the conflict in the Persian Gulf. It pulls headlines from news feeds, can store them in **Supabase**, and can write an AI situation briefing with the **NVIDIA API**.

It works before anything is configured, and each service you add turns on more:

| Configured | What you get |
|---|---|
| Nothing | Headlines fetched live from the feeds on each visit (cached for 10 minutes) |
| + `NVIDIA_API_KEY` | An AI briefing above the headlines, with numbered citations (cached for 30 minutes) |
| + Supabase | A cron job every 30 minutes stores new articles and saves a fresh briefing only when new articles came in |

## Structure

```
public/            static frontend (HTML/CSS/JS, no build step)
src/index.js       Worker: /api routes + cron handler
src/feeds.js       news sources, RSS/Atom parser, relevance filter
src/nvidia.js      briefing generation (OpenAI-compatible chat completions)
src/supabase.js    PostgREST calls over fetch (no SDK)
supabase/migrations/0001_init.sql   tables + read-only public RLS
```

API:

- `GET /api/news`: latest articles (`mode` is `supabase` or `live`)
- `GET /api/briefing`: latest AI briefing, or `status: not_configured`
- `GET /api/status`: which integrations are configured
- `POST /api/refresh`: run ingestion now (`Authorization: Bearer $ADMIN_TOKEN`)

## Run locally

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in only what you have
npm run dev                      # http://localhost:8787
npm test
```

To trigger the cron handler locally, start the dev server with `npx wrangler dev --test-scheduled`, then run:

```bash
curl "http://localhost:8787/cdn-cgi/handler/scheduled"
```

## Set up Supabase

1. Create a project at supabase.com.
2. Open **SQL Editor**, paste `supabase/migrations/0001_init.sql`, and run it.
3. From **Project Settings → API**, copy the project URL and the `service_role` (or `sb_secret_…`) key. The Worker uses this key for writes. It must stay server-side and never go in `public/`.

## Set up NVIDIA

1. Create an API key at build.nvidia.com (it starts with `nvapi-`).
2. Optional: change `NVIDIA_MODEL` in `wrangler.jsonc` to any chat model listed there. The default is `meta/llama-3.3-70b-instruct`.

The prompt (`src/nvidia.js`) tells the model to use only the supplied headlines, cite them by number, attribute claims, and flag anything unconfirmed. The page labels the briefing as AI-generated and lists its sources.

## Deploy to Cloudflare

```bash
npx wrangler login
```

```bash
npx wrangler secret put SUPABASE_URL
```

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

```bash
npx wrangler secret put NVIDIA_API_KEY
```

```bash
npx wrangler secret put ADMIN_TOKEN
```

```bash
npm run deploy
```

You can also connect the GitHub repo in the Cloudflare dashboard (**Workers & Pages → Create → Import a repository**) so every push deploys. Add the same secrets under the Worker's **Settings → Variables and Secrets**.

## Changing sources

Edit `FEEDS` and `RELEVANCE` in `src/feeds.js`. Feeds marked `filter: true` are general Middle East or world feeds, so the Worker keeps only items that match the regional keyword filter. The Google News feed is already a targeted search, so it is not filtered.
