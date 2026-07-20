#!/usr/bin/env python3
"""
Scarica dati meteo e raffiche da Open-Meteo e li salva come JSON statici.
Output:
  data/meteo_torbole.json
  data/meteo_malcesine.json
Viene eseguito dalla root della repository.
"""
import json
import urllib.request
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

LOCALITA = {
    "torbole": {
        "lat_meteo": 45.86212,
        "lon_meteo": 10.87536,
        "spots": [
            {"nome": "Spiaggia Lucertole", "colore": "#ebc402", "lat": 45.84928, "lon": 10.86224},
            {"nome": "Hotel Pier",         "colore": "#0901fc", "lat": 45.84487, "lon": 10.82867},
            {"nome": "Terrazza Ponale",    "colore": "#e65100", "lat": 45.87807, "lon": 10.83904},
            {"nome": "Conca d'Oro",        "colore": "#15b101", "lat": 45.86212, "lon": 10.87536},
        ]
    },
    "malcesine": {
        "lat_meteo": 45.76,
        "lon_meteo": 10.81,
        "spots": [
            {"nome": "Limone",        "colore": "#ebc402", "lat": 45.81,  "lon": 10.79},
            {"nome": "Navene",        "colore": "#0901fc", "lat": 45.77,  "lon": 10.82},
            {"nome": "Parcheggione", "colore": "#e65100", "lat": 45.755, "lon": 10.815},
            {"nome": "Campione",     "colore": "#15b101", "lat": 45.735, "lon": 10.80},
        ]
    }
}

BASE_URL = "https://api.open-meteo.com/v1/forecast"

def fetch(params: dict) -> dict:
    url = f"{BASE_URL}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "ventogarda-github-action/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

def genera_localita(loc_id: str, cfg: dict) -> dict:
    # 1. Timeline meteo ibrida: MeteoSwiss prime 48h + icon_seamless 7gg
    ch1 = fetch({
        "latitude": cfg["lat_meteo"], "longitude": cfg["lon_meteo"],
        "hourly": "temperature_2m,precipitation_probability,precipitation,weather_code",
        "timezone": "Europe/Rome", "forecast_days": 2, "models": "meteoswiss_icon_ch1"
    })
    seamless = fetch({
        "latitude": cfg["lat_meteo"], "longitude": cfg["lon_meteo"],
        "hourly": "temperature_2m,precipitation_probability,precipitation,weather_code",
        "timezone": "Europe/Rome", "forecast_days": 7, "models": "icon_seamless"
    })

    cutoff = ch1["hourly"]["time"][-1]
    meteo_time, meteo_temp, meteo_prob, meteo_mm, meteo_cod = [], [], [], [], []

    for i, t in enumerate(seamless["hourly"]["time"]):
        if t <= cutoff:
            idx = ch1["hourly"]["time"].index(t) if t in ch1["hourly"]["time"] else -1
            if idx != -1:
                meteo_time.append(t)
                meteo_temp.append(ch1["hourly"]["temperature_2m"][idx])
                meteo_prob.append(ch1["hourly"]["precipitation_probability"][idx])
                meteo_mm.append(ch1["hourly"]["precipitation"][idx])
                meteo_cod.append(ch1["hourly"]["weather_code"][idx])
        else:
            meteo_time.append(t)
            meteo_temp.append(seamless["hourly"]["temperature_2m"][i])
            meteo_prob.append(seamless["hourly"]["precipitation_probability"][i])
            meteo_mm.append(seamless["hourly"]["precipitation"][i])
            meteo_cod.append(seamless["hourly"]["weather_code"][i])

    # 2. Raffiche per ogni spot
    spots_data = []
    for spot in cfg["spots"]:
        d = fetch({
            "latitude": spot["lat"], "longitude": spot["lon"],
            "hourly": "wind_gusts_10m,wind_direction_10m",
            "forecast_days": 2, "models": "meteoswiss_icon_ch1"
        })
        spots_data.append({
            "nome":      spot["nome"],
            "colore":    spot["colore"],
            "time":      d["hourly"]["time"],
            "raffiche":  d["hourly"]["wind_gusts_10m"],
            "direzione": d["hourly"]["wind_direction_10m"],
        })

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "localita": loc_id,
        "meteo": {
            "time":  meteo_time,
            "temp":  meteo_temp,
            "prob":  meteo_prob,
            "mm":    meteo_mm,
            "codici": meteo_cod,
        },
        "spots": spots_data,
    }

def main():
    out_dir = Path("data")
    out_dir.mkdir(parents=True, exist_ok=True)

    for loc_id, cfg in LOCALITA.items():
        print(f"Scarico {loc_id}...")
        try:
            payload = genera_localita(loc_id, cfg)
            out_file = out_dir / f"meteo_{loc_id}.json"
            out_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"  → {out_file} scritto OK")
        except Exception as e:
            print(f"  ERRORE {loc_id}: {e}")
            raise

if __name__ == "__main__":
    main()