"""
Turns the JSON produced by scripts/export-complaints.js into a formatted
workbook.

    python scripts/export-to-xlsx.py [input.json] [output.xlsx]

Usually run via `npm run export:excel`, which chains it with the exporter.

Sheets
  Complaints      one row per complaint, IDs already resolved to names
  Status History  the audit trail behind each complaint
  Summary         counts by department, status, zone and type (live formulas)
  Data Sources    where the reference data came from, and whether it is official
"""
import json
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo

ROOT = Path(__file__).resolve().parent.parent
IN_PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "exports" / "complaints.json"
OUT_PATH = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "exports" / "complaints.xlsx"

NAVY = "0B3D91"
FONT = "Arial"

header_font = Font(name=FONT, bold=True, color="FFFFFF", size=10)
header_fill = PatternFill("solid", fgColor=NAVY)
title_font = Font(name=FONT, bold=True, size=14, color=NAVY)
note_font = Font(name=FONT, size=9, italic=True, color="666666")
body_font = Font(name=FONT, size=10)
bold_body = Font(name=FONT, size=10, bold=True)
thin = Side(style="thin", color="D9D9D9")
box = Border(left=thin, right=thin, top=thin, bottom=thin)


def write_table(ws, rows, columns, start_row=1, table_name=None):
    """Header row + data, styled, with an Excel autofilter table."""
    for c, name in enumerate(columns, start=1):
        cell = ws.cell(row=start_row, column=c, value=name)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(vertical="center", wrap_text=True)
        cell.border = box

    for r, row in enumerate(rows, start=start_row + 1):
        for c, name in enumerate(columns, start=1):
            value = row.get(name)
            cell = ws.cell(row=r, column=c, value=value)
            cell.font = body_font
            cell.border = box
            cell.alignment = Alignment(vertical="top", wrap_text=False)

    # Width from the widest value, capped so one long description cannot push
    # every other column off screen.
    for c, name in enumerate(columns, start=1):
        widest = len(str(name))
        for row in rows:
            v = row.get(name)
            if v is not None:
                widest = max(widest, len(str(v)))
        ws.column_dimensions[get_column_letter(c)].width = min(max(widest + 2, 10), 42)

    ws.row_dimensions[start_row].height = 28
    ws.freeze_panes = ws.cell(row=start_row + 1, column=1)

    if rows and table_name:
        ref = f"A{start_row}:{get_column_letter(len(columns))}{start_row + len(rows)}"
        table = Table(displayName=table_name, ref=ref)
        table.tableStyleInfo = TableStyleInfo(
            name="TableStyleLight9", showRowStripes=True, showColumnStripes=False
        )
        ws.add_table(table)


