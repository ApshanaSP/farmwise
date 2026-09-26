"""Tests for the Chennai relevance filter and location features."""
from __future__ import annotations

from src.relevance_filter import location_features


def test_keeps_plain_chennai_mention(relevance):
    result = relevance.evaluate("Heavy rain lashes Chennai; schools closed")
    assert result.is_relevant and result.reason == "matched"


def test_keeps_madras(relevance):
    assert relevance.evaluate("Madras High Court seeks report on encroachments").is_relevant


def test_tamil_with_case_suffix(relevance):
    assert relevance.evaluate("சென்னையில் இன்று கனமழை").is_relevant


def test_tamil_inflected_pulli_ending(relevance, gazetteer):
    # மயிலாப்பூர் -> மயிலாப்பூரில் ("in Mylapore"): pulli replaced by a vowel sign.
    names = [m.place.name for m in gazetteer.find_mentions("மயிலாப்பூரில் கோயில் திருவிழா")]
    assert names == ["Mylapore"]


def test_rejects_unrelated(relevance):
    result = relevance.evaluate("Coimbatore corporation opens new bus stand")
    assert not result.is_relevant and result.reason == "no_gazetteer_mention"


def test_rejects_only_chennai_super_kings(relevance):
    result = relevance.evaluate("Chennai Super Kings retain captain ahead of auction")
    assert not result.is_relevant
    assert result.reason == "only_excluded_phrases"
    assert result.excluded_phrases == ["Chennai Super Kings"]


def test_csk_article_that_names_a_locality_is_kept(relevance):
    result = relevance.evaluate("Chennai Super Kings fans throng Chepauk; traffic diverted in Triplicane")
    assert result.is_relevant
    assert [m.place.name for m in result.mentions] == ["Chepauk", "Triplicane"]


def test_chennaiyin_does_not_match_chennai(relevance):
    assert not relevance.evaluate("Chennaiyin FC sign new striker").is_relevant


def test_madurai_bench_excluded(relevance):
    result = relevance.evaluate("Madurai Bench of Madras High Court quashes FIR in Theni")
    assert not result.is_relevant and result.reason == "only_excluded_phrases"


def test_context_dependent_place_alone_is_rejected(relevance):
    result = relevance.evaluate("Man beaten to death in East Delhi's Ashok Nagar")
    assert not result.is_relevant
    assert result.reason == "only_context_dependent_places"
    assert result.context_only_places == ["Ashok Nagar"]


def test_context_dependent_place_with_chennai_is_kept(relevance):
    assert relevance.evaluate("Four arrested for robbery in Ashok Nagar, Chennai").is_relevant


def test_himachal_manali_excluded_but_chennai_manali_kept(relevance):
    assert not relevance.evaluate("Snowfall shuts Kullu-Manali highway").is_relevant
    assert relevance.evaluate("College student knocked down by truck in Manali").is_relevant


def test_kolathur_taluk_matches(relevance):
    assert relevance.evaluate("Kolathur residents protest over water supply").is_relevant


def test_manali_tamil_block_suffix(gazetteer):
    # மணலில் = "in the sand", not the Manali zone.
    assert gazetteer.find_mentions("மணலில் புதைந்த") == []
    assert [m.place.name for m in gazetteer.find_mentions("மணலியில் தீ விபத்து")] == ["Manali"]


def test_spelling_variants(gazetteer):
    text = "Works at T.Nagar, Purasaiwakkam and Tiruvottiyur"
    assert [m.place.name for m in gazetteer.find_mentions(text)] == ["T. Nagar", "Purasawalkam", "Thiruvottiyur"]


def test_location_features_lists_all_places_in_order(relevance, gazetteer):
    text = "Velachery and Adyar flooded; Chennai Corporation deploys pumps in Mylapore and Velachery"
    result = relevance.evaluate(text)
    feats = location_features(result.mentions, gazetteer, include_district=True)
    assert feats["mentioned_taluks"] == ["Velachery", "Mylapore"]
    assert feats["mentioned_localities"] == ["Adyar"]
    assert feats["first_mentioned_place"] == "Velachery"
    assert feats["latitude"] == gazetteer.places["Velachery"].latitude


def test_first_place_can_be_district(relevance, gazetteer):
    result = relevance.evaluate("Chennai: Metro work in Guindy")
    with_district = location_features(result.mentions, gazetteer, include_district=True)
    without_district = location_features(result.mentions, gazetteer, include_district=False)
    assert with_district["first_mentioned_place"] == "Chennai"
    assert without_district["first_mentioned_place"] == "Guindy"


def test_greater_chennai_corporation_counted_once(gazetteer):
    mentions = gazetteer.find_mentions("Greater Chennai Corporation budget")
    assert len(mentions) == 1 and mentions[0].matched_text == "Greater Chennai Corporation"
