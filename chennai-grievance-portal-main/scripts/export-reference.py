"""Copy the pipeline's category keywords, taluk names and the news monitor's place gazetteer into the portal
(data/gcc-reference/intel-reference.json).

The console uses them to classify and place items from sources the Collector adds and from OCR'd newspaper pages.
Run after editing district_intel/reference/categories.yaml or taluks.yaml, or the gazetteer in
chennai_news_pipeline/config.yaml:  python scripts/export-reference.py
"""
import json
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT.parent / "district_intel" / "reference"
cats = yaml.safe_load((SRC / "categories.yaml").read_text(encoding="utf8"))
tal = yaml.safe_load((SRC / "taluks.yaml").read_text(encoding="utf8"))
# Localities, zones and taluks with approximate centroids and English/Tamil aliases (read only).
gaz = yaml.safe_load((ROOT.parent / "chennai_news_pipeline" / "config.yaml").read_text(encoding="utf8"))["gazetteer"]
out = {
    "source": "district_intel/reference/categories.yaml, taluks.yaml and the chennai_news_pipeline gazetteer (copied; re-run scripts/export-reference.py after editing them)",
    "categories": [{k: c.get(k) for k in ["code", "label", "family", "lead", "base_severity", "playbook", "keywords_en", "keywords_ta"]} for c in cats],
    "taluks": [{"code": t["code"], "name": t["name"], "name_ta": t.get("name_ta"), "in_district": t.get("in_district", True)} for t in tal],
    "places": [
        {"name": p["name"], "kind": kind, "lat": p["latitude"], "lon": p["longitude"], "zone": p.get("gcc_zone"),
         "aliases_en": p.get("aliases_en") or [p["name"]], "aliases_ta": p.get("aliases_ta") or [],
         "requires_context": bool(p.get("requires_context", False))}
        for kind, key in [("locality", "localities"), ("zone", "zones"), ("taluk", "taluks")] for p in gaz.get(key) or []
    ],
}
(ROOT / "data" / "gcc-reference" / "intel-reference.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf8")
print(f"{len(out['categories'])} categories, {len(out['taluks'])} taluks, {len(out['places'])} gazetteer places")
