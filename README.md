# Persian Gulf Daily Summary

A static website that publishes each daily "Persian Gulf hostilities - 24-hour summary" as a web page. It has a permanent URL per day, an archive, and five interactive charts. It follows *Persian Gulf Daily Summary Website - Specification v1.0* (November 17, 2026).

| URL | Page |
|---|---|
| `/` | Latest summary |
| `/2026-11-17/` | One page per day, same sections and order as the email |
| `/archive/` | Every summary, newest first |
| `/charts/` | The five charts, full width, with sources, data tables, and links to the data files |
| `/data/*.json` | Chart data and one summary file per day |

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

## Deploy on Cloudflare

Connect the repository once. Every push to `main` then rebuilds and publishes the site.

1. In the Cloudflare dashboard, go to **Workers & Pages → Create → Import a repository** and choose this repo. Name the Worker `claude`, the name in `wrangler.jsonc`. If you pick another name, change it in that file too, because Cloudflare requires the two to match.
2. Leave **Build command** empty. Cloudflare installs `requirements.txt` by itself.
3. Set **Deploy command** to `npx wrangler deploy`. `wrangler.jsonc` makes it run `build.py` first, then publish the `site/` folder.

If you choose a Cloudflare **Pages** project instead, set the build command to `pip install -r requirements.txt && python build.py` and the output directory to `site`.

To deploy by hand from your machine, run `npx wrangler deploy`.

**Keeping it private:** the site is public by default. To limit it to specific people, put it behind **Cloudflare Access** (Zero Trust → Access → Applications) with an email allow-list.

## Not built yet

- **Backfill (spec step 11):** the November 13 to 16 summaries need their emails converted into `data/summaries/` files.
- **NVIDIA and Supabase:** the spec keeps the site static, with no database and no automated news gathering. The natural places for these later are the daily job (NVIDIA could draft the summary JSON) and, if the JSON files outgrow the repo, Supabase as the data store.
