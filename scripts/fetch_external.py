#!/usr/bin/env python3
"""Fetch outside data for the site and write it to data/.

Run by .github/workflows/fetch-data.yml on a schedule. Each source is fetched on its own:
if one fails, its file is left as it was and the others still update. The script exits
with status 1 if any source failed, so the workflow run shows as failed.

    data/brent.json            Europe Brent spot price, daily (EIA API v2; needs EIA_API_KEY)
    data/hormuz_coverage.json  Daily count of news articles mentioning the Strait of Hormuz (GDELT DOC 2.0; no key)

These files are replaced on each run (they mirror the source), unlike the hand-kept chart
files, which are append-only.

Usage:  EIA_API_KEY=... python scripts/fetch_external.py
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
START = "2026-01-01"  # about two months of pre-war baseline before Feb 28
USER_AGENT = "PersianGulfDailySummary/1.0 (+https://claude.russell-ortelius.workers.dev/)"


def get_json(url: str, attempts: int = 4, wait: int = 20) -> dict:
    """GET a JSON document, retrying with growing waits.

    GDELT answers too-frequent requests with a plain-text notice instead of JSON, and GitHub's
    runners share IP addresses, so a JSON parse failure is retried like a network error.
    Error messages never include the URL, which can carry the API key.
    """
    last = None
    for i in range(attempts):
        body = ""
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as res:
                body = res.read().decode("utf-8", errors="replace")
            return json.loads(body)
        except urllib.error.HTTPError as err:
            last = f"HTTP {err.code} {err.reason}"
        except json.JSONDecodeError:
            last = "not JSON: " + " ".join(body.split())[:160]
        except (urllib.error.URLError, TimeoutError) as err:
            last = f"{type(err).__name__}: {getattr(err, 'reason', err)}"
        if i < attempts - 1:
            time.sleep(wait * (i + 1))
    raise RuntimeError(last)


def write(name: str, rows: list[dict]) -> None:
    if not rows:
        raise RuntimeError("no rows returned")
    path = DATA / name
    text = json.dumps(rows, indent=2, ensure_ascii=False) + "\n"
    old = path.read_text(encoding="utf-8") if path.exists() else None
    if text != old:
        path.write_text(text, encoding="utf-8")
        print(f"{name}: wrote {len(rows)} rows, latest {rows[-1]['date']}")
    else:
        print(f"{name}: unchanged ({len(rows)} rows)")


def fetch_brent() -> None:
    key = os.environ.get("EIA_API_KEY", "").strip()
    if not key:
        raise RuntimeError("EIA_API_KEY is not set (add it under GitHub Settings > Secrets and variables > Actions)")
    params = [
        ("api_key", key),
        ("frequency", "daily"),
        ("data[0]", "value"),
        ("facets[series][]", "RBRTE"),
        ("start", START),
        ("sort[0][column]", "period"),
        ("sort[0][direction]", "asc"),
        ("length", "5000"),
    ]
    url = "https://api.eia.gov/v2/petroleum/pri/spt/data/?" + urllib.parse.urlencode(params)
    data = get_json(url)
    rows = []
    for r in data.get("response", {}).get("data", []):
        if r.get("value") in (None, ""):
            continue
        rows.append({
            "date": r["period"],
            "price_usd": round(float(r["value"]), 2),
            "source": "US EIA, Europe Brent spot price FOB (RBRTE)",
        })
    rows.sort(key=lambda r: r["date"])
    write("brent.json", rows)


def fetch_hormuz_coverage() -> None:
    start = START.replace("-", "") + "000000"
    end = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    params = {
        "query": '"strait of hormuz"',
        "mode": "timelinevolraw",
        "format": "json",
        "startdatetime": start,
        "enddatetime": end,
        "timelinesmooth": "0",
    }
    url = "https://api.gdeltproject.org/api/v2/doc/doc?" + urllib.parse.urlencode(params)
    data = get_json(url)
    series = (data.get("timeline") or [{}])[0].get("data") or []
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    rows = []
    for p in series:
        d = p["date"]  # "20261111T000000Z"
        iso = f"{d[0:4]}-{d[4:6]}-{d[6:8]}"
        if iso >= today:
            continue  # today's count is still partial
        rows.append({
            "date": iso,
            "articles": int(p["value"]),
            "all_articles": int(p["norm"]) if p.get("norm") is not None else None,
            "source": "GDELT DOC 2.0 (global news in 65 languages, machine translated), query \"strait of hormuz\"",
        })
    rows.sort(key=lambda r: r["date"])
    write("hormuz_coverage.json", rows)


def main() -> int:
    failed = []
    for name, fn in (("brent", fetch_brent), ("hormuz_coverage", fetch_hormuz_coverage)):
        try:
            fn()
        except Exception as err:  # keep going; report at the end
            failed.append(name)
            msg = str(err)
            key = os.environ.get("EIA_API_KEY", "").strip()
            if key:
                msg = msg.replace(key, "***")
            print(f"{name}: FAILED - {msg}", file=sys.stderr)
            print(f"::error title={name} fetch failed::{msg}")  # shows on the run's summary page
    if failed:
        print(f"Failed: {', '.join(failed)}. Their files were left unchanged.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
