# Change requests — round 1 (2026-09-28)

Status legend: ✅ done · ⚠️ done, with a caveat

## Login / Create account pages
1. ✅ Site renamed **District IQ — Chennai Intelligent District Governance Platform** (new logo, header, page titles).
2. ✅ "Greater Chennai Corporation" removed from the login, sign-up, header, footer and logo.
3. ✅ Nothing citizen-specific: the login serves citizens, department officers and the Collector (`AuthShell.tsx`).
4. ✅ Footer now reads "District IQ · Chennai Intelligent District Governance Platform · Helpline 1913".
5. ✅ No page scroll: both pages fit one screen (checked at 1366×768 and 1920×1080).
6. ✅ Tighter premium layout: 15px inputs, 48px fields, compact password rules.

## Collector dashboard
7. ✅ Export → **PDF report** (jsPDF, vector charts): KPIs with change, key insights, department/zone bars, severity mix, trend,
   environment, the verification queue, ongoing incidents grouped by priority with reasons, open complaints, and news sent to departments. CSV kept.
8. ✅ Satellite map (Leaflet + Esri World Imagery) with ward heat shading, zone outlines, pins and stations; zooms to the selected zone.
9. ✅ Today's Briefing "See more" → wide three-column news grid with 16px headlines.
10. ✅ My Tasks: only citizen complaints where the officer reported action and asked for verification (`awaiting_collector`),
    showing the officer's note, with Verify and Send back.
11. ✅ "Recent incidents" → **Severity-based incidents**: Severe / High / Medium / Low tabs with counts and a readable card per incident.
12. ✅ Incident pop-up is view-only: no action plan, no buttons, no priority score. Plain-language "What happened" and
    "Why it needs attention", key facts, and who is responsible.
13. ⚠️ News that is a civic complaint is routed to the department officer (`district_intel_ops.dept_assignments`) and left out
    of the incident list. The officer dashboard is still "coming soon", so the routed items appear on page 2 and in the PDF.
14. ✅ Timeline shows only the reports merged into the incident (news outlets, complaints, police/PWD records), each at its own time, grouped by day.
15. ✅ Dedup checked: every incident's source list matches its linked records (0 mismatches over 35k incidents). Two UI bugs fixed:
    the incident table dropped sources, and "outlets" counted articles instead of publishers. One source-count component is now used everywhere.
16. ✅ Rainfall / air quality / reservoir cards: level pill (LOW / MODERATE / HIGH), trend arrow vs. the previous reading,
    a colour scale with a marker, and a one-line summary.
17. ✅ No scrolling on desktop: two pages (1 Overview · 2 Environment) with a pager (PageUp/PageDown also work).
18. ✅ Sidebar replaced by an 84px icon rail.
19. ✅ 48 officials from the GCC "Who's who" page stored in `district_intel_ops.official_contacts`
    (`npm run seed:contacts`) and shown in the snapshot, the contacts dialog and the incident pop-up.

# Round 3 (2026-09-28/29): gaps from the Task 6 brief

| # | Item | What was built |
|---|---|---|
| 3 | Mandi prices | AGMARKNET public API (no CAPTCHA route): daily prices + 8-week trend for Tamil Nadu and the markets around Chennai; card on the Environment & markets page |
| 4 | Collection with refresh, errors, login sessions | Sources window: status, newest data, last 5 runs, Run now / Refresh / Pause; retries with backoff; form, basic and token sign-in with session reuse and automatic re-login |
| 6 | Place names to the hierarchy | Every incident shows its taluk; unplaced incidents and uncertain links listed under "Locations needing review"; added items are resolved to area, ward, zone, taluk |
| 9 | Category trends | Trends page: 12-week and 6-month lines per category |
| 10 | Written briefing | Briefing page: generated from the store by rules (no language model), each item with why, evidence, next step; full text and download |
| 11 | Department follow-ups | Briefing page: per department open / late / to-verify counts and proposed next steps |
| 13 | Map drill-down | Zones / Taluks toggle; click a taluk to filter (village boundaries are not in the supplied data) |
| 15 | Cross-filtering | Category from the trend chart and taluk from the ranking or map filter every panel; selecting an incident flies the map to it |
| 16 | Confidence | Pop-up shows confidence with an explanation and each merged report's link strength |
| 17 | Audit history | Audit log tab (decisions, source changes, OCR uploads, workspaces) |
| 21 | News-only view | Briefing page: "In the news, not in department records", with a 2+ outlets filter |
| 22 | Taluk ranking | Trends page: unresolved incidents by taluk, last 30 days, change in reports vs the 30 days before |
| 23 | Patterns | Trends page: unusual spikes and recurring hotspots |
| 24 | OCR | Upload a newspaper page; read in the browser (English/Tamil), split into articles, classified and placed |
| 25 | Saved workspaces | Save named versions with a frozen briefing; reopen any version |
| 26 | Add a source by link | Add RSS / web page / JSON with optional login; read on a schedule and classified |
| 27 | Customize | Choose pages, Overview panels and headline cards |

