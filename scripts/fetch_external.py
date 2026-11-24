#!/usr/bin/env python3
"""Fetch outside data for the site and write it to data/.

Run by .github/workflows/fetch-data.yml on a schedule. Each source is fetched on its own:
if one fails, its file is left as it was and the others still update. The script exits
with status 1 if any source failed, so the workflow run shows as failed.

    data/brent.json            Europe Brent spot price, daily (EIA API v2; needs EIA_API_KEY)
    data/hormuz_coverage.json  Daily count of news articles mentioning the Strait of Hormuz (GDELT DOC 2.0; no key)
    data/fires.json            Daily satellite fire detections around the Gulf (NASA FIRMS; needs FIRMS_MAP_KEY)
    data/firms_static_cells.json  Routine flare sites found before the war, used by fires.json

brent.json and hormuz_coverage.json are replaced on each run (they mirror the source).
fires.json is merged: FIRMS serves at most 5 days per request, so each run refreshes the
latest days and keeps the rest. Hand-kept chart files stay append-only.

Usage:  EIA_API_KEY=... FIRMS_MAP_KEY=... python scripts/fetch_external.py
"""

from __future__ import annotations

import csv
import io
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
START = "2026-01-01"  # about two months of pre-war baseline before Feb 28
USER_AGENT = "PersianGulfDailySummary/1.0 (+https://claude.russell-ortelius.workers.dev/)"


# A failed fetch only fails the run when the file's newest row is older than this many days.
# GDELT is current to yesterday; EIA posts spot prices several days late.
STALE_AFTER_DAYS = {"brent.json": 14, "hormuz_coverage.json": 3, "fires.json": 4}


def is_stale(name: str) -> bool:
    path = DATA / name
    if not path.exists():
        return True
    try:
        newest = max(r["date"] for r in json.loads(path.read_text(encoding="utf-8")))
    except (ValueError, KeyError, json.JSONDecodeError):
        return True
    return date.fromisoformat(newest) < date.today() - timedelta(days=STALE_AFTER_DAYS[name])


def get_text(url: str, attempts: int = 4, wait: int = 20, want_json: bool = False):
    """GET a URL, retrying with growing waits; returns parsed JSON or text.

    GDELT answers too-frequent requests with a plain-text notice instead of JSON, and GitHub's
    runners share IP addresses, so a JSON parse failure is retried like a network error.
    Error messages never include the URL, which can carry an API key.
    """
    last = None
    for i in range(attempts):
        body = ""
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=90) as res:
                body = res.read().decode("utf-8", errors="replace")
            return json.loads(body) if want_json else body
        except urllib.error.HTTPError as err:
            last = f"HTTP {err.code} {err.reason}"
        except json.JSONDecodeError:
            last = "not JSON: " + " ".join(body.split())[:160]
        except (urllib.error.URLError, TimeoutError) as err:
            last = f"{type(err).__name__}: {getattr(err, 'reason', err)}"
        if i < attempts - 1:
            time.sleep(wait * (i + 1))
    raise RuntimeError(last)


def get_json(url: str) -> dict:
    return get_text(url, want_json=True)


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


# ------------------------------------------------------------------ NASA FIRMS

FIRMS = "https://firms.modaps.eosdis.nasa.gov/api"
# west, south, east, north: Kuwait and southern Iraq to the Gulf of Oman, including Iran's
# Gulf coast, Bahrain, Qatar, the UAE and Musandam. Must match the chart text.
FIRMS_AREA = "47.5,22.5,60,31"
FIRMS_SENSORS = ["VIIRS_NOAA20", "VIIRS_SNPP", "VIIRS_NOAA21"]  # first one covering the whole period wins
WAR_START = "2026-02-28"
CELL = 0.03          # degrees; about 3 km, wider than VIIRS pixel jitter
STATIC_SHARE = 0.10  # a cell lit on at least 10% of pre-war days is a routine flare site


def firms_key() -> str:
    key = os.environ.get("FIRMS_MAP_KEY", "").strip()
    if not key:
        raise RuntimeError("FIRMS_MAP_KEY is not set (add it under GitHub Settings > Secrets and variables > Actions)")
    return key


def firms_availability(key: str) -> dict[str, tuple[str, str]]:
    text = get_text(f"{FIRMS}/data_availability/csv/{key}/all")
    out = {}
    for row in csv.DictReader(io.StringIO(text)):
        did, lo, hi = row.get("data_id"), row.get("min_date"), row.get("max_date")
        if did and lo and hi:
            out[did.strip()] = (lo.strip(), hi.strip())
    if not out:
        raise RuntimeError("FIRMS data_availability returned nothing (check FIRMS_MAP_KEY)")
    return out


def firms_product(avail: dict, sensor: str, day: str) -> str | None:
    """Standard (SP) product where it exists, else near-real-time (NRT)."""
    for suffix in ("_SP", "_NRT"):
        rng = avail.get(sensor + suffix)
        if rng and rng[0] <= day <= rng[1]:
            return sensor + suffix
    return None


