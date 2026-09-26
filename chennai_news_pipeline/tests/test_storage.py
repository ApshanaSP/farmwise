"""Tests for master_news.csv updates: same-day replacement and the rolling window."""
from __future__ import annotations

import csv
from datetime import date

from src.storage import update_master

COLS = ["article_id", "fetched_at_ist", "published_date", "title"]


def _row(article_id: str, published: str, fetched: str = "2026-09-25T06:30:00+05:30") -> dict:
    return {"article_id": article_id, "fetched_at_ist": fetched, "published_date": published, "title": article_id}


def _read(path) -> list[str]:
    with open(path, encoding="utf-8-sig", newline="") as fh:
        return [r["article_id"] for r in csv.DictReader(fh)]


def test_rolling_window_drops_old_rows_and_keeps_recent(tmp_path):
    master = tmp_path / "master_news.csv"
    old = [_row("20260924-a", "2026-06-26"), _row("20260924-b", "2026-06-27"), _row("20260924-c", "2026-09-20")]
    update_master(master, old, COLS, "20260924-")

    total, dropped = update_master(master, [_row("20260925-d", "2026-09-25")], COLS, "20260925-",
                                   keep_since=date(2026, 6, 27))
    assert _read(master) == ["20260924-b", "20260924-c", "20260925-d"]
    assert (total, dropped) == (3, 1)


def test_rolling_window_applies_to_new_rows_and_uses_fetch_date_when_unpublished(tmp_path):
    master = tmp_path / "master_news.csv"
    rows = [
        _row("20260925-old-republish", "2026-05-18"),
        _row("20260925-no-date", "", fetched="2026-09-25T06:30:00+05:30"),
    ]
    total, dropped = update_master(master, rows, COLS, "20260925-", keep_since=date(2026, 6, 27))
    assert _read(master) == ["20260925-no-date"]
    assert dropped == 1


def test_same_day_rerun_replaces_instead_of_appending(tmp_path):
    master = tmp_path / "master_news.csv"
    update_master(master, [_row("20260925-x", "2026-09-25")], COLS, "20260925-")
    update_master(master, [_row("20260925-y", "2026-09-25")], COLS, "20260925-")
    assert _read(master) == ["20260925-y"]


def test_no_window_keeps_everything(tmp_path):
    master = tmp_path / "master_news.csv"
    total, dropped = update_master(master, [_row("20260925-a", "2020-01-01")], COLS, "20260925-", keep_since=None)
    assert (total, dropped) == (1, 0)
