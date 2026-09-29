"""Build docs/Chennai_District_Intelligence_Tech_Stack.pdf (python docs/make_tech_stack_pdf.py)."""
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

OUT = Path(__file__).with_name("Chennai_District_Intelligence_Tech_Stack.pdf")
BLUE = colors.HexColor("#1560E8")
DEEP = colors.HexColor("#0B3FA8")
SOFT = colors.HexColor("#EEF3FC")
LINE = colors.HexColor("#D5DFF0")

ss = getSampleStyleSheet()
H1 = ParagraphStyle("h1", parent=ss["Title"], fontName="Helvetica-Bold", fontSize=20, textColor=DEEP, alignment=0, spaceAfter=4)
SUB = ParagraphStyle("sub", parent=ss["Normal"], fontSize=9.5, textColor=colors.HexColor("#465B80"), spaceAfter=10, leading=13)
H2 = ParagraphStyle("h2", parent=ss["Heading2"], fontName="Helvetica-Bold", fontSize=13, textColor=BLUE, spaceBefore=10, spaceAfter=6)
CELL = ParagraphStyle("cell", parent=ss["Normal"], fontSize=8.6, leading=11)
CELLB = ParagraphStyle("cellb", parent=CELL, fontName="Helvetica-Bold")
HEAD = ParagraphStyle("head", parent=CELL, fontName="Helvetica-Bold", textColor=colors.white)
BUL = ParagraphStyle("bul", parent=CELL, fontSize=9, leading=12.5, leftIndent=10, bulletIndent=0, spaceAfter=3)

SECTIONS = [
    ("1. Collecting real data (built, unchanged)", ["Function", "Tech stack"], [
        ["News collection: Google News (English and Tamil), The Hindu, TOI, DT Next, NIE and Dinamani feeds, Dinamalar sitemap",
         "Python 3.11, requests with truststore, feedparser, lxml, trafilatura (article text, only where robots.txt allows), langdetect, YAML config, optional PyMySQL"],
        ["News relevance, department and complaint tagging", "Regex place-name list for English and Tamil (handles Tamil word endings), keyword rules; optional OpenAI gpt-4o-mini (off)"],
        ["IMD weather: observations, forecasts, warnings", "Python, requests (IMD's JSON and HTML pages), BeautifulSoup, pandas, robots.txt checks, raw page snapshots"],
        ["CPCB air quality", "Python, requests, Playwright (headless browser reading the public map; CAPTCHA pages are not bypassed), pandas"],
        ["CFM-DSS flood monitor: gates, gauges, bulletins", "Python, requests, Playwright, pandas"],
    ]),
    ("2. Departmental sources (built, unchanged)", ["Function", "Tech stack"], [
        ["Grievance portal: registration, login, filing, tracking", "Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, MySQL 8 (mysql2)"],
        ["Portal security", "JWT tokens (jose), bcryptjs password hashing, zod input validation, nodemailer for OTP emails"],
        ["Portal map and ward lookup", "Google Maps with a Leaflet fallback; ward found from the map pin using the ward boundary file"],
        ["Portal department routing", "Keyword rules, optional gpt-4o-mini"],
        ["Grievance export and synthetic history", "Node.js scripts (severity, duplicate and language rules in intel.js); Excel export via openpyxl"],
        ["Police dataset", "TypeScript run with tsx, CSV output (mysql2 optional)"],
        ["PWD dataset", "Python standard library only: seeded random numbers, lake water-balance simulation"],
        ["Hospital dataset", "Python and pandas, seeded per date and hospital"],
    ]),
    ("3. District intelligence layer (district_intel/, built)", ["Function", "Tech stack"], [
        ["Loading and normalising the 8 sources", "Python 3.11, pandas, NumPy"],
        ["Reference lists: taluks, departments, 32 categories, statuses, facilities", "YAML files"],
        ["Ward, zone and taluk placement, ward adjacency, zone outlines", "matplotlib.path (point-in-polygon), SciPy cKDTree (nearest-ward snapping); no PostGIS needed"],
        ["Text features: language, Tanglish, hazards, vulnerable places, casualties", "Python regex (ported from the portal) and SimHash fingerprints"],
        ["Category classification (English, Tamil, Tanglish)", "scikit-learn: character n-gram TF-IDF plus logistic regression"],
        ["News incident filter", "Logistic regression on character n-grams plus multilingual embeddings; trained on rule-based and 300 hand labels, scored with 5-fold cross-validation"],
        ["Multilingual embeddings", "sentence-transformers on PyTorch (CPU), model intfloat/multilingual-e5-small, vectors cached on disk"],
        ["News story grouping", "TF-IDF similarity plus embeddings, then union-find"],
        ["Duplicates within a source", "KD-tree candidate search, rules, union-find"],
        ["Same incident across sources", "KD-tree candidate search, text similarity, logistic-regression scorer with a learned threshold, union-find"],
        ["Severity, priority, deadlines", "Rule tables in Python; priority recomputed at build time"],
        ["Shared rain calendar for the generators", "Python, passed through the generators' own --rain-days and --rainfall-csv options"],
        ["Scenario overlay", "NumPy seeded random numbers, SciPy Poisson"],
        ["Spike alerts", "SciPy Poisson probabilities against pandas rolling baselines"],
        ["Hotspots", "scikit-learn DBSCAN (distance on the globe), Getis-Ord Gi* computed in NumPy"],
        ["Hospital, lake and air-quality trends", "pandas moving averages and z-scores, NumPy trend slope"],
        ["KPIs and daily counts", "pandas"],
        ["Agents: Data Steward, Action Planner, Gap Finder, Linker, Watchdog, Briefing", "Plain Python workflows; a regex checks every number in briefings; optional OpenAI client (off, no key set)"],
        ["Data-quality checks and source health", "pandas, plus each collector's own run-log files"],
        ["Storage", "SQLite (Python built-in sqlite3; 32 tables, 6 views), CSV copies, JSON and GeoJSON feeds for the dashboard"],
        ["Refresh and scheduling", "Each collector's own command line via subprocess; Windows Task Scheduler (DistrictIntel, every 30 minutes) running a .bat"],
        ["Tests, reports, version control", "pytest (18 tests), Markdown reports, git"],
    ]),
    ("4. Dashboard", ["Function", "Status", "Tech stack"], [
        ["Current prototype (the artifact)", "Built", "One HTML file, plain JavaScript, hand-drawn SVG map and charts, Google Fonts; data generated in the browser"],
        ["Real Collector dashboard", "Next step", "Recommended: the portal's /collector page (Next.js 14, already in place), reading district_intel.db or the JSON feeds; Leaflet with the ward and zone GeoJSON; Recharts or ECharts; TanStack Table; the portal's existing login and roles"],
    ]),
]

