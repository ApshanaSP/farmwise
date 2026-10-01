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

# Round 6 (2026-09-29): daily data, clearer reasons, fewer tasks, page order, spikes and hotspots, prices

| # | Request | What was done |
|---|---|---|
| 1 | Collect all data once a day | Task Scheduler job `DistrictIntel` now runs daily at 6:00 AM (was every 30 min); every pipeline feed in `district_intel/config.yaml` is due every 1440 min, with 30 min slack so the 6:00 run is never skipped; added sources and AGMARKNET default to daily and run from 6:00 AM (`runDueSources`). The top bar shows "Updated daily, 6:00 AM" and the data time |
| 2 | "What happened" / "Why it needs attention" confusing; show reasons only where needed | `explain()` rewritten: one plain sentence (cause and place), short facts (people affected, road blocked, near a school...), and at most 3 reasons in plain words. Reasons appear only when the incident is open and severe/high, or has a strong signal (well past deadline, several departments, only in the news, deaths). Otherwise the pop-up says "No action needed from you". The severity card marks and lists first only the incidents that need the Collector |
| 3 | Collector need not verify every task | My Tasks keeps only closures that are severe/high, have 3+ complaints, involve several departments, were in the news, or (medium) took over twice their deadline: 23 of 96. Each task shows why it is there; the rest are counted as left to department heads |
| 4 | Developing stories on page 2 or 3 | Moved to page 2 (Briefing), next to Department follow-ups. "In the news, not in department records" opens from the briefing's "seen only in the news" chip |
| 5 | Page 4 needs no area or department filter | Environment & markets page hides the filters and always shows the whole district (station pickers per card) |
| 6 | Mandi price table clearer | Full-width card; Chennai city and suburb markets grouped under headers; cheapest/dearest as green/red pills with a legend; search box; "since the last report" movers on top; average and change columns |
| 7 | "Which problems are rising?" and insights unclear | Three summary cards (rising fastest, falling fastest, most reported); rows sorted rising first with Rising/Steady/Falling, last 4 weeks vs the 4 before, and the zone adding the most reports |
| 8 | Click an unusual spike or recurring hotspot to see its details | New detail view (`/api/collector/pattern`): what happened in plain words, day-by-day or month-by-month bars, places, suggested next step, every incident behind it, and "Show only this on the dashboard". Hotspot incidents come from `incidents.hotspot_id` |
| 9 | Tiles in reading order; filters in one place | Page 1 reads left to right: what is urgent (severity), where (map and snapshot), what to act on (My Tasks, then news). Period, zone, taluk and department sit together in one filter bar on pages 1 to 3 |
| 10 | Why only 4/8 feeds live | News, IMD, CPCB and CFM had not been fetched since 28 Sep 2 PM: the scheduled task had Windows' default "stop if the computer switches to battery", so every run on battery was killed mid-way (`^C` / "window-CLOSE event" in refresh.log). The task now runs on battery, catches up if 6:00 AM was missed, and stops after 2 h. The four feeds were refreshed (8/8 live). Feeds that arrive with some endpoints blocked (IMD, CPCB) count as live and show "Partial" with the reason; daily feeds turn stale after 36 h |

# Round 7 (2026-09-30): page 1 layout, Trends page without filters