Setup on another machine: `npm run setup:ops` then `npm run seed:contacts`.

# Round 4 (2026-09-29): added sources, market-wise mandi prices, developing stories

| # | Request | What was built |
|---|---|---|
| 1 | Today's Briefing: "From added sources" tab | Page 1 briefing card has News / From added sources tabs (last 7 days at least, follows zone, department, category and taluk). "See more" opens every item with a civic-only filter |
| 2 | Map pins for added items with a place | Violet diamond pins (lighter when not a civic issue) with their own legend toggle. Places come from the news monitor's gazetteer (localities with coordinates and Tamil names, now exported by `scripts/export-reference.py`) plus the GCC area list; older items are placed again automatically |
| 3 | Page 2 briefing: "From added sources" section; open each item and its source link | Short section under "Needs your attention" (also in Full text / Download and the PDF). Every item opens a viewer: text, how it was classified and placed (with the matched words), "Open the source link", "Show on the map" |
| 4 | Mandi prices, Chennai market-wise | New "Chennai markets" view: each Uzhavar Sandhai market (Anna Nagar, K.K. Nagar, Nanganallur, Ambattur; Medavakkam, Pallavaram, Kundrathur, Guduvancheri) side by side, cheapest green and dearest red, your zone's market highlighted; click a market for its full price list with change and 14-day trend. From AGMARKNET's open state market-wise daily report (`district_intel_ops.mandi_market_prices`, last 14 days). Koyambedu does not report to AGMARKNET |
| 5 | Replace the news timeline: cluster the same event as it continues, show what happened time-wise | "Developing stories" card and full view (`src/lib/collector/threads.ts`): reports about one event are threaded across outlets, stories and days; each report is labelled (first report, arrest, death, court, probe, protest, action, warning, completed) and shown by day. Rules only, explained in the view |

Setup on another machine: `npm run setup:ops` (adds the new table and columns), `python scripts/export-reference.py`, then run AGMARKNET from Data sources.

# Round 5 (2026-09-29): taluk filter, location checks, readable briefing and trends, scrollable mandi table

| # | Request | What was done |
|---|---|---|
| 1 | Taluk dropdown like the zone one | "All taluks" dropdown next to Zone and Department (the separate taluk chip was removed). Filters every panel |
| 2 | Check taluk and event locations (Egmore showed under Mylapore) | New test `npm run validate:locations`. Found and fixed: (a) the pipeline kept a source's own taluk label instead of the ward's, 583 incidents disagreed with their ward, now 0 (`district_intel/dintel/geolocate.py`); (b) the grievance generator put addresses of large GCC areas (EGMORE spans 26 wards) in far-away wards, 41.5% of grievances were >2.5 km from the locality in their address, now 6.5%; every "Egmore" address is now in Egmore taluk. Known gap: Kolathur taluk is not coded by any source, so it has almost no wards |
| 3 | Collector's Briefing hard to read, cut off, small fonts | Rebuilt: four headline numbers, conditions and prices on one line, then numbered cards with "Why it matters" and a highlighted "Next step", larger type (15-17px); the card scrolls, nothing is clipped |
| 4 | Grievance descriptions look generated (many identical) | Generator writes each complaint from optional parts (who is writing, what exactly they see, when, how many affected) in English, Tamil and Tanglish; fixed a bug that fed 8,110 older synthetic rows into the pipeline twice. Distinct descriptions: about 85% -> 98.4% |
| 5 | Incident categories over time hard to understand | Replaced the multi-line chart with "Which problems are rising?": one row per category with total, a bar per week or month, last week, and a rise/fall badge; a sentence names the biggest rise and fall |
| 6 | Mandi prices do not scroll | Tables scroll inside the card with a fixed header row and commodity column; all items are listed |
