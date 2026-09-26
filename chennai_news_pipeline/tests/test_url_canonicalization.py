"""Tests for URL canonicalisation and offline Google News decoding."""
from __future__ import annotations

import base64

from src.cleaning import canonicalize_url, decode_google_news_url, domain_of

PARAMS = ["fbclid", "gclid", "oc", "ref"]
PREFIXES = ["utm_"]


def _old_style_google_link(target: str) -> str:
    payload = b'\x08\x13"' + bytes([len(target)]) + target.encode() + b"\xd2\x01\x00"
    token = base64.urlsafe_b64encode(payload).decode().rstrip("=")
    return f"https://news.google.com/rss/articles/{token}?oc=5"


def test_removes_tracking_params_and_fragment():
    url = "https://www.TheHindu.com/news/cities/chennai/article1.ece?utm_source=rss&utm_medium=x&fbclid=abc#comments"
    assert canonicalize_url(url, PARAMS, PREFIXES) == "https://www.thehindu.com/news/cities/chennai/article1.ece"


def test_keeps_and_sorts_real_params():
    url = "https://example.com/story?id=5&utm_campaign=z&page=2"
    assert canonicalize_url(url, PARAMS, PREFIXES) == "https://example.com/story?id=5&page=2"
    shuffled = "https://example.com/story?page=2&id=5"
    assert canonicalize_url(shuffled, PARAMS, PREFIXES) == "https://example.com/story?id=5&page=2"


def test_drops_default_port_and_lowercases_scheme():
    assert canonicalize_url("HTTPS://Example.com:443/a", PARAMS, PREFIXES) == "https://example.com/a"
    assert canonicalize_url("http://example.com:8080/a", PARAMS, PREFIXES) == "http://example.com:8080/a"


def test_empty_url():
    assert canonicalize_url("", PARAMS, PREFIXES) == ""


def test_decodes_old_style_google_news_link():
    target = "https://www.dtnext.in/news/chennai/some-story-123"
    link = _old_style_google_link(target)
    assert decode_google_news_url(link) == target
    assert canonicalize_url(link, PARAMS, PREFIXES) == target


def test_new_style_google_link_left_unresolved_without_tracking():
    link = ("https://news.google.com/rss/articles/CBMicEFVX3lxTFBWRVBRcHRVY2ljY3FBTjlEVk1YX1ptbFNoMnky"
            "ZG5KTU9HTTJKajFiZVJCXzNuc1hPeVctYl91U2hZRkJMUVRRMW1nZjdFbmxfUUt4SVdhWWRfYlU1NFRqc0U0LWFCYjFTbjdsWGpLZjQ?oc=5")
    assert decode_google_news_url(link) is None
    canonical = canonicalize_url(link, PARAMS, PREFIXES)
    assert canonical.startswith("https://news.google.com/rss/articles/CBMi")
    assert "oc=" not in canonical


def test_non_google_url_not_decoded():
    assert decode_google_news_url("https://www.thehindu.com/x") is None


def test_domain_of():
    assert domain_of("https://www.thehindu.com/news/") == "thehindu.com"
    assert domain_of("https://timesofindia.indiatimes.com/city") == "timesofindia.indiatimes.com"
    assert domain_of("") == ""
