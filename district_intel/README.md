# District Intelligence data layer

Turns the outputs of every collector and generator in this repository into one
curated, traceable, dashboard-ready store for the Chennai Collector's dashboard
(FarmwiseAI Task 6).

**It never edits a source.** The collectors keep their own fetching methods (RSS,
REST, Playwright, generators). This layer reads their output files, and
`run_pipeline.py refresh` calls their existing command lines on a schedule.

```bash
cd district_intel
pip install -r requirements.txt
python run_pipeline.py build              # about 2 minutes on a laptop
python -m pytest -q tests                 # 14 fast tests
python run_pipeline.py refresh            # run the sources that are due, then build
python run_pipeline.py watch --every 15   # keep refreshing and rebuilding
```

`scripts/run_intel.bat` runs `refresh` for Windows Task Scheduler (the command to
register it is in the file).

## What it produces (`output/`, git-ignored)

| Path | What |
|---|---|
| `district_intel.db` | SQLite store: 32 tables and 6 views (below). The dashboard can read it directly. |
| `curated/*.csv` | The same tables as CSV (UTF-8 with BOM so Excel shows Tamil). |
| `dashboard/*.json` | Feeds shaped for the dashboard tiles: `incidents.json`, `incident_details.json`, `kpis.json`, `alerts.json`, `briefings.json`, `environment.json`, `hotspots.json`, `gaps.json`, `trends.json`, `source_health.json`, `wards.geojson`, `zone_outlines.geojson`, `meta.json`. |
| `reports/evaluation.md` | Measured accuracy of every AI step. |
| `reports/data_quality.md` | Source health, the data contract, drift. |
| `reports/briefing_{daily,weekly,monthly,quarterly}.md` | Collector briefings with verified numbers. |
| `truth/cross_source_truth.csv` | Ground truth written by the scenario overlay (never read by the linker). |

### Main tables

| Table | One row per | Notes |
|---|---|---|
| `events` | source record (complaint, police report, PWD incident, hospital alert episode, IMD warning, news incident) | 70 canonical columns: time, text, category, location keys, impact, severity, status, provenance |
| `incidents` | real-world incident | cross-source roll-up with priority (computed at `as_of`, with reasons), deadline, attention flag |
| `incident_members`, `incident_timeline` | member record / timeline step | the evidence panel and merged timeline |
| `actions` | task | PWD tasks (real) plus playbook drafts from the Action Planner agent |
| `documents` | news article, PWD announcement, CFM bulletin | story clusters, report type, incident gate |
| `observations`, `observation_signals` | metric reading / latest value per series | hospitals, lakes, reservoirs, IMD, CPCB, gauges (with quality flags) |
| `kpis`, `daily_counts`, `anomalies`, `hotspots` | KPI tile / count / spike / cluster | all numbers come from here, never from a model |
| `alerts`, `briefings`, `gaps`, `review_queue` | agent outputs | drafts and suggestions; people decide |
| `source_health`, `data_quality`, `quarantine`, `category_drift` | Data Steward outputs | |
| `ref_*` | reference masters | wards (with taluk, low-lying index, Gi*), taluks, departments, categories, facilities, offices |
| `world_calendar` | day | rain days from every source plus IMD, festivals, protests |

Views: `v_open_incidents_live` (deadline re-checked against the wall clock),
`v_collector_queue`, `v_zone_summary`, `v_taluk_unresolved`, `v_media_gaps`,
`v_department_performance`.

## Pipeline

```
load (8 sources) -> classify -> locate -> overlay -> dedup -> link -> incidents
      -> analytics -> agents (planner, gap finder, linker, watchdog, steward, briefing) -> store
```

| Stage | Method | Where |
|---|---|---|
| Load | One loader per source; personal data is not copied (mobile -> keyed hash) | `dintel/loaders/` |
| Categories | Crosswalk tables for structured sources; a char-n-gram classifier trained on labelled grievance, police and PWD text for "Other" complaints and news | `reference/category_map.yaml`, `dintel/classify.py` |
| News | One document per URL, Google copies merged into publisher copies, story clusters (TF-IDF cosine within 48 h), report type, weakly supervised incident gate, the news pipeline's own Tamil-aware gazetteer | `dintel/loaders/news.py` |
| Location | Point-in-polygon on the 200 GCC wards, snapping within 500 m (flagged), ward -> taluk by majority vote of coded points | `dintel/geo.py`, `dintel/geolocate.py` |
| Scenario overlay | One shared world for the separately generated sources (see below) | `dintel/world.py` |
| Duplicates | Union-find over blocked pairs; the portal's rule for grievances plus officers' own "Duplicate of" decisions; police and PWD rules | `dintel/dedup.py` |
| Cross-source linking | Blocking (category group, KD-tree, category time window) -> logistic scorer -> threshold learned on half the world events -> review band -> union-find | `dintel/linking.py` |
| Incidents | Lead record, status, deadline (response-based for police cases), priority with reasons, attention flags | `dintel/incidents.py` |
| Analytics | Poisson baselines with weekday factor, DBSCAN hotspots, Getis-Ord Gi*, EWMA and z-scores, KPIs by period and zone | `dintel/analytics.py` |
| Agents | Data Steward, Action Planner, Gap Finder, Linker, Watchdog, Briefing (with a numeric verifier) | `dintel/agents/` |

Tuning lives in `config.yaml` and `reference/*.yaml` (categories carry their
deadlines, link windows and radii, playbooks and news keywords).

## The scenario overlay

The generators were written separately, so they disagree about the world: each
invents its own rain days, and their cross-reference IDs point to systems that do
not exist. The overlay fixes this without touching the generators:

1. Rain days from every source (grievance generator, police events calendar, PWD
   flood spikes, IMD warnings) form one world calendar.
2. On each world rain day, a source that shows no flood response gets the reports
   it would have produced, sized from its own real rain days. Records a source
   already has are adopted into the shared incident instead of duplicated.
3. Multi-source incidents (drain overflow, wall collapse, dengue cluster,
   electrical hazard, fallen tree) and news-anchored incidents (real news items
   that get departmental records a few hours earlier).

Every planted row has `is_synthetic = 1` and `is_overlay = 1`; the truth file says
which world event each belongs to. Real sources (news, IMD, CPCB, CFM) are never
changed. Turn it off with `python run_pipeline.py build --no-overlay` or
`overlay.enabled: false`.

## Optional LLM steps

Off by default. Set `llm.enabled: true` in `config.yaml` and `OPENAI_API_KEY` in
the environment to let the Briefing agent rewrite its text (accepted only if the
numeric verifier passes) and the Linker agent suggest decisions on gray-band pairs.
Calls are capped by `llm.max_calls_per_run`. Everything works without it.

## Known limits

* Synthetic grievance street names are not tied to their map pins (median 2.3 km
  apart), so text-only geo-resolution cannot be validated on them. Validate on real
  complaints or hand-labelled news.
* 98.9% of news rows are Google News headline snippets (median 11 words); only 183
  articles have full text. Extraction from news is limited until publisher text is
  recovered where robots.txt allows.
* The classifier scores near 0.99 because complaint texts come from templates;
  expect lower on real text.
* Story clustering uses character n-grams, which cannot match a Tamil headline to an
  English one about the same event (for example the 22-23 Sep Washermanpet balcony
  collapse appears as separate Tamil and English items). A multilingual embedding
  model (BGE-M3 or multilingual-e5, about 0.5-2 GB, not downloaded here) closes this gap.
* Station coordinates for CPCB and CFM are approximate (`reference/facilities.yaml`
  lists the precision of each).
* All sources cover about 90 days, so there is no previous quarter to compare with.
