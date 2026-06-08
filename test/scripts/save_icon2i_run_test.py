#!/usr/bin/env python3
"""
TEST SCRIPT — salvare run ICON-2I ogni 2 ore per confronto modelli.
Da cancellare dopo i test.
Output: test/data/icon2i_runs_test.json
"""
import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

OUTFILE = Path("test/data/icon2i_runs_test.json")
LAT = 45.867
LON = 10.855

def fetch_icon2i():
    url = (
        f"https://api.open-meteo.com/v1/forecast"
        f"?latitude={LAT}&longitude={LON}"
        f"&hourly=wind_speed_10m,wind_direction_10m"
        f"&models=italia_meteo_arpae_icon_2i"
        f"&wind_speed_unit=ms"
        f"&forecast_days=3"
        f"&timezone=Europe/Rome"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "ventogarda-test/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

def main():
    data = fetch_icon2i()
    fetched_at = datetime.now(timezone.utc).isoformat()

    new_run = {
        "fetched_at": fetched_at,
        "time": data["hourly"]["time"],
        "wind_speed_10m": data["hourly"]["wind_speed_10m"],
        "wind_direction_10m": data["hourly"]["wind_direction_10m"],
    }

    OUTFILE.parent.mkdir(parents=True, exist_ok=True)

    # Carica runs esistenti o inizia da zero
    if OUTFILE.exists():
        existing = json.loads(OUTFILE.read_text(encoding="utf-8"))
        runs = existing.get("runs", [])
    else:
        runs = []

    runs.append(new_run)

    # Tieni solo gli ultimi 12 run (24 ore a cadenza 2h)
    runs = runs[-12:]

    payload = {
        "generated_at": fetched_at,
        "station": {"lat": LAT, "lon": LON, "name": "Riva del Garda"},
        "model": "italia_meteo_arpae_icon_2i",
        "note": "TEST — da cancellare",
        "runs": runs
    }

    OUTFILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Salvato run {fetched_at} in {OUTFILE} ({len(runs)} run totali)")

if __name__ == "__main__":
    main()
