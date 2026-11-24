# Persian Gulf Daily Summary

A static website that publishes each daily "Persian Gulf hostilities - 24-hour summary" as a web page. It has a permanent URL per day, an archive, and five interactive charts. It follows *Persian Gulf Daily Summary Website - Specification v1.0* (November 17, 2026).

| URL | Page |
|---|---|
| `/` | Latest summary |
| `/2026-11-17/` | One page per day, same sections and order as the email |
| `/archive/` | Every summary, newest first |
| `/charts/` | The five charts, full width, with sources, data tables, and links to the data files |
| `/data/*.json` | Chart data and one summary file per day |

## Design

A dark editorial theme, set by the site owner after spec v1.0, replaces the spec's white Calibri layout (Section 3):

- **Colors:** charcoal background (`#222222`), off-white text, hairline rules and one blue accent. Chart series use brighter versions of the spec colors so they read on charcoal.
- **Fonts:** Inter Tight for text and JetBrains Mono for small uppercase labels. Both are self-hosted in `assets/fonts/` under the SIL Open Font License.
- **Daily page order:** title and key figures (latest launch total, ship attacks and seafarer deaths, computed from the data files), Top line, **Charts**, then Launches and strikes, Maritime and shipping, Casualties and damage, Diplomacy and statements, and Sources. Charts come right after the Top line instead of after Diplomacy as in the email. The text of each section still matches the email word for word.
- **Print:** the page prints as a light document; the charts print as dark panels.

## How it works

```
data/summaries/YYYY-MM-DD.json   one file per day (spec Section 4)
data/*.json                      chart data, append-only (spec Section 6)
templates/                       Jinja2 templates (base, day, archive, charts, 404)
assets/                          styles.css, charts.js, chart.umd.min.js (Chart.js 4.5.1, MIT)
build.py                         validates the data, then writes site/
site/                            build output; not committed and never edited by hand
```

`build.py` checks every file before it writes anything. Each required field must be present, dates must be valid, and source URLs must be `https://` direct links, never `google.com/url?q=` wrappers. Text fields must be plain text with no HTML and no en or em dashes. Chart numbers must be whole numbers or `null`. If anything is wrong, the build stops and lists each problem with its file and field.

The charts read the JSON files in the browser. Subtitle values such as "Latest: 620 as of Nov 9" and "Not shown: Iran 3,724; Lebanon 4,346 killed" are computed from the data. A correction is a new row with the same date (or country); the chart uses the last row.

## Run locally

```bash
pip install -r requirements.txt
```

```bash
python build.py
```

```bash
python -m http.server -d site 8000
```

Open http://localhost:8000. The charts need a local server because browsers block JSON loads from `file://`.

To run the tests:

```bash
python -m unittest discover -s tests
```

## Publishing a new day

The daily 6:00 AM PT job does this, and nobody edits HTML:

1. Write `data/summaries/YYYY-MM-DD.json` using the same shape as `2026-11-17.json`.
2. If a newer figure was found, append a row to the matching `data/*.json` file and describe it in that day's `chart_updates`, for example `"Launches: 620 to 628 (JINSA, Nov 18)"`.
3. Commit and push. Cloudflare rebuilds and publishes. The new day becomes the home page, and the previous/next links and the archive update themselves.

To check a file without building, run `python build.py --check`.

Optional fields, for summaries that don't follow the usual layout (see `2026-11-13.json`):

- `"note"`: a short note shown under the window line, also flagged in the archive (used to mark the Nov 13 manual test run).
- `"charts": false`: leave out the Charts section, for a summary that had none.
- `"subitems"` on a bullet: one level of sub-bullets.
- `casualties_and_damage` may be a list of bullets instead of one paragraph.

## Deploy on Cloudflare

Connect the repository once. Every push to `main` then rebuilds and publishes the site.

1. In the Cloudflare dashboard, go to **Workers & Pages → Create → Import a repository** and choose this repo. Name the Worker `claude`, the name in `wrangler.jsonc`. If you pick another name, change it in that file too, because Cloudflare requires the two to match.
2. Leave **Build command** empty. Cloudflare installs `requirements.txt` by itself.
3. Set **Deploy command** to `npx wrangler deploy`. `wrangler.jsonc` makes it run `build.py` first, then publish the `site/` folder.

If you choose a Cloudflare **Pages** project instead, set the build command to `pip install -r requirements.txt && python build.py` and the output directory to `site`.

To deploy by hand from your machine, run `npx wrangler deploy`.

**Keeping it private:** the site is public by default. To limit it to specific people, put it behind **Cloudflare Access** (Zero Trust → Access → Applications) with an email allow-list.

## Ask the data (LLM questions)

Each daily page has an "Ask the data" box, and there is an **Ask** page in the top bar. A question goes to `/api/ask`, handled by `src/worker.js`. The Worker gives the model the 10 most recent summaries plus all chart data, with instructions to answer only from them, cite the summary date or chart, and keep the summaries' caveats. Every other URL is still served straight from `site/`.

