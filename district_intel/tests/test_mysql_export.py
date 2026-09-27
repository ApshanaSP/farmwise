"""MySQL export conversions (no MySQL server needed). Run: python -m pytest -q"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dintel.mysql_export import (DOCUMENT_COLUMNS, convert, decode_int_blobs, infer_column,  # noqa: E402
                                 plan_table, to_ist_naive, trim_documents)


def test_timestamps_become_ist_wall_clock():
    s = pd.Series(["2026-03-31T20:25:01+05:30", "2026-03-31T14:55:01Z", "2024-07-15T00:00:00", None, ""])
    out = to_ist_naive(s)
    assert out[0] == pd.Timestamp("2026-03-31 20:25:01")
    assert out[1] == pd.Timestamp("2026-03-31 20:25:01")      # UTC converted to IST
    assert out[2] == pd.Timestamp("2024-07-15 00:00:00")      # naive values are already IST
    assert out[3:].isna().all()


def test_column_types():
    assert infer_column(pd.Series(["2026-03-31T20:25:01+05:30", None]))[0] == "datetime"
    assert infer_column(pd.Series(["2026-03-31", "2026-04-01"]))[1] == "DATE"
    assert infer_column(pd.Series([0, 1, 1]))[1] == "TINYINT"
    assert infer_column(pd.Series([1.0, np.nan, 14.0]), "INTEGER")[1] == "INT"   # INTEGER with NULLs
    assert infer_column(pd.Series([1.0, np.nan, 14.0]), "REAL")[1] == "DOUBLE"
    assert infer_column(pd.Series(["26 Sep 2026 01:50"]))[0] == "text"
    assert infer_column(pd.Series(["x" * 5000]))[1] in ("TEXT", "MEDIUMTEXT")


def test_int_blobs_are_decoded():
    s = pd.Series([None, (7).to_bytes(8, "little"), 14], dtype=object)
    out = decode_int_blobs(s)
    assert out.tolist()[1:] == [7, 14] and pd.isna(out[0])


def test_wide_tables_stay_under_row_limit():
    df = pd.DataFrame({f"c{i}": ["y" * 200] for i in range(120)})
    plan = plan_table(df, "wide")
    assert sum(int(t[8:-1]) * 4 for _, _, t in plan if t.startswith("VARCHAR")) <= 60000


def test_documents_trimmed_with_fallback():
    df = pd.DataFrame({"doc_id": ["d1"], "canonical_url": [None], "url": ["http://a"], "title_clean": ["drop me"], "title": ["t"]})
    out = trim_documents(df)
    assert out.loc[0, "url"] == "http://a" and "title_clean" not in out.columns
    assert set(out.columns) <= set(DOCUMENT_COLUMNS)


def test_convert_nulls():
    df = pd.DataFrame({"a": [1.5, np.nan, np.inf], "t": ["2026-01-01T00:00:00+05:30", None, ""]})
    rows = convert(df, plan_table(df, "x"))
    assert rows[1] == (None, None) and rows[2] == (None, None)
