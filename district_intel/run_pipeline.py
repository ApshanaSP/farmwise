#!/usr/bin/env python3
"""District Intelligence data layer.

  python run_pipeline.py build            build the curated store from current source outputs
  python run_pipeline.py refresh          run the existing collectors/generators that are due, then build
  python run_pipeline.py refresh --all    run all of them regardless of schedule
  python run_pipeline.py watch --every 15 loop: refresh what is due every N minutes, rebuild when inputs change
  python run_pipeline.py mysql            copy the last build into MySQL (databases district_intel and district_intel_ops)

The existing collectors keep their own fetching methods; this only calls their
command lines (see `refresh:` in config.yaml) and reads their output files.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from dintel.util import REPO_DIR, load_settings, log, setup_logging  # noqa: E402

STATE = HERE / "output" / "state" / "refresh_state.json"


def _state() -> dict:
    try:
        return json.loads(STATE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _save_state(s: dict) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(s, indent=2), encoding="utf-8")


def refresh(settings, force: bool = False, only: set[str] | None = None) -> list[str]:
    from dintel import sync
    cal = sync.write_inputs(settings)    # shared rain calendar for the generators' own options
    fill = {"grievance_rain_days": ",".join(cal["grievance_rain_days"])}
    st = _state()
    ran = []
    now = time.time()
    for job in settings.raw.get("refresh", []):
        if only and job["name"] not in only:
            continue
        last = st.get(job["name"], {}).get("last_run", 0)
        if not force and now - last < job["every_minutes"] * 60:
            continue
        cwd = REPO_DIR / job["cwd"]
        cmd = [c.format(**fill) if "{" in c else c for c in job["cmd"]]
        log.info("refresh %s: %s (in %s)", job["name"], " ".join(cmd), cwd)
        try:
            p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=3600,
                               encoding="utf-8", errors="replace")
            ok = p.returncode == 0
            tail = (p.stdout or "")[-400:] + (p.stderr or "")[-400:]
        except (OSError, subprocess.TimeoutExpired) as exc:
            ok, tail = False, str(exc)
        st[job["name"]] = {"last_run": now, "ok": ok, "tail": tail[-800:]}
        log.info("refresh %s: %s", job["name"], "ok" if ok else "FAILED (see output/state/refresh_state.json)")
        ran.append(job["name"])
    _save_state(st)
    return ran


def _inputs_fingerprint(settings) -> str:
    h = hashlib.sha1()
    for p in sorted(REPO_DIR.glob("*/**/*.csv")):
        if "district_intel" in p.parts or "node_modules" in p.parts:
            continue
        s = p.stat()
        h.update(f"{p}|{s.st_size}|{s.st_mtime_ns}".encode())
    return h.hexdigest()


def _mysql(settings) -> dict:
    from dintel.mysql_export import export

    return export(settings)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["build", "refresh", "watch", "mysql"])
    ap.add_argument("--all", action="store_true", help="refresh every source regardless of schedule")
    ap.add_argument("--every", type=int, default=15, help="watch interval in minutes")
    ap.add_argument("--config", default=None)
    ap.add_argument("--no-overlay", action="store_true", help="skip the scenario overlay")
    ap.add_argument("--only", default="", help="refresh only these sources, comma-separated (e.g. news,imd)")
    ap.add_argument("--no-build", action="store_true", help="refresh without rebuilding")
    ap.add_argument("--mysql", action="store_true", help="export to MySQL after each build (or set mysql.export_after_build)")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    setup_logging(args.verbose)
    settings = load_settings(args.config)
    if args.no_overlay:
        settings.raw["overlay"]["enabled"] = False
    from dintel.pipeline import build as _build

    export_mysql = args.mysql or settings.raw.get("mysql", {}).get("export_after_build", False)

    def sync_mysql(s) -> None:
        """Export when the SQLite store is newer than the last export. Failures are logged and
        retried on the next run, so a stopped MySQL server never blocks the build."""
        if not export_mysql:
            return
        db = s.path(s.raw["output"]["sqlite"])
        st = _state()
        if not db.exists() or st.get("_mysql_exported_mtime") == db.stat().st_mtime:
            return
        try:
            rep = _mysql(s)
        except Exception as exc:  # noqa: BLE001
            log.error("mysql export failed (will retry on the next run): %s", exc)
            return
        if not rep["mismatches"]:
            st = _state()
            st["_mysql_exported_mtime"] = db.stat().st_mtime
            _save_state(st)

    def build(s):
        m = _build(s)
        sync_mysql(s)
        return m

    if args.command == "mysql":
        rep = _mysql(settings)
        print(json.dumps({k: rep[k] for k in ("database", "ops_database", "tables", "rows", "documents_columns",
                                              "ops_tables_created", "briefings_archived", "mismatches", "runtime_s")}, indent=2))
        sys.exit(1 if rep["mismatches"] else 0)
    elif args.command == "build":
        m = build(settings)
        st = _state()
        st["_last_build_fingerprint"] = _inputs_fingerprint(settings)
        _save_state(st)
        print(json.dumps({k: m[k] for k in ("as_of", "runtime_s", "dedup", "geo_holdout", "flood_day_correlation_before_overlay",
                                             "flood_day_correlation_after_overlay") if k in m}, indent=2, default=str))
    elif args.command == "refresh":
        only = {x.strip() for x in args.only.split(",") if x.strip()} or None
        refresh(settings, force=args.all, only=only)
        st = _state()
        fp = _inputs_fingerprint(settings)
        if args.no_build:
            return
        if fp != st.get("_last_build_fingerprint"):
            build(settings)
            st = _state()  # re-read: the MySQL step records its own progress
            st["_last_build_fingerprint"] = fp
            _save_state(st)
        else:
            log.info("no source file changed since the last build; skipping the rebuild")
            sync_mysql(settings)
    else:
        last = None
        while True:
            refresh(settings)
            fp = _inputs_fingerprint(settings)
            if fp != last:
                build(settings)
                last = fp
            else:
                log.info("no input changed; next check in %d min", args.every)
            time.sleep(args.every * 60)


if __name__ == "__main__":
    main()
