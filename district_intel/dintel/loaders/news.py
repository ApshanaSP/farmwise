"""News pipeline output -> one document per article, story clusters, report type,
incident gate, casualties, place resolution; incident articles also become events.

Reuses the news pipeline's own Tamil-aware gazetteer matcher (loaded from its file),
extended with police and PWD localities. Nothing in the news pipeline is modified.
"""
from __future__ import annotations

import importlib.util
import json
import re
from collections import Counter

import numpy as np
import pandas as pd
import yaml
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import cross_val_predict

from .. import severity as sev
from .. import textproc as tp
from ..refdata import Reference
from ..schema import DOC_COLUMNS, EVENT_COLUMNS, conform
from ..util import Settings, UnionFind, log, mixed_to_ist, sha256_file, stable_id

PRECISION = {"locality": 1500.0, "zone": 4000.0, "taluk": 4000.0, "district": 15000.0}
GEO_CONF = {"locality": 0.7, "zone": 0.55, "taluk": 0.5, "district": 0.3}
OTHER_DISTRICTS = re.compile(
    r"\b(?:Madurai|Coimbatore|Tiruchi|Trichy|Salem|Tirunelveli|Vellore|Erode|Thoothukudi|Tuticorin|Thanjavur|Dindigul|"
    r"Kanyakumari|Nagapattinam|Cuddalore|Villupuram|Kancheepuram|Tiruvallur|Chengalpattu|Krishnagiri|Dharmapuri|Namakkal|"
    r"Karur|Pudukottai|Ramanathapuram|Sivaganga|Virudhunagar|Theni|Nilgiris|Ooty|Tiruppur|Tiruvannamalai|Ranipet|"
    r"Tirupattur|Kallakurichi|Perambalur|Ariyalur|Mayiladuthurai|Tenkasi|Puducherry|Bengaluru|Hyderabad|Delhi|Mumbai|Kerala|Andhra)\b")

REPORT_TYPE_RULES = [
    ("court", re.compile(r"high court|supreme court|\bbench\b|petition|\bPIL\b|\bHC\b|writ|உயர் நீதிமன்ற|நீதிமன்ற", re.I)),
    ("announcement", re.compile(r"inaugurat|launch|unveil|to be held|will be held|scheme|tender|announced|flagged off|"
                                r"திறந்து வைத்தார்|தொடங்கி வைத்தார்|அறிவிப்பு|அறிவித்த|திட்டம்", re.I)),
    ("politics", re.compile(r"\bDMK\b|AIADMK|\bBJP\b|Congress|\bPMK\b|\bTVK\b|election|candidate|minister said|MLA|"
                            r"தேர்தல்|திமுக|அதிமுக|பாஜக", re.I)),
    ("entertainment_sport", re.compile(r"\bfilm\b|movie|actor|actress|cricket|\bIPL\b|match|tournament|box office|"
                                       r"திரைப்பட|நடிகர்|கிரிக்கெட்", re.I)),
    ("business", re.compile(r"gold rate|gold price|sensex|shares|stock|startup|funding|real estate|தங்கம் விலை", re.I)),
]
CIVIC_COMPLAINT = re.compile(r"residents (complain|allege|demand|say)|woes|apathy|no action|plight|suffer|ordeal|"
                             r"அவதி|அலட்சியம்|புகார்|கோரிக்கை|குற்றச்சாட்டு", re.I)