| # | Request | What was done |
|---|---|---|
| 1 | Map hard to use; District Snapshot takes too much space | Map runs the full height on the left with nothing over it; its legend moved under the map as toggle chips. District Snapshot is one horizontal strip on the right |
| 2 | Today's Briefing too small | Severity, My Tasks and Today's Briefing sit side by side under the snapshot, full height; the briefing column is the widest of the three. Headers shortened; task cards made compact (officer's note on one line, reasons as chips, Send back and Verify) so three tasks show at once |
| 3 | "Which problems are rising?" still unclear | Each problem shows the two numbers being compared as two bars (grey = 4 weeks before, blue/red/green = last 4 weeks), the change in words ("22% more", "About the same"), and the zone with the most new reports. One sentence on top names what is rising and falling. List and detail use the same full Monday-to-Sunday weeks, so their numbers match |
| 4 | Clicking on the Trends page must not filter anything | Page 3 is district-wide and has no filter bar. A problem opens its detail (weekly bars, zones adding reports, incidents); a taluk opens its open incidents; spikes and hotspots open their details. None of these change the dashboard's filters, and the "Show only this" button was removed |
| 5 | Spikes, hotspots and locations needing review stay constant | They are loaded district-wide, whatever filters are set on pages 1 and 2 |


# Round 8 (2026-09-30): explainable page 1, one count per department, action-list export, daily data checks

| # | Request | What was done |
|---|---|---|
| 1 | Make the dashboard clearly explainable | "? How to read" button on every page opens a guide: what each card shows, what its numbers count, what to do, the words used (incident, complaint, severity, past deadline, needs you) and where the data comes from, with today's collection status. Headline tiles explain what they count on hover |
| 2 | Department filter shows incident counts twice | With a department selected, "Open complaints" and "Ongoing incidents" become one "Open incidents" tile with the complaint count beside the label; the selected department in the dropdown no longer repeats its open count |
| 3 | "In the news, not in department records" as a tile in the news card | Moved out of the snapshot strip into Today's Briefing as an "Only in news" tab, each item marked with the department it belongs to; See more opens the full list |
| 4 | Clear, easy UI | Filters, help and pages fit one header row (the pager names the page; "Clear" instead of "Clear filters"); snapshot subtitles say "Daily · last 24 hours" etc.; period buttons explain their window |
| 5 | Export: not every incident | CSV is now an action list: incidents that need the Collector, then closed work to check, one row each with the reason (daily: 65 rows instead of every open incident). PDF lists the 10 most urgent and counts the rest; 8 closures; 5 news-only items (weekly report: 3 pages) |
| 6 | Last 24 hours: daily / weekly / monthly / quarterly | Export dialog has its own Daily / Weekly / Monthly / Quarterly choice; the PDF is titled "Collector's Daily/Weekly/Monthly/Quarterly Report" |
| 7 | Data must be fetched properly, once a day; did it run this morning? | It did not run at 6:00 AM on 30 Sep: the laptop was asleep until 9:08 AM and the first run was 12:05 PM. CPCB and grievance then failed (CPCB live map error; a run cut off by sleep). `run_pipeline.py refresh` now tries each feed up to 3 times (60 s apart, 30 min per try), logs the date of each run and records `_last_collection`; the 21:00 run collected both (8/8 today). The DistrictIntel task wakes the computer (WakeToRun) and may run 3 h; the leftover one-time DistrictIntelCpcb task was disabled. The top bar shows "Collected today, <time>" or which feeds are still missing |

# Round 9 (2026-10-01): Daily means today, news-only card on page 2, tidier Trends

| # | Request | What was done |
|---|---|---|
| 1 | Daily must show only today's data on every page, not "2 days ago" | Daily is now the calendar day of the latest data, from midnight (`periodWindow`/`periodSince` in intel.ts), compared with yesterday. Pages 1 and 2 follow it everywhere: headline numbers, map, severity, My Tasks (closures reported today), bell, news, added-source items (were at least 7 days), developing stories (those with a report today), the news-only list (was at least 7 days) and the briefing. Weekly/monthly/quarterly stay the last 7/30/90 days. Pages 3 and 4 are multi-week by design and unchanged |
| 2 | Remove "How to read"; Today's Briefing as it was | The help button and guide are removed. Today's Briefing is back to News / From added sources |
| 3 | Page 2: a separate tile for news not in department data | New card "News, no dept record" on the Briefing page: each item with place, time and the department it belongs to; See all opens the full list |
| 4 | Page 3: remove descriptions (Unresolved by taluk, Locations needing review) | Both description paragraphs and the review summary lines were removed |
| 5 | Locations needing review shows 96 but only one visible | The description took the card's space and the list clipped instead of scrolling, and only 30 were loaded. All of them now load and the list scrolls (96 of 96) |

# Round 10 (2026-10-01): Department Officer dashboards merged, connected to the Collector

| # | Request | What was done |
|---|---|---|
| 1 | Merge only the department officer dashboard from the zip, change nothing else | Taken from the zip: `src/app/officer`, `src/app/api/officer/*`, `src/components/officer/*`, `src/lib/officer/*`, migration 011, `setup-officer-ops.js`, `seed-officers.js`. Not taken: the zip's own data refresh job (`daily-refresh.js`, `refresh.ts`, the `dept_*` tables), its sample store generator, and its older copies of the Collector console files |
| 2 | Data fetched exactly as before (unified data only) | The officer console reads only `district_intel` / `district_intel_ops`, loaded by the pipeline's daily 6:00 AM run. Department insights were rewritten to use the store (events, observations, pwd_works, hotspots, market prices) instead of the zip's raw-file tables |
| 3 | Connect task, verification, send to Collector | Officer: Approve → Complete & send (remarks + photos). Collector: the report appears first in My Tasks and in "Awaiting your verification" with the officer's remarks; the incident pop-up shows the report and photos; Verify or Send back (existing buttons). Sent back → officer sees "Returned" with the note and resends. Tested end to end |
| 4 | Department data made into insights (police, PWD, hospital, agri, ...) | "Department insights" page per department (see README section 13). There is no agriculture department in the store, so market prices are on District Revenue |
| 5 | Neat, clear, accessible for the Collector; tiles like the Collector's department filter | Collector opens any department's console read-only from the department snapshot ("Department console"), switches department from the banner, and verifies or sends back from there. Tiles add the Collector's "Severe or high, open" and "Past deadline, open" (with the busiest zone); the department head's contact is in the account menu |

# Round 11 (2026-10-01): Ask District IQ merged from the zip, one-page department console

| # | Request | What was done |
|---|---|---|
| 1 | Merge only the chatbot from the zip, change nothing else | Taken from `farmwiseai-main.zip`: `src/lib/assistant/*`, `src/lib/ai/*`, `src/app/api/collector/assistant/*`, `src/components/collector/app/assistant/*`, `eval/`, `vitest.config.ts`, `scripts/build-embeddings.cjs`, `create-assistant-ro-user.sql`, `generate-assistant-catalog.js`, the assistant's tables in `setup-intel-ops.js`, its npm packages and `.env.example` block. Hooked in the way the zip does it: the new pop-up replaces the old rule-based "Ask" panel (launcher with today's insight count, Ctrl+K), three exports added (`scopeWhere`, `placeNames`, `categoryWords`) and `overview(..., { route: false })` for read-only callers. Not taken: everything else in the zip (its collectors, pipeline, older console files, SSRF and crypto changes) |
| 2 | Data fetched as before (unified data only) | The assistant reads only `district_intel` / `district_intel_ops` through the console's own functions; it fetches nothing |
| 3 | Chatbot on the Collector and the department officer dashboards | Same pop-up on both (`assistant/host.ts`). An officer's answers are locked to their department on the server (`access.ts`, `lockDept`): department rankings become the department's own figures, other departments' incidents are not opened, insights are the department's, no department filter action |
| 4 | No navigation to other departments | The department switcher is gone from the officer console (also in the Collector's read-only view; the Collector picks a department on the Collector console) |
| 5 | Each department its own username and password; show who is logged in | `npm run seed:officers --reset-passwords` gave each of the 25 `officer.<code>@chennai.gov.in` accounts its own password, listed in the git-ignored `officer-accounts.local.csv`. The top bar shows "Logged in as officer.<code>" |
| 6 | New layout; no separate Grievances / Department insights pages; informative for the officer | One scrolling page: seven tiles (adds *Due in 24 hours*), the grievance board beside **What needs you now** (approvals, returned work, late and due-soon, the oldest, waiting for the Collector, the first finding of each source), map / news / Collector feedback, insight tiles (Details opens the full source), trends |
| 7 | Insights useful for the officer, not the same for everyone | New *Complaint patterns* tile for every department (rising and falling types, busiest wards, how many reached the news); rain and IMD warnings added for Roads, Electrical, SWM (and air quality), Parks, Bridges (and lakes), TANGEDCO |

# Round 12 (2026-10-01): Department console laid out like the Collector console

| # | Request | What was done |
|---|---|---|
| 1 | Officer dashboard like the Collector dashboard with the department filter, plus department details | Rebuilt on the Collector console's layout and classes: fits the window (no scroll), period / zone / taluk filters with the department fixed, pager with 4 pages. Page 1 is the Collector's own overview filtered to the department (same KPIs with sparklines, map, department snapshot, By severity, Today's Briefing) with **My Work** (approve / complete & send) in place of the Collector's My Tasks. Page 2 grievance board + What needs you now + Collector feedback; page 3 department data cards; page 4 trends |
| 2 | No navigation between the consoles; Collector signs in separately | `/officer` is for department officers only (middleware and API guard); the Collector's "Department console" link and the Collector view of the officer console (department switcher, read-only mode) are removed |
| 3 | Chatbot "should use the API I have given" | The chatbot is wired to the zip's provider (Amazon Bedrock, or Groq/OpenAI). No key was found in the portal `.env` or in the zip, so it still answers "Without AI" by rules until a key is added |
| 4 | Data always unified | Every figure comes from `district_intel` / `district_intel_ops`; page 1 calls the Collector console's `overview()` |
