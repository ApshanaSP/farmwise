"""Shared fixtures: the real config.yaml, so tests exercise the configured gazetteer."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.config import load_config  # noqa: E402
from src.relevance_filter import Gazetteer, RelevanceFilter  # noqa: E402


@pytest.fixture(scope="session")
def cfg() -> dict:
    return load_config(ROOT / "config.yaml")


@pytest.fixture(scope="session")
def gazetteer(cfg: dict) -> Gazetteer:
    return Gazetteer.from_config(cfg["gazetteer"])


@pytest.fixture(scope="session")
def relevance(cfg: dict, gazetteer: Gazetteer) -> RelevanceFilter:
    return RelevanceFilter(gazetteer, cfg["relevance"]["exclusion_phrases"])