CRIME = re.compile(r"arrested|police said|FIR|booked|murder|theft|robbery|snatch|கைது|கொலை|திருட்டு", re.I)
STRONG_INCIDENT = re.compile(
    r"waterlog|inundat|flooded|knee-deep|submerged|stagnat|overflow|sewage|cave[ -]?in|caved|sinkhole|collaps|"
    r"fire broke|blaze|gutted|accident|collid|run over|killed|died|injured|electrocut|live wire|power cut|outage|"
    r"garbage|stench|dengue|fever cases|cholera|diarrh|dog bite|stray dog|tree fell|uprooted|road roko|blockade|"
    r"traffic snarl|gridlock|drinking water|water supply|contaminated|pothole|drowned|"
    r"தேங்கி|வெள்ள|மழைநீர்|பள்ளம்|விபத்து|பலி|உயிரிழ|காயம்|தீ விபத்து|இடிந்து|குப்பை|டெங்கு|காய்ச்சல்|மின்தடை|"
    r"மின்சாரம் தாக்கி|சாலை மறியல்|கழிவுநீர்|துர்நாற்றம்|நாய்|மரம் சாய்ந்து|மரம் முறிந்து|குடிநீர்|கொலை|திருட்டு|தீப்பிடித்", re.I)


def _load_gazetteer_module(settings: Settings):
    path = settings.path(settings.raw["sources"]["news"]["package_dir"]) / "src" / "relevance_filter.py"
    spec = importlib.util.spec_from_file_location("news_relevance_filter", path)
    mod = importlib.util.module_from_spec(spec)
    import sys
    sys.modules[spec.name] = mod        # dataclasses look their module up here
    spec.loader.exec_module(mod)
    return mod


def build_gazetteer(settings: Settings, extra_places: pd.DataFrame):
    """The news pipeline's gazetteer plus police and PWD localities (English aliases)."""
    rf = _load_gazetteer_module(settings)
    cfg = yaml.safe_load(settings.src("news", "config").read_text(encoding="utf-8"))["gazetteer"]
    entries = []

    def add(item, category):
        p = rf.Place(name=item["name"], category=category, latitude=item.get("latitude"), longitude=item.get("longitude"),
                     requires_context=bool(item.get("requires_context", False)), gcc_zone=item.get("gcc_zone"))
        aliases = list(item.get("aliases_en") or []) + list(item.get("aliases_ta") or [])
        entries.append((p, aliases, list(item.get("ta_block_suffixes") or [])))
    add(cfg["district"], rf.CATEGORY_DISTRICT)
    known = set()
    for key, cat in (("taluks", rf.CATEGORY_TALUK), ("zones", rf.CATEGORY_ZONE), ("localities", rf.CATEGORY_LOCALITY)):
        for item in cfg.get(key) or []:
            add(item, cat)
            known.add(tp.translit_key(item["name"]))
    ambiguous = {"padi", "ramapuram", "nandanam", "george town", "ashok nagar", "k.k. nagar", "kk nagar", "gandhi nagar", "anna nagar east"}
    for r in extra_places.itertuples():
        key = tp.translit_key(r.name)
        if key in known or len(r.name) < 5:
            continue
        known.add(key)
        add({"name": r.name, "latitude": r.lat, "longitude": r.lon, "aliases_en": [r.name],
             "requires_context": r.name.lower() in ambiguous}, rf.CATEGORY_LOCALITY)
    return rf, rf.Gazetteer(entries)


def _publisher_names(n: pd.DataFrame, ref: Reference) -> dict[str, tuple[str, str, float]]:
    out = {}
    for dom, grp in n.groupby("source_domain"):
        tier, rel, name = ref.publisher_tier(dom)
        if not name:
            names = [s for s in grp["source_name"] if isinstance(s, str) and "." not in s and not s.lower().startswith("google news")]
            name = Counter(names).most_common(1)[0][0] if names else dom
        out[dom] = (name, tier, rel)
    return out


def _stories(docs: pd.DataFrame, threshold: float = 0.55, hours: float = 48) -> np.ndarray:
    """Near-duplicate headlines within 48 h -> one story (char n-gram TF-IDF cosine, chunked)."""
    titles = docs["title"].fillna("").map(tp.normalize)
    vec = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), min_df=2, sublinear_tf=True)
    X = vec.fit_transform(titles)
    t = docs["published_at"].astype("int64").to_numpy() / 3.6e12
    uf = UnionFind(range(len(docs)))
    order = np.argsort(t)
    Xo = X[order]
    to = t[order]
    for start in range(0, len(order), 400):
        stop = min(start + 400, len(order))
        lo = np.searchsorted(to, to[start] - hours)
        hi = np.searchsorted(to, to[stop - 1] + hours, side="right")
        S = (Xo[start:stop] @ Xo[lo:hi].T).toarray()
        ii, jj = np.where(S >= threshold)
        for i, j in zip(ii, jj):
            a, b = start + i, lo + j
            if a < b and abs(to[a] - to[b]) <= hours:
                uf.union(order[a], order[b])
    roots = np.array([uf.find(i) for i in range(len(docs))])
    return roots


