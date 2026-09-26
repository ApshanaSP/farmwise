"""Tests for the shared rain calendar, hand-label weighting and news notice detection."""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dintel import sync  # noqa: E402
from dintel.loaders.news import REPORT_TYPE_RULES, _wmetrics  # noqa: E402
from dintel.util import REF_DIR, load_settings  # noqa: E402


def test_rain_calendar_comes_from_police_config():
    days = sync.world_rain_days(load_settings(), date(2026, 4, 1), date(2026, 9, 27))
    heavy = [d for d, k in days.items() if k == "heavy"]
    assert "2026-08-09" in heavy and "2026-09-19" in heavy
    assert all(date(2026, 4, 1) <= date.fromisoformat(d) <= date(2026, 9, 27) for d in days)


def test_weighted_metrics_use_stratum_weights():
    y = np.array([1, 0, 1, 0])
    pred = np.array([True, True, False, False])
    w = np.array([1.0, 1.0, 10.0, 1.0])            # the missed positive stands for 10 articles
    m = _wmetrics(pred, y, w, np.zeros(4, bool))
    assert m["precision"] == 0.5
    assert abs(m["recall"] - 1 / 11) < 1e-3


def test_power_cut_notices_are_not_incidents():
    notice = dict(REPORT_TYPE_RULES)["service_notice"]
    assert notice.search("Chennai Power Cut Today: Check Affected Areas, Timings")
    assert notice.search("சென்னையில் நாளை மின்தடை ஏற்படும் இடங்கள்")
    assert not notice.search("Official apathy led to power outage for a month, allege Pulianthope families")


def test_hand_labels_are_complete():
    g = pd.read_csv(REF_DIR / "labels" / "news_incident_labels.csv", encoding="utf-8-sig")
    assert len(g) == 300 and g["doc_id"].is_unique
    assert set(g["label_incident"]) <= {0, 1}
    assert set(g["stratum"]) == {"gate_yes", "gate_no_borderline", "gate_no_low"}
