#!/usr/bin/env python3
"""Build the Persian Gulf Daily Summary site.

Reads data/summaries/*.json and the chart data files, validates them, and writes
static HTML to site/:

    site/index.html              latest summary
    site/YYYY-MM-DD/index.html   one page per summary
    site/archive/index.html
    site/charts/index.html
    site/404.html
    site/assets/, site/data/     copied as-is

Usage:  python build.py            build into ./site
        python build.py --check    validate only, write nothing
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
SUMMARIES = DATA / "summaries"
TEMPLATES = ROOT / "templates"
ASSETS = ROOT / "assets"
OUT = ROOT / "site"

MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

# Chart data files and their fields: name -> (type, nullable)
CHART_FILES = {
    "launches.json": {"date": ("date", False), "launched_since_jul7": ("int", False), "source": ("str", False)},
    "ship_incidents.json": {
        "date": ("date", False),
        "confirmed_incidents": ("int", False),
        "seafarer_deaths": ("int", True),
        "source": ("str", False),
    },
    "casualties.json": {
        "country": ("str", False),
        "killed": ("int", False),
        "injured": ("int", True),
        "as_of": ("date", False),
        "note": ("str", True),
        "source": ("str", False),
    },
    "uae.json": {
        "date": ("date", False),
        "ballistic": ("int", False),
        "cruise": ("int", False),
        "drones": ("int", False),
        "source": ("str", False),
    },
    "opening_wave.json": {
        "country": ("str", False),
        "missiles": ("int", False),
        "drones": ("int", False),
        "source": ("str", False),
    },
}

# Outside data written by scripts/fetch_external.py (see .github/workflows/fetch-data.yml).
# Optional: the site builds without them, and their charts show "Chart data unavailable".
OPTIONAL_CHART_FILES = {
    "brent.json": {"date": ("date", False), "price_usd": ("num", False), "source": ("str", False)},
    "hormuz_coverage.json": {
        "date": ("date", False),
        "articles": ("int", False),
        "all_articles": ("int", True),
        "source": ("str", False),
    },
    "fires.json": {
        "date": ("date", False),
        "detections": ("int", False),
        "outside_flares": ("int", False),
        "source": ("str", False),
    },
}

DASHES = re.compile("[‒–—―]")  # figure, en, em, horizontal bar
HTML_TAG = re.compile(r"<\s*[a-zA-Z/!]")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class BuildError(Exception):
    pass


# ---------------------------------------------------------------- validation


def is_date(value) -> bool:
    if not isinstance(value, str) or not DATE_RE.match(value):
        return False
    try:
        date.fromisoformat(value)
        return True
    except ValueError:
        return False


def check_text(errors: list[str], where: str, value, *, allow_empty=False) -> None:
    if not isinstance(value, str):
        errors.append(f"{where}: expected text, got {type(value).__name__}")
        return
    if not allow_empty and not value.strip():
        errors.append(f"{where}: is empty")
    if DASHES.search(value):
        errors.append(f"{where}: contains an en or em dash; use a hyphen")
    if HTML_TAG.search(value):
        errors.append(f"{where}: contains HTML; text fields must be plain text")


def check_items(errors: list[str], where: str, items, *, depth=0) -> None:
    if not isinstance(items, list):
        errors.append(f"{where}: expected a list")
        return
    for i, item in enumerate(items):
        w = f"{where}[{i}]"
        if not isinstance(item, dict):
            errors.append(f"{w}: expected an object with label and text")
            continue
        unknown = set(item) - {"label", "text", "subitems"}
        if unknown:
            errors.append(f"{w}: unknown field(s) {', '.join(sorted(unknown))}")
        label = item.get("label")
        if label is not None:
            check_text(errors, f"{w}.label", label)
        check_text(errors, f"{w}.text", item.get("text"))
        if item.get("subitems") is not None:
            if depth >= 1:
                errors.append(f"{w}.subitems: only one level of sub-bullets is supported")
            else:
                check_items(errors, f"{w}.subitems", item["subitems"], depth=depth + 1)


def check_url(errors: list[str], where: str, url) -> None:
    if not isinstance(url, str) or not url.startswith("https://"):
        errors.append(f"{where}: must start with https:// (got {url!r})")
    elif "google.com/url" in url:
        errors.append(f"{where}: is a Google redirect wrapper; save the direct article URL")


def validate_summary(path: Path, s) -> list[str]:
    errors: list[str] = []
    name = path.name
    if not isinstance(s, dict):
        return [f"{name}: top level must be a JSON object"]

    required = [
        "date", "title", "window", "generated_at", "top_line", "launches_and_strikes",
        "maritime_and_shipping", "casualties_and_damage", "diplomacy_and_statements",
        "chart_updates", "sources",
    ]
    missing = [k for k in required if k not in s]
    if missing:
        return [f"{name}: missing required field(s): {', '.join(missing)}"]

    if not is_date(s["date"]):
        errors.append(f"{name}: date {s['date']!r} is not a valid YYYY-MM-DD date")
    elif path.stem != s["date"]:
        errors.append(f"{name}: file name must match its date ({s['date']}.json)")

    for key in ("title", "window", "top_line"):
        check_text(errors, f"{name}: {key}", s[key])

    # Usually one paragraph; a list of bullet items is also accepted (the Nov 13 test run used bullets).
    if isinstance(s["casualties_and_damage"], list):
        check_items(errors, f"{name}: casualties_and_damage", s["casualties_and_damage"])
    else:
        check_text(errors, f"{name}: casualties_and_damage", s["casualties_and_damage"])

    # Optional: a short note shown under the window line (e.g. marking a test run),
    # and charts: false for a summary that had no charts section.
    if s.get("note") is not None:
        check_text(errors, f"{name}: note", s["note"])
    if "charts" in s and not isinstance(s["charts"], bool):
        errors.append(f"{name}: charts must be true or false")

    try:
        gen = datetime.fromisoformat(s["generated_at"])
        if gen.utcoffset() not in (timedelta(hours=-8), timedelta(hours=-7)):
            errors.append(f"{name}: generated_at must carry a Pacific offset (-08:00 or -07:00)")
    except (TypeError, ValueError):
        errors.append(f"{name}: generated_at {s['generated_at']!r} is not ISO 8601 with an offset")

    check_items(errors, f"{name}: launches_and_strikes", s["launches_and_strikes"])
    check_items(errors, f"{name}: maritime_and_shipping", s["maritime_and_shipping"])
    check_items(errors, f"{name}: diplomacy_and_statements", s["diplomacy_and_statements"])

    if not isinstance(s["chart_updates"], list):
        errors.append(f"{name}: chart_updates must be a list (empty when nothing changed)")
    else:
        for i, line in enumerate(s["chart_updates"]):
            check_text(errors, f"{name}: chart_updates[{i}]", line)

    if not isinstance(s["sources"], list) or not s["sources"]:
        errors.append(f"{name}: sources must be a non-empty list")
    else:
        for i, src in enumerate(s["sources"]):
            w = f"{name}: sources[{i}]"
            if not isinstance(src, dict):
                errors.append(f"{w}: expected an object with outlet, title, url")
                continue
            check_text(errors, f"{w}.outlet", src.get("outlet"))
            check_text(errors, f"{w}.title", src.get("title"))
            check_url(errors, f"{w}.url", src.get("url"))
    return errors


def validate_chart_file(name: str, rows) -> list[str]:
    errors: list[str] = []
    fields = CHART_FILES.get(name) or OPTIONAL_CHART_FILES[name]
    if not isinstance(rows, list) or not rows:
        return [f"data/{name}: must be a non-empty JSON array"]
    for i, row in enumerate(rows):
        w = f"data/{name}[{i}]"
        if not isinstance(row, dict):
            errors.append(f"{w}: expected an object")
            continue
        for field, (kind, nullable) in fields.items():
            if field not in row:
                errors.append(f"{w}: missing {field}")
                continue
            v = row[field]
            if v is None:
                if not nullable:
                    errors.append(f"{w}.{field}: may not be null")
                continue
            if kind == "int" and (not isinstance(v, int) or isinstance(v, bool) or v < 0):
                errors.append(f"{w}.{field}: expected a whole number >= 0 (missing values are null, never 0)")
            elif kind == "num" and (not isinstance(v, (int, float)) or isinstance(v, bool) or v < 0):
                errors.append(f"{w}.{field}: expected a number >= 0")
            elif kind == "date" and not is_date(v):
                errors.append(f"{w}.{field}: {v!r} is not a valid YYYY-MM-DD date")
            elif kind == "str":
                check_text(errors, f"{w}.{field}", v, allow_empty=(field == "note"))
    return errors


# ---------------------------------------------------------------- helpers


def short_date(iso: str) -> str:
    d = date.fromisoformat(iso)
    return f"{MONTHS_SHORT[d.month - 1]} {d.day}"


def long_date(iso: str) -> str:
    d = date.fromisoformat(iso)
    return f"{d:%B} {d.day}, {d.year}"


def generated_display(iso: str) -> str:
    """'2026-11-17T06:00:52-08:00' -> 'Tuesday, November 17, 2026, 6:00 AM PT'."""
    dt = datetime.fromisoformat(iso)
    hour = dt.hour % 12 or 12
    ampm = "AM" if dt.hour < 12 else "PM"
    return f"{dt:%A}, {dt:%B} {dt.day}, {dt.year}, {hour}:{dt:%M} {ampm} PT"


# End of sentence: . ! or ? plus any closing quotes/brackets, followed by space and a capital or digit.
_SENTENCE_END = re.compile(r"[.!?][\"')”’]*(?=\s+[\"'(“‘]*[A-Z0-9])")


def first_sentence(text: str) -> str:
    text = text.strip()
    m = _SENTENCE_END.search(text)
    return text[: m.end()] if m else text


def load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise BuildError(f"{path.relative_to(ROOT)}: invalid JSON ({e.msg} at line {e.lineno}, column {e.colno})")


# ---------------------------------------------------------------- build


def load_and_validate():
    errors: list[str] = []

    files = sorted(SUMMARIES.glob("*.json"))
    if not files:
        raise BuildError("No summaries found in data/summaries/")

    summaries = []
    for path in files:
        s = load_json(path)
        errs = validate_summary(path, s)
        errors.extend(errs)
        if not errs:
            summaries.append(s)

    for name in CHART_FILES:
        path = DATA / name
        if not path.exists():
            errors.append(f"data/{name}: file is missing")
            continue
        errors.extend(validate_chart_file(name, load_json(path)))
    for name in OPTIONAL_CHART_FILES:
        path = DATA / name
        if path.exists():
            errors.extend(validate_chart_file(name, load_json(path)))

    if errors:
        raise BuildError("Validation failed:\n  - " + "\n  - ".join(errors))

    summaries.sort(key=lambda s: s["date"])
    for s in summaries:
        # Fill optional fields so templates can stay strict about everything else.
        s.setdefault("note", None)
        s.setdefault("charts", True)
        lists = [s["launches_and_strikes"], s["maritime_and_shipping"], s["diplomacy_and_statements"]]
        if isinstance(s["casualties_and_damage"], list):
            lists.append(s["casualties_and_damage"])
        for items in lists:
            for item in items:
                item.setdefault("subitems", None)
                for sub in item["subitems"] or []:
                    sub.setdefault("subitems", None)
        s["short_date"] = short_date(s["date"])
        s["long_date"] = long_date(s["date"])
        s["generated_display"] = generated_display(s["generated_at"])
        s["first_sentence"] = first_sentence(s["top_line"])
        # "Persian Gulf hostilities - 24-hour summary - November 17, 2026" -> kicker + large date
        kicker, sep, main = s["title"].rpartition(" - ")
        s["title_kicker"], s["title_main"] = (kicker, main) if sep else ("", s["title"])
    return summaries


def render_site(summaries) -> list[Path]:
    env = Environment(
        loader=FileSystemLoader(TEMPLATES),
        autoescape=select_autoescape(["html"]),
        undefined=StrictUndefined,
        trim_blocks=True,
        lstrip_blocks=True,
    )
    day = env.get_template("day.html")
    written: list[Path] = []

    def write(rel: str, html: str) -> None:
        if DASHES.search(html):
            raise BuildError(f"Generated page {rel} contains an en or em dash; templates must use hyphens")
        target = OUT / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(html, encoding="utf-8")
        written.append(target)

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()

    for i, s in enumerate(summaries):
        prev = summaries[i - 1] if i > 0 else None
        nxt = summaries[i + 1] if i + 1 < len(summaries) else None
        ctx = dict(s=s, prev=prev, next=nxt, active=None, canonical=f"/{s['date']}/")
        write(f"{s['date']}/index.html", day.render(**ctx))
        if nxt is None:
            write("index.html", day.render(**{**ctx, "active": "latest"}))

    newest_first = list(reversed(summaries))
    write("archive/index.html", env.get_template("archive.html").render(summaries=newest_first, active="archive", canonical="/archive/"))
    write(
        "charts/index.html",
        env.get_template("charts.html").render(data_files=list(CHART_FILES) + [n for n in OPTIONAL_CHART_FILES if (DATA / n).exists()], active="charts", canonical="/charts/"),
    )
    write("ask/index.html", env.get_template("ask.html").render(active="ask", canonical="/ask/"))
    write("404.html", env.get_template("404.html").render(active=None, canonical=None))

    shutil.copytree(ASSETS, OUT / "assets")
    shutil.copytree(DATA, OUT / "data")
    # Index of published summaries, newest first (read by the "Ask the data" Worker).
    index = {"dates": [s["date"] for s in reversed(summaries)]}
    (OUT / "data/summaries/index.json").write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    return written


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="validate data only; do not write site/")
    args = parser.parse_args(argv)

    try:
        summaries = load_and_validate()
        if args.check:
            print(f"OK: {len(summaries)} summaries and {len(CHART_FILES)} chart files are valid.")
            return 0
        written = render_site(summaries)
    except BuildError as e:
        print(f"Build stopped. {e}", file=sys.stderr)
        return 1

    latest = summaries[-1]["date"]
    print(f"Built {len(written)} pages into {OUT.relative_to(ROOT)}/ (latest: {latest}, {len(summaries)} in archive).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