def load(settings: Settings, ref: Reference, extra_places: pd.DataFrame) -> dict[str, pd.DataFrame]:
    path = settings.src("news", "master")
    n = pd.read_csv(path, encoding="utf-8-sig", low_memory=False)
    snap = sha256_file(path)
    n["published_at"] = mixed_to_ist(n["published_at_ist"])
    n["fetched_at"] = mixed_to_ist(n["fetched_at_ist"])
    n["body_extracted"] = n["body_extracted"].astype(str).str.lower().eq("true")
    raw_rows = len(n)

    # ---- 1. one document per canonical URL; keep every feed sighting
    n["_rank"] = (~n["body_extracted"]).astype(int) * 2 + (n["source_type"] == "google_news").astype(int)
    n = n.sort_values(["canonical_url", "_rank", "fetched_at"])
    sightings = n.groupby("canonical_url").apply(
        lambda g: json.dumps(sorted({f"{a}|{b}" for a, b in zip(g["source_type"], g["query_used"].fillna(""))}), ensure_ascii=False),
        include_groups=False)
    counts = n.groupby("canonical_url").size()
    first_fetch = n.groupby("canonical_url")["fetched_at"].min()
    d = n.drop_duplicates("canonical_url").copy()
    d["feed_sightings"] = d["canonical_url"].map(sightings)
    d["sightings_count"] = d["canonical_url"].map(counts)
    d["first_fetched_at"] = d["canonical_url"].map(first_fetch)
    unique_urls = len(d)

    # ---- 2. a Google News copy of an article the publisher's own feed also gave us -> merge into the publisher copy
    d["tkey"] = d["title_normalized"].fillna("") + "|" + d["source_domain"].fillna("")
    pub = d[d["source_type"] != "google_news"].drop_duplicates("tkey").set_index("tkey")
    is_g = d["source_type"] == "google_news"
    has_pub = is_g & d["tkey"].isin(pub.index)
    merged_into = d.loc[has_pub, "tkey"].map(pub["canonical_url"])
    extra = d[has_pub].groupby(merged_into)["sightings_count"].sum()
    d = d[~has_pub].copy()
    d["sightings_count"] = d["sightings_count"] + d["canonical_url"].map(extra).fillna(0).astype(int)
    d["publisher_url"] = np.where(d["source_type"] == "google_news", None, d["canonical_url"])
    d["body_status"] = np.where(d["body_extracted"], "full", np.where(d["source_type"] == "google_news", "snippet_google_news", "snippet"))

    # ---- 3. publishers
    pubs = _publisher_names(d, ref)
    d["publisher"] = d["source_domain"].map(lambda x: pubs.get(x, (x, "regional", 0.6))[0])
    d["publisher_tier"] = d["source_domain"].map(lambda x: pubs.get(x, (x, "regional", 0.6))[1])
    d["reliability"] = d["source_domain"].map(lambda x: pubs.get(x, (x, "regional", 0.6))[2])

    d = d.reset_index(drop=True)
    d["doc_id"] = d["article_id"]
    d["title"] = d["title_clean"].fillna(d["title"])
    d["summary"] = d["summary_clean"].fillna("")
    d["body"] = np.where(d["body_extracted"], d["body_clean"], "")
    text = (d["title"].fillna("") + ". " + d["summary"].fillna("") + ". " + d["body"].fillna("")).str.slice(0, 6000)
    d["lang"] = d["language"]
    d["simhash"] = [tp.simhash64(t) for t in d["title"]]

    # ---- 4. story clusters
    roots = _stories(d)
    d["story_id"] = ["STY-" + d.loc[r, "doc_id"][-10:] for r in roots]
    d = d.sort_values("published_at")
    d["story_role"] = np.where(d.groupby("story_id").cumcount() == 0, "first_report", "follow_up")
    d["outlet_count"] = d.groupby("story_id")["publisher"].transform("nunique")
    d = d.sort_index()

    # ---- 5. report type, statewide datelines
    def rtype(t: str) -> str:
        for name, rx in REPORT_TYPE_RULES:
            if rx.search(t):
                return name
        if CRIME.search(t):
            return "crime"
        if CIVIC_COMPLAINT.search(t):
            return "civic_complaint"
        if STRONG_INCIDENT.search(t):
            return "incident"
        return "other"
    d["report_type"] = [rtype(t) for t in text]
    no_local = d["mentioned_taluks"].fillna("[]").eq("[]") & d["mentioned_localities"].fillna("[]").eq("[]")
    d["statewide_dateline"] = (no_local & text.str.contains(OTHER_DISTRICTS)).astype(int)
    d["is_district"] = (1 - d["statewide_dateline"]).astype(int)

    # ---- 6. incident gate: weak labels -> logistic regression on char+word n-grams
    strong = np.array([len(STRONG_INCIDENT.findall(t)) for t in text])
    neg_type = d["report_type"].isin(["announcement", "politics", "entertainment_sport", "business", "court"]).to_numpy()
    weak = np.full(len(d), -1)
    weak[(strong >= 2) & ~neg_type & (d["is_district"] == 1).to_numpy()] = 1
    weak[(strong == 0) & neg_type] = 0
    weak[(strong == 0) & (d["report_type"] == "other").to_numpy()] = 0
    vec = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 5), min_df=3, max_features=150_000, sublinear_tf=True)
    X = vec.fit_transform(text.map(tp.normalize))
    lab = weak >= 0
    clf = LogisticRegression(max_iter=2000, C=4.0, class_weight="balanced")
    cv = cross_val_predict(clf, X[lab], weak[lab], cv=5, method="predict_proba")[:, 1]
    pos_cv = np.sort(cv[weak[lab] == 1])
    thr = float(pos_cv[int(0.05 * len(pos_cv))]) if len(pos_cv) else 0.5   # keeps 95% of weak positives
    clf.fit(X[lab], weak[lab])
    prob = clf.predict_proba(X)[:, 1]
    d["incident_conf"] = prob.round(3)
    gate = (prob >= thr) & (d["is_district"] == 1).to_numpy() & ~d["report_type"].isin(["announcement", "court", "politics", "entertainment_sport", "business"]).to_numpy()
    d["is_incident"] = gate.astype(int)
    d["incident_method"] = f"weak_supervision_logreg(thr={thr:.2f})"
    log.info("news: %d rows -> %d URLs -> %d documents; %d stories; incident gate keeps %d (threshold %.2f, %d weak labels)",
             raw_rows, unique_urls, len(d), d["story_id"].nunique(), int(gate.sum()), thr, int(lab.sum()))

    # ---- 7. category by keywords (the classifier fills the rest later)
    kw = []
    for c in ref.cat.values():
        for k in (c.get("keywords_en") or []):
            kw.append((c["code"], re.compile(r"(?<![A-Za-z])" + re.escape(k), re.I), 2 if " " in k else 1))
        for k in (c.get("keywords_ta") or []):
            kw.append((c["code"], re.compile(re.escape(k)), 2))
    cats, confs = [], []
    for t in text:
        score: Counter = Counter()
        head = t[:300]
        for code, rx, w in kw:
            if rx.search(t):
                score[code] += w * (2 if rx.search(head) else 1)
        if score:
            (best, s1), *rest = score.most_common(2) + [(None, 0)]
            s2 = rest[0][1] if rest else 0
            if s1 >= 2 and s1 > s2:
                cats.append(best); confs.append(round(min(0.95, 0.5 + 0.1 * s1 - 0.05 * s2), 2)); continue
        cats.append(None); confs.append(None)
    d["category_code"] = cats
    d["category_conf"] = confs
    d["category_method"] = np.where(pd.Series(cats).notna(), "keywords", None)
    d["dept_src"] = d["department"].map(ref.cmap["news_department"])

    # ---- 8. places (most specific first-mentioned), casualties
    rf, gaz = build_gazetteer(settings, extra_places)
    order = {"locality": 0, "zone": 1, "taluk": 2, "district": 3}
    places, ptxt, lat, lon, level, conf = [], [], [], [], [], []
    for t in text:
        ms = gaz.find_mentions(t)
        named = [m for m in ms if m.place.category != "district"]
        has_anchor = any(not m.place.requires_context for m in ms)
        named = [m for m in named if not m.place.requires_context or has_anchor]
        places.append("|".join(dict.fromkeys(m.place.name for m in named)))
        if named:
            best = sorted(named, key=lambda m: (order[m.place.category], m.start))[0]
            ptxt.append(best.place.name); lat.append(best.place.latitude); lon.append(best.place.longitude)
            level.append(best.place.category); conf.append(GEO_CONF[best.place.category])
        else:
            ptxt.append("Chennai"); lat.append(13.0827); lon.append(80.2707); level.append("district"); conf.append(GEO_CONF["district"])
    d["places"], d["place_text"], d["lat"], d["lon"], d["geo_level"], d["geo_conf"] = places, ptxt, lat, lon, level, conf
    cas = [tp.casualties(t) for t in text]
    d["dead"] = [c[0] for c in cas]
    d["injured"] = [c[1] for c in cas]
    d["source_kind"] = "news"
    d["_text"] = text
    return {"documents": d, "raw_rows": raw_rows, "unique_urls": unique_urls, "snapshot": snap}


