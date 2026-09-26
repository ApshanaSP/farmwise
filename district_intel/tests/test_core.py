"""Fast unit tests for the pieces where a silent bug would corrupt data. Run: python -m pytest -q"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dintel import textproc as tp  # noqa: E402
from dintel.agents.briefing import verify  # noqa: E402
from dintel.dedup import bcubed  # noqa: E402
from dintel.geo import WardIndex  # noqa: E402
from dintel.refdata import Reference, severity_level  # noqa: E402
from dintel.util import UnionFind, haversine_m, load_settings  # noqa: E402


@pytest.fixture(scope="module")
def settings():
    return load_settings()


@pytest.fixture(scope="module")
def ref(settings):
    return Reference(settings)


@pytest.fixture(scope="module")
def wards(settings):
    return WardIndex(settings.src("wards_geojson"))


def test_union_find_merges_transitively():
    uf = UnionFind("abcde")
    uf.union("a", "b")
    uf.union("b", "c")
    assert uf.find("a") == uf.find("c")
    assert uf.find("d") != uf.find("a")
    assert sorted(len(g) for g in uf.groups().values()) == [1, 1, 3]


def test_bcubed_perfect_and_split():
    truth = {"a": 1, "b": 1, "c": 2}
    assert bcubed({"a": "x", "b": "x", "c": "y"}, truth)["f1"] == 1.0
    split = bcubed({"a": "x", "b": "y", "c": "z"}, truth)
    assert split["precision"] == 1.0 and split["recall"] < 1.0


def test_haversine_one_degree_latitude():
    assert abs(haversine_m(13.0, 80.2, 14.0, 80.2)[()] - 111_195) < 200


def test_ward_lookup_uses_ward_centroids(wards):
    lat = np.array([w.centroid[0] for w in wards.wards[:20]])
    lon = np.array([w.centroid[1] for w in wards.wards[:20]])
    got = wards.locate(lat, lon)
    assert (got[got > 0] == np.array([w.ward_no for w in wards.wards[:20]])[got > 0]).mean() > 0.9
    far = wards.locate(np.array([12.5]), np.array([79.5]))
    assert far[0] == 0
    missing = wards.locate(np.array([np.nan]), np.array([np.nan]))
    assert missing[0] == -1


def test_all_200_wards_and_15_zones(wards):
    assert len(wards.wards) == 200
    assert len({w.zone_no for w in wards.wards}) == 15


def test_status_crosswalk(ref):
    assert ref.std_status("grievance", "Completed - Pending Collector Verification") == "Awaiting verification"
    assert ref.std_status("police", "UNDER_INVESTIGATION") == "In progress"
    assert ref.std_status("pwd_task", "reopened") == "In progress"
    assert "Lapsed" in ref.status["closed_stages"]


def test_category_crosswalk(ref):
    assert ref.grievance_category("Water Stagnation", "Stagnation of Water")[0] == "FLOOD_WATERLOGGING"
    assert ref.grievance_category("MEGA STREETS - OPERATION PHASE", "Potholes fill up (MC Road)")[0] == "ROAD_DAMAGE"
    assert ref.grievance_category("Garbage", "Broken Bin")[0] == "SOLID_WASTE"
    assert ref.cmap["police"]["MURDER"] == "CRIME_VIOLENT"
    assert ref.hospital_category("Dengue Surge") == "VECTOR_DISEASE"
    assert ref.hospital_category("Bed Capacity Critical") == "HEALTH_SERVICES"


def test_every_mapped_category_exists(ref):
    codes = set(ref.cat)
    mapped = set(ref.cmap["grievance"]["subtype"].values()) | set(ref.cmap["grievance"]["type"].values()) \
        | set(ref.cmap["police"].values()) | set(ref.cmap["pwd"].values())
    assert mapped <= codes, mapped - codes
    assert set(ref.categories["lead_dept"]) <= set(ref.departments["code"])


def test_police_categories_use_response_deadlines(ref):
    assert ref.cat["CRIME_VIOLENT"].get("sla_basis") == "response"
    assert ref.cat["FLOOD_WATERLOGGING"].get("sla_basis", "resolution") == "resolution"


def test_taluk_codes_cover_both_schemes(ref):
    assert ref.taluk_by_pwd["TLK15"] == "TLK-TDP"
    assert ref.taluk_by_police["TLK-TDP"] == "TLK-TDP"
    assert (ref.taluks["in_district"] == 1).sum() == 17


def test_severity_bands():
    assert [severity_level(s) for s in (75, 55, 35, 10)] == ["Severe", "High", "Medium", "Low"]


def test_language_detection():
    assert tp.language_of("Rain water stagnating on our street since morning") == "en"
    assert tp.language_of("மழைநீர் தேங்கி நிற்கிறது") == "ta"
    assert tp.language_of("thanni thengi nikkudhu, romba kashtam") == "tanglish"


def test_text_cues():
    assert "school" in tp.vulnerable_flags("near the government school")
    assert "worship" in tp.vulnerable_flags("பிள்ளையார் கோயில் அருகில்")
    assert tp.hazard("live wire hanging from the pole")
    assert tp.repeat_claim("already complained twice, no action taken")
    assert tp.claimed_age_days("water stagnating for 4 days now") == 4
    assert tp.casualties("Two killed and three injured as lorry rams car") == (2, 3)
    assert tp.is_junk("dfdgfhgresf")
    assert not tp.is_junk("Garbage not cleared near the bus stop for three days")


def test_briefing_verifier_catches_invented_numbers():
    facts = {"kpi": {"incidents": 42, "severe": 5}}
    assert verify("42 incidents, 5 severe.", facts) == []
    assert verify("42 incidents, 17 severe.", facts) == ["17"]
