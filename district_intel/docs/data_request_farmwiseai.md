# Data request to FarmwiseAI (Task 6 prototype)

**Team:** Chennai District Intelligence · **District:** Chennai · **Date:** 27 Sep 2026

We have a working data layer that joins grievance, police, PWD, hospital, IMD,
CPCB, CFM and news data on one ward, zone and taluk key. The items below are the
gaps we cannot close from public or synthetic sources. Each one names the tile or
check it unblocks.

| # | What we need | Format we can take | What it unblocks | Priority |
|---|---|---|---|---|
| 1 | Official taluk boundaries for Chennai district (17 taluks, including Kolathur) | GeoJSON or Shapefile, EPSG:4326 | Taluk map layer and the brief's "taluks with the most unresolved incidents" query. Today we approximate each ward's taluk by majority vote of coded police and PWD points | High |
| 2 | Official GCC ward boundaries (200 wards) | GeoJSON or Shapefile | Replaces the DataMeet community layer we use now | Medium |
| 3 | Daily rainfall history, Jun 2026 onwards, per IMD station or per taluk | CSV: date, station or taluk, rainfall_mm | Rain-versus-waterlogging insight and the weather tile's history. The public IMD page gives only the last 24 h | High |
| 4 | Daily AQI and pollutant history for the 9 Chennai CAAQM stations | CSV: date, station_id, pollutant, value | Air-quality trend; CPCB history is CAPTCHA-gated and we do not bypass it | Medium |
| 5 | Surveyed coordinates of CPCB stations and CFM-DSS gauges (27) | CSV: station_id, lat, lon | Accurate map placement; ours are approximate to 0.5–3 km | Medium |
| 6 | River gauge warning and danger stages with their datum | CSV: station_id, warning_m, danger_m, datum | The CFM feed publishes danger below warning for every gauge, so we flag those readings as suspect | Medium |
| 7 | Ward-level population (Census 2011 or later) | CSV: ward_no, population | Per-capita rates on the map and fair comparison between wards | Low |
| 8 | GCC officer directory by zone and ward (designation, zone, wards covered; contact optional) | CSV | Owners for department action lists; PWD and police already have them | Medium |
| 9 | A sample of real, anonymised grievances with street text and map pins | CSV in the portal's export format | Testing address-based location. Synthetic street names sit about 2.3 km from their pins, so they cannot be used | High |
| 10 | Test credentials or mock API for the two applications FarmwiseAI provides | API docs + test account | The "separate login" connector the brief asks for | High |

## Compute and model access

* Runs on one laptop CPU today (build about 3.5 minutes, multilingual embeddings cached).
* LLM steps are optional and off; if enabled, expected use is under 200 calls per run
  (briefing rewrites, gray-band link checks) with a numeric verifier on every output.
* A larger multilingual model (BGE-M3, about 2.3 GB) would help merge Tamil and English
  reports of the same event; the small model we use cannot do this reliably from headlines.