def to_events(d: pd.DataFrame, ref: Reference, snap: str | None) -> pd.DataFrame:
    """Incident articles become events (severity capped at High until confirmed)."""
    x = d[(d["is_incident"] == 1) & d["category_code"].notna() & (d["category_code"] != "OTHER")].copy()
    ev = pd.DataFrame({
        "event_id": "NEWS-" + x["doc_id"], "source": "news", "source_record_id": x["doc_id"],
        "deep_link": x["publisher_url"].fillna(x["canonical_url"]), "snapshot_sha256": snap, "is_synthetic": 0, "is_overlay": 0,
        "occurred_at": x["published_at"], "reported_at": x["published_at"], "time_precision": "published",
        "title": x["title"], "text": x["_text"].str.slice(0, 1200), "lang": x["lang"], "junk_flag": 0, "simhash": x["simhash"],
        "category_src": x["report_type"], "category_code": x["category_code"], "category_conf": x["category_conf"],
        "category_method": x["category_method"], "dept_src": x["department"], "is_actionable": 1,
        "lat": x["lat"], "lon": x["lon"], "loc_precision_m": x["geo_level"].map(PRECISION), "place_text": x["place_text"],
        "geo_level": x["geo_level"], "geo_method": "gazetteer", "geo_conf": x["geo_conf"],
        "dead": x["dead"], "injured": x["injured"],
        "vulnerable_flags": ["|".join(tp.vulnerable_flags(t)) for t in x["_text"]],
        "hazard_flag": [int(tp.hazard(t)) for t in x["_text"]],
        "status_std": "Open", "status_src": "reported", "status_at": x["published_at"], "response_applicable": 0,
        "channel": "media", "source_reliability": x["reliability"], "dup_group_id": "NEWS-" + x["story_id"],
        "ext_ref": x["story_id"], "ext_ref_status": "story",
    })
    ev["lead_dept"] = ev["category_code"].map(lambda c: ref.cat.get(c, ref.cat["OTHER"])["lead"])
    ev = sev.apply(ev, lambda r: sev.from_category(r, ref, cap_unconfirmed=True))
    return conform(ev, EVENT_COLUMNS)
