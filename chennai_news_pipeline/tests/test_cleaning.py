"""Tests for text and date cleaning."""
from __future__ import annotations

import time
from datetime import datetime
from zoneinfo import ZoneInfo

from src.cleaning import clean_text, normalize_title, parse_datetime, strip_source_suffix, to_timezone
from src.features import detect_language, text_features

IST = ZoneInfo("Asia/Kolkata")


def test_strips_html_and_entities():
    raw = '<p>Rain &amp; flooding in <b>Velachery</b></p><script>var x=1;</script>'
    assert clean_text(raw) == "Rain & flooding in Velachery"


def test_double_escaped_entities():
    assert clean_text("Water &amp;amp; power") == "Water & power"
    assert clean_text("&lt;b&gt;Bold&lt;/b&gt; text") == "Bold text"


def test_whitespace_and_unicode_normalisation():
    raw = "Chennai\u00a0\u00a0rains\u200b\n\n  continue\tfor\u3000two days"
    assert clean_text(raw) == "Chennai rains continue for two days"


def test_none_and_empty():
    assert clean_text(None) == ""
    assert clean_text("   ") == ""


def test_tamil_text_preserved():
    assert clean_text("<p>சென்னையில்  கனமழை</p>") == "சென்னையில் கனமழை"


def test_title_normalized_lowercase_no_punctuation():
    assert normalize_title("Chennai: GCC to clear 'garbage' by Friday!") == "chennai gcc to clear garbage by friday"


def test_title_normalized_keeps_tamil_vowel_signs():
    # Vowel signs / pulli are Unicode marks, not punctuation.
    assert normalize_title("சென்னையில் கனமழை!") == "சென்னையில் கனமழை"


def test_strip_google_source_suffix():
    assert strip_source_suffix("Metro work delayed - The Hindu", "The Hindu") == "Metro work delayed"
    assert strip_source_suffix("Metro work delayed", "The Hindu") == "Metro work delayed"


def test_rfc822_gmt_to_ist():
    dt = to_timezone(parse_datetime("Mon, 21 Sep 2026 14:40:40 GMT", IST), IST)
    assert dt.isoformat() == "2026-09-21T20:10:40+05:30"


def test_iso_with_offset_and_naive():
    assert to_timezone(parse_datetime("2026-09-23T22:40:00+05:30", IST), IST).hour == 22
    naive = parse_datetime("2026-09-23 10:00:00", IST)
    assert naive.utcoffset().total_seconds() == 5.5 * 3600


def test_struct_time_is_utc():
    st = time.struct_time((2026, 9, 24, 0, 0, 0, 3, 267, 0))
    assert to_timezone(parse_datetime(st, IST), IST) == datetime(2026, 9, 24, 5, 30, tzinfo=IST)


def test_unparseable_date():
    assert parse_datetime("not a date", IST) is None
    assert parse_datetime("", IST) is None


def test_language_detection():
    assert detect_language("சென்னையில் இன்று கனமழை பெய்தது", 0.3, 0.95, 120) == "ta"
    assert detect_language("Heavy rain lashes several parts of Chennai on Thursday", 0.3, 0.95, 120) == "en"
    assert detect_language("Legend Saravana plans Chennai's biggest store", 0.3, 0.95, 120) == "en"
    assert detect_language("चेन्नई में भारी बारिश", 0.3, 0.95, 120) == "other"


def test_full_text_does_not_repeat_title_only_summary():
    feats = text_features("Power shutdown in Guindy", "Power shutdown in Guindy")
    assert feats["full_text"] == "Power shutdown in Guindy"
    assert feats["word_count"] == 4
    assert text_features("T", "Body text")["full_text"] == "T\nBody text"
