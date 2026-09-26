"""Tests for department classification and complaint detection."""
from __future__ import annotations

import copy
import json

import pytest

from src.classification import LLMClassifier, NewsClassifier, term_pattern


@pytest.fixture(scope="module")
def classifier(cfg, tmp_path_factory) -> NewsClassifier:
    cls_cfg = copy.deepcopy(cfg["classification"])
    cls_cfg["embedding_model"]["enabled"] = False  # keep unit tests fast and deterministic
    cache = tmp_path_factory.mktemp("cls") / "cache.json"
    return NewsClassifier(cls_cfg, env={}, cache_path=cache)


def _row(title: str, body: str = "", language: str = "en") -> dict:
    return {"article_id": title[:20], "title_clean": title, "summary_clean": "", "body_clean": body,
            "language": language}


def _classify(classifier: NewsClassifier, title: str, body: str = "", language: str = "en") -> dict:
    row = _row(title, body, language)
    classifier.annotate([row])
    return row


@pytest.mark.parametrize(
    "title, expected",
    [
        ("Garbage piles up on Velachery streets", "Solid Waste Management Department"),
        ("Waterlogging in Mylapore after overnight rain", "Storm Water Drain Department"),
        ("Flyover work in Guindy to finish by March", "Bridges Department"),
        ("Dengue cases rise in Chennai; fogging intensified", "Health Department"),
        ("Street lights not working on Anna Salai", "Electrical Department"),
        ("Corporation schools to get smart classrooms", "Education Department"),
        ("GCC to renovate Tower Park in Anna Nagar", "Parks & Play Fields Department"),
        ("Property tax collection crosses target", "Revenue Department"),
        ("Council meeting: Mayor announces new ward committees", "General Administration"),
        ("Corporation budget: funds allocated for roads", "Financial Management Unit"),
        ("Pregnant women get free antenatal check-ups", "Family Welfare Department"),
        ("Public toilet in Egmore lies dilapidated", "Buildings Department"),
        ("GCC buys 50 new garbage compactor vehicles", "Mechanical Engineering Department"),
        ("Encroachment on government land in Velachery removed; land retrieved", "Land & Estate Department"),
        ("Illegal construction sealed for violating building plan", "Engineering Department (Town Planning & Building Permissions)"),
    ],
)
def test_english_departments(classifier, title, expected):
    row = _classify(classifier, title)
    assert row["department"] == expected
    assert row["department_method"] == "keyword"


def test_tamil_department_and_complaint(classifier):
    row = _classify(classifier, "வேளச்சேரியில் மழைநீர் தேங்கி மக்கள் அவதி", language="ta")
    assert row["department"] == "Storm Water Drain Department"
    assert row["is_complaint"] is True


def test_tamil_inflected_bridge(classifier):
    assert _classify(classifier, "கிண்டி மேம்பாலத்தில் விரிசல்", language="ta")["department"] == "Bridges Department"


def test_acronym_is_case_sensitive():
    assert term_pattern("ROB").search("New ROB at Perambur")
    assert not term_pattern("ROB").search("Men rob jewellery shop")


def test_park_does_not_match_parking():
    assert not term_pattern("park").search("Parking fee hiked at Marina")
    assert term_pattern("park").search("New parks opened")


def test_unmatched_article_falls_back(classifier):
    row = _classify(classifier, "Actor's new film releases this Friday")
    assert row["department"] == "General Administration"
    assert row["department_method"] == "fallback"
    assert row["department_confidence"] == 0.0


def test_department_evidence_lists_matched_terms(classifier):
    row = _classify(classifier, "Garbage piles up near dump yard in Perungudi")
    evidence = json.loads(row["department_evidence"])
    assert "garbage" in evidence and "dump yard" in evidence


@pytest.mark.parametrize(
    "title, expected",
    [
        ("Residents complain of overflowing sewage in Perambur", True),
        ("Potholed roads leave commuters in Tambaram fuming", True),
        ("No action despite complaints about stray dog menace in Adyar", True),
        ("Minister inaugurates new park in Anna Nagar", False),
        ("Man arrested for murder in Royapuram", False),
        ("Corporation budget presented for 2026-27", False),
    ],
)
def test_complaint_detection(classifier, title, expected):
    row = _classify(classifier, title)
    assert row["is_complaint"] is expected
    assert row["complaint_method"] == "rules"


class _FakeResponse:
    def __init__(self, content: str) -> None:
        self._content = content

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return {"choices": [{"message": {"content": self._content}}]}


