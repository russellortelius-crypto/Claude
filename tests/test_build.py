"""Tests for build.py: validation rules and the add-a-summary publish flow."""

import copy
import json
import shutil
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

import build

ROOT = Path(__file__).resolve().parent.parent
SAMPLE = json.loads((ROOT / "data/summaries/2026-11-17.json").read_text(encoding="utf-8"))


def errors_for(summary, name="2026-11-17.json"):
    return build.validate_summary(Path(name), summary)


class ValidationTests(unittest.TestCase):
    def test_sample_is_valid(self):
        self.assertEqual(errors_for(SAMPLE), [])

    def test_rejects_google_redirect(self):
        s = copy.deepcopy(SAMPLE)
        s["sources"][0]["url"] = "https://www.google.com/url?q=https://example.com/a"
        self.assertTrue(any("Google redirect" in e for e in errors_for(s)))

    def test_rejects_non_https(self):
        s = copy.deepcopy(SAMPLE)
        s["sources"][0]["url"] = "http://example.com/a"
        self.assertTrue(any("https://" in e for e in errors_for(s)))

    def test_rejects_dashes_and_html(self):
        s = copy.deepcopy(SAMPLE)
        s["top_line"] = "Talks resumed — officials said."
        s["casualties_and_damage"] = "None <b>reported</b>."
        errs = errors_for(s)
        self.assertTrue(any("dash" in e for e in errs))
        self.assertTrue(any("HTML" in e for e in errs))

    def test_rejects_missing_field_and_bad_name(self):
        s = copy.deepcopy(SAMPLE)
        del s["window"]
        self.assertTrue(any("missing required field" in e for e in errors_for(s)))
        self.assertTrue(any("must match its date" in e for e in errors_for(SAMPLE, "2026-11-18.json")))

    def test_optional_formats(self):
        s = copy.deepcopy(SAMPLE)
        s["casualties_and_damage"] = [{"label": None, "text": "None reported."}]
        s["maritime_and_shipping"][0]["subitems"] = [{"label": None, "text": "Detail."}]
        s["note"] = "Manual test run."
        s["charts"] = False
        self.assertEqual(errors_for(s), [])
        s["maritime_and_shipping"][0]["subitems"][0]["subitems"] = [{"label": None, "text": "Too deep."}]
        s["charts"] = "no"
        errs = errors_for(s)
        self.assertTrue(any("one level" in e for e in errs))
        self.assertTrue(any("true or false" in e for e in errs))

    def test_all_summaries_valid(self):
        for path in sorted((ROOT / "data/summaries").glob("*.json")):
            with self.subTest(path.name):
                self.assertEqual(build.validate_summary(path, json.loads(path.read_text(encoding="utf-8"))), [])

    def test_chart_rows_null_not_zero(self):
        rows = [{"date": "2026-11-11", "confirmed_incidents": 134, "seafarer_deaths": None, "source": "IMO"}]
        self.assertEqual(build.validate_chart_file("ship_incidents.json", rows), [])
        rows[0]["confirmed_incidents"] = None
        self.assertTrue(build.validate_chart_file("ship_incidents.json", rows))

    def test_formatting(self):
        self.assertEqual(build.generated_display("2026-11-17T06:00:52-08:00"), "Tuesday, November 17, 2026, 6:00 AM PT")
        self.assertEqual(build.first_sentence(SAMPLE["top_line"]),
                         "Iran's IRGC launched another drone attack on Bahrain on Tuesday, claiming a US radar at Sheikh Isa Air Base as the target.")
        self.assertEqual(build.first_sentence('He said "no." Then left.'), 'He said "no."')