**Switching it on (NVIDIA API, the current setting)**

1. Sign in at build.nvidia.com and create an API key. It starts with `nvapi-`.
2. In the Cloudflare dashboard, go to this Worker, then **Settings > Variables and secrets > Add**. Choose type **Secret**, name it `NVIDIA_API_KEY`, and paste the key.
3. To use a different model, change `LLM_MODEL` in `wrangler.jsonc` to its id on build.nvidia.com (default `meta/llama-3.3-70b-instruct`) and push.

**Other providers**

Any OpenAI-compatible chat API works. Set `LLM_API_URL` and `LLM_MODEL` in `wrangler.jsonc`, then save the key as a secret:

| Provider | `LLM_API_URL` | Secret name |
|---|---|---|
| NVIDIA API | `https://integrate.api.nvidia.com/v1/chat/completions` | `NVIDIA_API_KEY` |
| Hugging Face Inference Providers (needs credits) | `https://router.huggingface.co/v1/chat/completions` | `HUGGINGFACE_API_KEY` |
| Hugging Face Inference Endpoint (`LLM_MODEL` = `tgi`) | `https://<your-endpoint>.endpoints.huggingface.cloud/v1/chat/completions` | `HUGGINGFACE_API_KEY` |
| Anything else | its chat completions URL | `LLM_API_KEY` |

Each named key is only sent to its own provider. `LLM_API_KEY`, if set, is used with any provider. Until a matching key is set, the box shows "Questions are not switched on yet." If the provider returns an error, the box shows its reason (bad key, unknown model, no credits).

**Safeguards**

- **Rate limit:** at most 10 questions per minute per visitor (`ratelimits` in `wrangler.jsonc`).
- **Length and origin:** questions are capped at 500 characters, and only pages on this site can send them.
- **Display:** answers are shown as plain text, never HTML. The page labels them as AI-generated.

**Local testing**

Put `NVIDIA_API_KEY=...` in a `.dev.vars` file (git-ignored), then run `npx wrangler dev`.

## Not built yet

- **Backfill (spec step 11):** done. November 13 (marked as the manual test run) through 17 are all in.
- **NVIDIA and Supabase:** the spec keeps the site static, with no database and no automated news gathering. The natural places for these later are the daily job (NVIDIA could draft the summary JSON) and, if the JSON files outgrow the repo, Supabase as the data store.

## Outside data (fetched automatically)

Two charts on the Charts page, under "Context: oil prices and news coverage", use public data that a GitHub Action fetches. Nobody edits these files by hand.

| File | What it holds | Source | Key |
|---|---|---|---|
| `data/brent.json` | Brent crude spot price, daily, from Jan 1, 2026 | US EIA API v2, series RBRTE | `EIA_API_KEY` |
| `data/hormuz_coverage.json` | News articles per day mentioning "strait of hormuz", from Jan 1, 2026 | GDELT DOC 2.0 API | none |

- `scripts/fetch_external.py` fetches both and rewrites the two files. Unlike the hand-kept chart files, these files are not append-only: each run replaces them with the source's current series.
- `.github/workflows/fetch-data.yml` runs the script twice a day (7:23 AM and 7:23 PM Pacific), checks that the site still builds, and commits any change. Cloudflare then publishes it. To run it now, go to **Actions > Fetch outside data > Run workflow**.
- If one source fails, its file stays as it was, the other still updates, and the run shows as failed (GitHub emails you about failed runs).
- The API key lives in **GitHub > Settings > Secrets and variables > Actions**, not in Cloudflare: the fetch runs on GitHub, and Cloudflare only receives the finished files.
- Both files are optional for the build. Without them, the two charts show "Chart data unavailable" and every other page works.
- "Ask the data" also reads these files, limited to the latest 60 rows of each.

To add another source, write a `fetch_<name>()` function in the script, add its file to `OPTIONAL_CHART_FILES` in `build.py`, to `CHART_FILES` in `src/worker.js`, and to `git add` in the workflow, then add a chart to `OUTSIDE_CHARTS` in `templates/_charts.html` and a builder in `assets/charts.js`.

## Supabase tables (optional)

The site still reads only the JSON files. `supabase/` holds a database copy of the same data, for when Supabase becomes the data store:

- `supabase/migrations/0001_init.sql` creates one table per data file (`summaries`, `launches`, `ship_incidents`, `casualties`, `uae`, `opening_wave`) with the same field names, and makes them public read-only. Only the secret key can write.
- `supabase/seed.sql` copies the current JSON data into those tables. It is a snapshot and is not updated when new days are added.

In Supabase, open **SQL Editor > New query**, paste `0001_init.sql` and click **Run**. "Success. No rows returned." is the correct result. Then do the same with `seed.sql`.