def firms_points(key: str, product: str, first: str, days: int) -> list[tuple[str, float, float]]:
    text = get_text(f"{FIRMS}/area/csv/{key}/{product}/{FIRMS_AREA}/{days}/{first}", wait=10)
    if text.lstrip().lower().startswith(("invalid", "error")):
        raise RuntimeError("FIRMS: " + " ".join(text.split())[:160])
    pts = []
    for row in csv.DictReader(io.StringIO(text)):
        try:
            pts.append((row["acq_date"], float(row["latitude"]), float(row["longitude"])))
        except (KeyError, ValueError):
            continue
    time.sleep(1)
    return pts


def cell(lat: float, lon: float) -> tuple[int, int]:
    return (round(lat / CELL), round(lon / CELL))


def near_static(c: tuple[int, int], static: set) -> bool:
    return any((c[0] + dy, c[1] + dx) in static for dy in (-1, 0, 1) for dx in (-1, 0, 1))


def daterange(first: date, last: date):
    d = first
    while d <= last:
        yield d
        d += timedelta(days=1)


def fetch_fires() -> None:
    key = firms_key()
    avail = firms_availability(key)
    yesterday = date.today() - timedelta(days=1)  # today's passes are still coming in
    start = date.fromisoformat(START)

    sensor = next((s for s in FIRMS_SENSORS
                   if firms_product(avail, s, START) and firms_product(avail, s, yesterday.isoformat())), None)
    if not sensor:
        raise RuntimeError("no VIIRS sensor covers the whole period; available: " + ", ".join(sorted(avail)))

    path, mask_path = DATA / "fires.json", DATA / "firms_static_cells.json"
    rows = {r["date"]: r for r in json.loads(path.read_text(encoding="utf-8"))} if path.exists() else {}
    mask = json.loads(mask_path.read_text(encoding="utf-8")) if mask_path.exists() else None
    if mask and mask.get("sensor") != sensor:
        rows, mask = {}, None  # switched satellites: rebuild everything from one sensor

    # Days to (re)fetch: the whole period on the first run, else the latest 5 days plus any gaps.
    if mask is None:
        first = start
    else:
        missing = [d for d in daterange(start, yesterday) if d.isoformat() not in rows]
        first = min([yesterday - timedelta(days=4)] + missing)

    by_day: dict[str, list[tuple[float, float]]] = {d.isoformat(): [] for d in daterange(first, yesterday)}
    d = first
    while d <= yesterday:
        days = min(5, (yesterday - d).days + 1)
        # Never let one request straddle the SP/NRT boundary.
        product = firms_product(avail, sensor, d.isoformat())
        while days > 1 and firms_product(avail, sensor, (d + timedelta(days=days - 1)).isoformat()) != product:
            days -= 1
        if not product:
            raise RuntimeError(f"no {sensor} data for {d}")
        for day, lat, lon in firms_points(key, product, d.isoformat(), days):
            if day in by_day:
                by_day[day].append((lat, lon))
        d += timedelta(days=days)

    if mask is None:
        prewar = [day for day in by_day if day < WAR_START]
        seen: dict[tuple[int, int], set] = {}
        for day in prewar:
            for lat, lon in by_day[day]:
                seen.setdefault(cell(lat, lon), set()).add(day)
        need = max(2, round(STATIC_SHARE * len(prewar)))
        cells = sorted([list(c) for c, days in seen.items() if len(days) >= need])
        mask = {"sensor": sensor, "cell_degrees": CELL, "built_from": f"{START} to {prewar[-1]}",
                "min_days": need, "cells": cells}
        mask_path.write_text(json.dumps(mask, separators=(",", ":")) + "\n", encoding="utf-8")
        print(f"firms_static_cells.json: {len(cells)} routine flare cells from {len(prewar)} pre-war days")

    static = {tuple(c) for c in mask["cells"]}
    for day, pts in by_day.items():
        outside = sum(1 for lat, lon in pts if not near_static(cell(lat, lon), static))
        rows[day] = {
            "date": day,
            "detections": len(pts),
            "outside_flares": outside,
            "source": f"NASA FIRMS, {sensor.replace('_', ' ')} active fire detections ({firms_product(avail, sensor, day).rsplit('_', 1)[1]})",
        }
    write("fires.json", [rows[k] for k in sorted(rows)])


def main() -> int:
    stale = []
    for name, file, fn in (("brent", "brent.json", fetch_brent), ("hormuz_coverage", "hormuz_coverage.json", fetch_hormuz_coverage),
                           ("fires", "fires.json", fetch_fires)):
        try:
            fn()
        except Exception as err:  # keep going; report at the end
            msg = str(err)
            for var in ("EIA_API_KEY", "FIRMS_MAP_KEY"):
                key = os.environ.get(var, "").strip()
                if key:
                    msg = msg.replace(key, "***")
            print(f"{name}: FAILED - {msg}", file=sys.stderr)
            if is_stale(file):
                stale.append(name)
                print(f"::error title={name} fetch failed, data is stale::{msg}")
            else:
                print(f"::warning title={name} fetch failed, kept the last good data::{msg}")
    if stale:
        print(f"Stale and failing: {', '.join(stale)}.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