def test_llm_answers_are_validated_and_cached(cfg, tmp_path, monkeypatch):
    cls_cfg = copy.deepcopy(cfg["classification"])
    llm_cfg = dict(cls_cfg["llm"], fallback_department=cls_cfg["fallback_department"])
    answer = {"results": [
        {"id": "a", "department": "Bridges Department", "is_complaint": True},
        {"id": "b", "department": "Traffic Police", "is_complaint": False},  # not in list -> dropped
    ]}
    calls = []

    def fake_post(*args, **kwargs):
        calls.append(kwargs)
        return _FakeResponse(json.dumps(answer))

    monkeypatch.setattr("src.classification.requests.post", fake_post)
    llm = LLMClassifier(llm_cfg, "sk-test", cls_cfg["departments"], tmp_path / "cache.json")
    out = llm.classify([("a", "Flyover crack in Guindy"), ("b", "Traffic diversion on OMR")])
    assert out == {"a": {"department": "Bridges Department", "is_complaint": True}}
    assert len(calls) == 1

    # Second call: "a" comes from the cache, only "b" is sent again.
    llm2 = LLMClassifier(llm_cfg, "sk-test", cls_cfg["departments"], tmp_path / "cache.json")
    out2 = llm2.classify([("a", "Flyover crack in Guindy"), ("b", "Traffic diversion on OMR")])
    assert out2["a"]["department"] == "Bridges Department"
    sent = json.loads(calls[-1]["json"]["messages"][1]["content"])
    assert [item["id"] for item in sent] == ["b"]


def test_llm_used_when_key_present(cfg, tmp_path, monkeypatch):
    cls_cfg = copy.deepcopy(cfg["classification"])
    cls_cfg["embedding_model"]["enabled"] = False
    monkeypatch.setattr(
        "src.classification.requests.post",
        lambda *a, **k: _FakeResponse(json.dumps({"results": [
            {"id": "x1", "department": "Health Department", "is_complaint": False}]})),
    )
    clf = NewsClassifier(cls_cfg, env={"OPENAI_API_KEY": "sk-test"}, cache_path=tmp_path / "c.json")
    row = {"article_id": "x1", "title_clean": "Garbage piles up", "summary_clean": "", "body_clean": "", "language": "en"}
    clf.annotate([row])
    assert row["department"] == "Health Department"
    assert row["department_method"] == "llm"
    assert row["complaint_method"] == "llm"


@pytest.mark.parametrize(
    "title",
    [
        "Chennai Power Cut on July 14: Over 77 Areas to Face 5-Hour Outage; Check Full List",
        "TN CM meets rapper Arivu following Chennai Police detention at NEET protest",
        "SI, constable transferred over assault complaint by college student in Chennai",
        "TNPDCL grievance meetings to be held in 4 Chennai divisions on September 1",
    ],
)
def test_not_complaints_regressions(classifier, title):
    assert _classify(classifier, title)["is_complaint"] is False


def test_citizen_connect_is_complaint(classifier):
    row = _classify(classifier, "Chennai Citizen Connect: Excavated road, damaged sewage chamber irks Tondiarpet residents")
    assert row["is_complaint"] is True


@pytest.mark.parametrize(
    "title, expected",
    [
        ("Street dog in Besant Nagar 'stolen'", "Health Department"),
        ("Electric Bike Rental Service Introduced At Chennai Central", "General Administration"),
        ("Chennai Metro to Develop Rs 400 Crore Commercial Hub", "General Administration"),
    ],
)
def test_department_regressions(classifier, title, expected):
    assert _classify(classifier, title)["department"] == expected


@pytest.mark.parametrize(
    "title, language, expected",
    [
        # Sandhi: உணவுத் திட்டம் must match the configured காலை உணவு திட்டம்.
        ("விரிவுபடுத்தப்பட்ட காலை உணவுத் திட்டம் இன்று தொடக்கம்", "ta", "Education Department"),
        # A single generic word no longer decides the department.
        ("Elder Brothers Kill Mother Over Property Dispute In Chennai", "en", "General Administration"),
        ("3 Youth Arrested For Bike Racing On 100-Feet Road", "en", "General Administration"),
    ],
)
def test_masking_sandhi_and_strong_term_rule(classifier, title, language, expected):
    assert _classify(classifier, title, language=language)["department"] == expected


def test_place_name_masked_before_matching(classifier):
    # பள்ளிக்கரணை (Pallikaranai) starts with பள்ளி ("school"): must not become Education.
    row = _classify(classifier, "பள்ளிக்கரணை ஆக்கிரமிப்பு: முதலமைச்சர் தலையிட வேண்டும்", language="ta")
    assert row["department"] != "Education Department"


def test_patta_kathi_is_not_land_deed(classifier):
    row = _classify(classifier, "சென்னையில் பட்டாக் கத்திகளுடன் சுற்றிய கும்பல் கைது", language="ta")
    assert row["department"] != "Revenue Department"


def test_tamil_power_cut_notice_not_complaint(classifier):
    title = "சென்னையில் முக்கிய பகுதிகளில் நாளை மின்தடை... உங்க ஏரியா லிஸ்ட்ல இருக்கா பாருங்க"
    row = _classify(classifier, title, language="ta")
    assert row["department"] == "Electrical Department"
    assert row["is_complaint"] is False


def test_complaint_with_single_weak_term_gets_department(classifier):
    row = _classify(classifier, "Chennai Citizen Connect: Motorists at risk on crumbling roads in Perambur")
    assert row["is_complaint"] is True
    assert row["department"] == "Engineering Department (Town Planning & Building Permissions)"