NOT_IN = [
    "<b>No PostgreSQL/PostGIS or vector database.</b> SQLite, SciPy and cached NumPy vectors cover district scale with no server to install. Postgres with PostGIS and pgvector is the upgrade path if this grows to many districts.",
    "<b>No GPU and no paid API by default.</b> Everything runs on a laptop CPU. The LLM steps are optional and off.",
    "<b>No Claude models wired in yet.</b> The code only has an OpenAI client, because the repo already used gpt-4o-mini. Claude Haiku 4.5 or Sonnet 5 would sit behind the same optional switch.",
]


def table(head, rows):
    widths = {2: [95 * mm, 172 * mm], 3: [70 * mm, 25 * mm, 172 * mm]}[len(head)]
    data = [[Paragraph(h, HEAD) for h in head]]
    for r in rows:
        data.append([Paragraph(r[0], CELLB)] + [Paragraph(c, CELL) for c in r[1:]])
    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BLUE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, SOFT]),
        ("GRID", (0, 0), (-1, -1), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(colors.HexColor("#8394B2"))
    canvas.drawString(15 * mm, 8 * mm, "Chennai District Intelligence · Tech stack · FarmwiseAI Task 6 · 27 Sep 2026")
    canvas.drawRightString(landscape(A4)[0] - 15 * mm, 8 * mm, f"Page {doc.page}")
    canvas.restoreState()


def main():
    doc = SimpleDocTemplate(str(OUT), pagesize=landscape(A4), leftMargin=15 * mm, rightMargin=15 * mm,
                            topMargin=14 * mm, bottomMargin=14 * mm, title="Chennai District Intelligence: Tech Stack",
                            author="FarmwiseAI Task 6 team")
    story = [Paragraph("Chennai District Intelligence: Tech Stack", H1),
             Paragraph("The technology behind every function, split into what is built now and what is planned. "
                       "Checked against each project's actual imports and package files.", SUB)]
    for title, head, rows in SECTIONS:
        story += [Paragraph(title, H2), table(head, rows)]
    story += [Paragraph("Deliberately not in the stack", H2)]
    story += [Paragraph(t, BUL, bulletText="•") for t in NOT_IN]
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    print(OUT)


if __name__ == "__main__":
    main()