def main():
    if not IN_PATH.exists():
        sys.exit(f"Input not found: {IN_PATH}\nRun: node scripts/export-complaints.js")

    data = json.loads(IN_PATH.read_text(encoding="utf-8"))
    complaints = data["complaints"]
    history = data["history"]
    summary = data["summary"]

    wb = Workbook()

    # ---------------------------------------------------------- Complaints --
    ws = wb.active
    ws.title = "Complaints"
    columns = (
        list(complaints[0].keys())
        if complaints
        else [
            "Complaint No", "Filed On", "Status", "Rejected At", "Complaint Type",
            "Complaint Sub Type", "Department", "Routing", "Routing Basis",
            "Zone No", "Zone", "Ward", "Ward Determined By", "Area", "Locality",
            "Street", "Street Source", "Landmark", "Location PIN", "Latitude",
            "Longitude", "Title", "Details", "Anonymous", "Complainant", "Gender",
            "Mobile", "Email", "Complainant Address", "Photo Attached", "Last Updated",
        ]
    )
    write_table(ws, complaints, columns, table_name="Complaints" if complaints else None)

    if not complaints:
        cell = ws.cell(row=2, column=1, value="No complaints have been filed yet.")
        cell.font = note_font

    # ------------------------------------------------------ Status History --
    ws2 = wb.create_sheet("Status History")
    hist_cols = (
        list(history[0].keys())
        if history
        else ["Complaint No", "Status", "Changed By Role", "Remarks", "Changed On"]
    )
    write_table(ws2, history, hist_cols, table_name="StatusHistory" if history else None)

    # ------------------------------------------------------------- Summary --
    ws3 = wb.create_sheet("Summary")
    ws3["A1"] = "Complaint Dataset Summary"
    ws3["A1"].font = title_font
    ws3["A2"] = f"Generated {data['generatedAt'][:16].replace('T', ' ')} from {data['database']}"
    ws3["A2"].font = note_font
    rng = data.get("filter") or {}
    if rng.get("from") or rng.get("to"):
        ws3["A3"] = f"Filed between {rng.get('from') or 'the beginning'} and {rng.get('to') or 'now'}"
        ws3["A3"].font = note_font

    n = len(complaints)
    ws3["A5"] = "Total complaints"
    ws3["A5"].font = bold_body
    # A formula, so the figure follows the Complaints sheet if rows are edited.
    ws3["B5"] = f"=COUNTA(Complaints!A2:A{max(n + 1, 2)})"
    ws3["B5"].font = body_font

    ws3["A6"] = "Registered accounts"
    ws3["A6"].font = bold_body
    ws3["B6"] = data["counts"]["registeredAccounts"]
    ws3["B6"].font = body_font

    ws3["A7"] = "Status changes recorded"
    ws3["A7"].font = bold_body
    ws3["B7"] = data["counts"]["statusChanges"]
    ws3["B7"].font = body_font

    row = 9
    blocks = [
        ("By Department", summary["byDepartment"]),
        ("By Status", summary["byStatus"]),
        ("By Zone", summary["byZone"]),
        ("By Complaint Type", summary["byType"]),
    ]
    for heading, items in blocks:
        ws3.cell(row=row, column=1, value=heading).font = Font(
            name=FONT, bold=True, size=11, color=NAVY
        )
        row += 1
        for col, label in enumerate(("Name", "Complaints", "Share"), start=1):
            c = ws3.cell(row=row, column=col, value=label)
            c.font = header_font
            c.fill = header_fill
            c.border = box
        row += 1
        first = row
        for item in items:
            ws3.cell(row=row, column=1, value=item["name"]).font = body_font
            ws3.cell(row=row, column=2, value=item["n"]).font = body_font
            share = ws3.cell(row=row, column=3)
            # Guarded: an empty dataset would otherwise divide by zero.
            share.value = f"=IF($B$5=0,0,B{row}/$B$5)"
            share.number_format = "0.0%"
            share.font = body_font
            for col in range(1, 4):
                ws3.cell(row=row, column=col).border = box
            row += 1
        if items:
            ws3.cell(row=row, column=1, value="Total").font = bold_body
            ws3.cell(row=row, column=2, value=f"=SUM(B{first}:B{row - 1})").font = bold_body
            ws3.cell(row=row, column=3, value=f"=IF($B$5=0,0,SUM(C{first}:C{row - 1}))").font = bold_body
            ws3.cell(row=row, column=3).number_format = "0.0%"
            row += 1
        row += 1

    ws3.column_dimensions["A"].width = 46
    ws3.column_dimensions["B"].width = 14
    ws3.column_dimensions["C"].width = 10

    # -------------------------------------------------------- Data Sources --
    ws4 = wb.create_sheet("Data Sources")
    ws4["A1"] = "Where the reference data comes from"
    ws4["A1"].font = title_font
    ws4["A2"] = (
        "Complaint types, areas and streets are imported from the Greater Chennai "
        "Corporation's own grievance portal. Ward boundaries come from a community "
        "dataset, not an official Corporation publication — see the Official column."
    )
    ws4["A2"].font = note_font
    ws4["A2"].alignment = Alignment(wrap_text=True, vertical="top")
    ws4.merge_cells("A2:E2")
    ws4.row_dimensions[2].height = 32

    src_cols = ["dataset", "source", "official", "fetchedAt", "rows"]
    pretty = {"dataset": "Dataset", "source": "Source", "official": "Official?",
              "fetchedAt": "Fetched", "rows": "Rows"}
    sources = [{pretty[k]: r.get(k) for k in src_cols} for r in data["referenceSources"]]
    write_table(ws4, sources, list(pretty.values()), start_row=4,
                table_name="DataSources" if sources else None)

    ws4.cell(row=6 + len(sources), column=1,
             value="This export contains personal data: complainant names, mobile "
                   "numbers, email addresses and map coordinates.").font = Font(
        name=FONT, size=9, bold=True, color="C00000"
    )

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    wb.save(OUT_PATH)
    print(f"Wrote {OUT_PATH}")
    print(f"  Complaints: {len(complaints)} | Status changes: {len(history)}")


if __name__ == "__main__":
    main()