class PublishFlowTests(unittest.TestCase):
    """Adding a summary file and running the build publishes a new page with no other edits."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        for d in ("data", "templates", "assets"):
            shutil.copytree(ROOT / d, self.tmp / d)
        self._saved = {k: getattr(build, k) for k in ("ROOT", "DATA", "SUMMARIES", "TEMPLATES", "ASSETS", "OUT")}
        build.ROOT, build.DATA = self.tmp, self.tmp / "data"
        build.SUMMARIES, build.TEMPLATES = self.tmp / "data/summaries", self.tmp / "templates"
        build.ASSETS, build.OUT = self.tmp / "assets", self.tmp / "site"

    def tearDown(self):
        for k, v in self._saved.items():
            setattr(build, k, v)
        shutil.rmtree(self.tmp)

    def _next_day(self):
        """The newest real summary and the day after it, so the test never collides with real data."""
        latest = max(p.stem for p in (self.tmp / "data/summaries").glob("*.json"))
        nxt = date.fromisoformat(latest) + timedelta(days=1)
        return latest, nxt

    def test_new_summary_publishes(self):
        latest, day = self._next_day()
        iso, long = day.isoformat(), f"{day:%B} {day.day}, {day.year}"
        nxt = copy.deepcopy(SAMPLE)
        nxt.update(date=iso, title=f"Persian Gulf hostilities - 24-hour summary - {long}",
                   generated_at=f"{iso}T06:00:10-08:00", top_line="Test day. Second sentence.")
        (self.tmp / f"data/summaries/{iso}.json").write_text(json.dumps(nxt), encoding="utf-8")

        self.assertEqual(build.main([]), 0)
        site = self.tmp / "site"
        home = (site / "index.html").read_text(encoding="utf-8")
        old = (site / f"{latest}/index.html").read_text(encoding="utf-8")
        new = (site / f"{iso}/index.html").read_text(encoding="utf-8")
        archive = (site / "archive/index.html").read_text(encoding="utf-8")

        self.assertIn(long, home)
        self.assertIn(f'href="/{iso}/" rel="next"', old)
        self.assertIn(f'href="/{latest}/" rel="prev"', new)
        self.assertLess(archive.index(iso), archive.index(latest))
        self.assertIn("<p>Test day.</p>", archive)
        self.assertTrue((site / f"data/summaries/{iso}.json").exists())

    def test_invalid_summary_stops_build(self):
        iso = self._next_day()[1].isoformat()
        bad = copy.deepcopy(SAMPLE)
        bad.update(date=iso)
        bad["sources"][0]["url"] = "https://www.google.com/url?q=x"
        (self.tmp / f"data/summaries/{iso}.json").write_text(json.dumps(bad), encoding="utf-8")
        self.assertEqual(build.main([]), 1)
        self.assertFalse((self.tmp / "site").exists())

if __name__ == "__main__":
    unittest.main()


class OutsideDataTests(unittest.TestCase):
    def test_brent_rows(self):
        good = [{"date": "2026-11-17", "price_usd": 84.5, "source": "US EIA"}]
        self.assertEqual(build.validate_chart_file("brent.json", good), [])
        bad = [{"date": "2026-11-17", "price_usd": "84.5", "source": "US EIA"}]
        self.assertTrue(build.validate_chart_file("brent.json", bad))

    def test_coverage_rows(self):
        good = [{"date": "2026-11-17", "articles": 12, "all_articles": None, "source": "GDELT"}]
        self.assertEqual(build.validate_chart_file("hormuz_coverage.json", good), [])
        bad = [{"date": "2026-11-17", "articles": -1, "all_articles": 5, "source": "GDELT"}]
        self.assertTrue(build.validate_chart_file("hormuz_coverage.json", bad))

    def test_fires_rows(self):
        good = [{"date": "2026-11-17", "detections": 400, "outside_flares": 12, "source": "NASA FIRMS"}]
        self.assertEqual(build.validate_chart_file("fires.json", good), [])
        bad = [{"date": "2026-11-17", "detections": 400, "outside_flares": None, "source": "NASA FIRMS"}]
        self.assertTrue(build.validate_chart_file("fires.json", bad))
