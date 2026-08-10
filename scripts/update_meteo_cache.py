#!/usr/bin/env python3
"""
Scarica dati meteo e raffiche da Open-Meteo e li salva come JSON statici.
Output:
  data/meteo_torbole.json
  data/meteo_malcesine.json
Viene eseguito dalla root della repository.

Contenuto di ogni file:
  meteo   timeline oraria (temperatura, pioggia, cielo) — MeteoSwiss + icon_seamless
  spots   raffiche, direzione e vento medio per i 4 spot — MeteoSwiss ICON-CH1
  icon2i  vento, raffiche e direzione sul centro localita' — modello Meteotrentino
          (puo' essere null se quella singola chiamata fallisce)

Robustezza:
  - retry con backoff su ogni chiamata (assorbe intoppi di rete transitori)
  - isolamento per localita' (una localita' che fallisce non fa crollare le altre)
  - allarme di eta': se una localita' NON viene aggiornata e il suo JSON esistente
    e' piu' vecchio della soglia, lo script esce con errore (=> mail di avviso),
    cosi' un problema persistente non passa inosservato.
"""
import json
import sys
import time
import urllib.request
import urllib.parse
import urllib.error
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
            {"nome": "Limone",       "colore": "#ebc402", "lat": 45.81,  "lon": 10.79},
            {"nome": "Navene",       "colore": "#0901fc", "lat": 45.77,  "lon": 10.82},
            {"nome": "Retelino",     "colore": "#e65100", "lat": 45.755, "lon": 10.815},
            {"nome": "Campione",     "colore": "#15b101", "lat": 45.735, "lon": 10.80},
        ]
    }
}

BASE_URL = "https://api.open-meteo.com/v1/forecast"

# Se un JSON esistente non viene aggiornato ed e' piu' vecchio di questa soglia,
# lo script alza un allarme (exit 1). 6 ore = copre abbondantemente un paio di
# run ICON-CH1 (che escono ogni 3h) saltati, senza allarmare per un singolo
# intoppo transitorio gia' assorbito dal retry.
SOGLIA_ETA_ORE = 6

# Parametri retry: numero massimo di tentativi e pause (secondi) tra un
# tentativo e il successivo. Il retry scatta SOLO in caso di errore, quindi
# in condizioni normali non aggiunge chiamate.
RETRY_TENTATIVI = 3
RETRY_PAUSE = [2, 5, 10]


def fetch(params: dict) -> dict:
    url = f"{BASE_URL}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "ventogarda-github-action/1.0"})
    for n in range(RETRY_TENTATIVI):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except (urllib.error.URLError, TimeoutError) as e:
            if n < RETRY_TENTATIVI - 1:
                attesa = RETRY_PAUSE[min(n, len(RETRY_PAUSE) - 1)]
                print(f"    tentativo {n + 1}/{RETRY_TENTATIVI} fallito ({e}); riprovo tra {attesa}s")
                time.sleep(attesa)
            else:
                # esauriti i tentativi: propaga l'errore al chiamante
                raise


def genera_localita(loc_id: str, cfg: dict) -> dict:
    # 1. Timeline meteo ibrida: MeteoSwiss prime 48h + icon_seamless 7gg
    # NB: nessun parametro "timezone" => Open-Meteo risponde in UTC.
    # Deve restare cosi': il browser (toLocalTime) aggiunge la "Z" e converte
    # nell'ora locale del dispositivo. Chiedere "Europe/Rome" qui farebbe
    # arrivare orari gia' locali che verrebbero poi interpretati come UTC,
    # spostando la timeline di 1-2 ore. Le raffiche erano gia' in UTC: cosi'
    # tutti i dati del file sono omogenei (e immuni ai cambi di ora legale).
    ch1 = fetch({
        "latitude": cfg["lat_meteo"], "longitude": cfg["lon_meteo"],
        "hourly": "temperature_2m,precipitation_probability,precipitation,weather_code",
        "forecast_days": 2, "models": "meteoswiss_icon_ch1"
    })
    seamless = fetch({
        "latitude": cfg["lat_meteo"], "longitude": cfg["lon_meteo"],
        "hourly": "temperature_2m,precipitation_probability,precipitation,weather_code",
        "forecast_days": 7, "models": "icon_seamless"
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

    # 2. Raffiche + vento medio per ogni spot.
    #    wind_speed_10m viaggia nella STESSA chiamata delle raffiche: un
    #    parametro in piu', zero richieste aggiuntive a Open-Meteo.
    spots_data = []
    for spot in cfg["spots"]:
        d = fetch({
            "latitude": spot["lat"], "longitude": spot["lon"],
            "hourly": "wind_gusts_10m,wind_direction_10m,wind_speed_10m",
            "forecast_days": 2, "models": "meteoswiss_icon_ch1"
        })
        spots_data.append({
            "nome":        spot["nome"],
            "colore":      spot["colore"],
            "time":        d["hourly"]["time"],
            "raffiche":    d["hourly"]["wind_gusts_10m"],
            "direzione":   d["hourly"]["wind_direction_10m"],
            "vento_medio": d["hourly"].get("wind_speed_10m"),
        })

    # 3. Vento ICON-2I (il modello di Meteotrentino) sul centro della localita'.
    #    Serve all'Indice Vento (interpolazione): la serie MeteoSwiss dell'indice
    #    e' gia' nel file — lo spot "Conca d'Oro" ha le stesse coordinate del
    #    centro Torbole — quindi qui manca solo il secondo modello.
    #    ICON-2I copre 3 giorni contro i 2 degli spot: chi disegna deve allineare
    #    per orario, non per posizione nell'elenco.
    #    Opzionale per costruzione: se fallisce, icon2i resta None e tutto il
    #    resto della cache viene salvato lo stesso.
    icon2i_data = None
    try:
        d2i = fetch({
            "latitude": cfg["lat_meteo"], "longitude": cfg["lon_meteo"],
            "hourly": "wind_speed_10m,wind_direction_10m,wind_gusts_10m",
            "forecast_days": 3, "models": "italia_meteo_arpae_icon_2i"
        })
        icon2i_data = {
            "time":      d2i["hourly"]["time"],
            "vento":     d2i["hourly"]["wind_speed_10m"],
            "direzione": d2i["hourly"]["wind_direction_10m"],
            "raffiche":  d2i["hourly"]["wind_gusts_10m"],
        }
    except Exception as e:
        print(f"    avviso {loc_id}: dati ICON-2I non disponibili ({e}); continuo senza.")

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "localita": loc_id,
        "meteo": {
            "time":   meteo_time,
            "temp":   meteo_temp,
            "prob":   meteo_prob,
            "mm":     meteo_mm,
            "codici": meteo_cod,
        },
        "spots": spots_data,
        "icon2i": icon2i_data,
    }


def eta_ore_file(path: Path) -> float | None:
    """Ritorna l'eta' in ore del JSON esistente leggendo 'generated_at',
    oppure None se il file non esiste o non e' leggibile."""
    if not path.exists():
        return None
    try:
        dati = json.loads(path.read_text(encoding="utf-8"))
        gen = datetime.fromisoformat(dati["generated_at"])
        if gen.tzinfo is None:
            gen = gen.replace(tzinfo=timezone.utc)
        delta = datetime.now(timezone.utc) - gen
        return delta.total_seconds() / 3600
    except Exception:
        return None


def main():
    out_dir = Path("data")
    out_dir.mkdir(parents=True, exist_ok=True)

    successi = 0
    localita_stantie = []  # localita' fallite E con cache troppo vecchia

    for loc_id, cfg in LOCALITA.items():
        print(f"Scarico {loc_id}...")
        out_file = out_dir / f"meteo_{loc_id}.json"
        try:
            payload = genera_localita(loc_id, cfg)
            out_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"  -> {out_file} scritto OK")
            successi += 1
        except Exception as e:
            # Isolamento: NON rilanciamo, le altre localita' vanno comunque tentate.
            print(f"  ERRORE {loc_id}: {e}")
            eta = eta_ore_file(out_file)
            if eta is None:
                print(f"  ATTENZIONE {loc_id}: nessuna cache esistente da servire.")
                localita_stantie.append(loc_id)
            elif eta > SOGLIA_ETA_ORE:
                print(f"  ATTENZIONE {loc_id}: cache vecchia di {eta:.1f}h (> {SOGLIA_ETA_ORE}h).")
                localita_stantie.append(loc_id)
            else:
                print(f"  {loc_id}: uso la cache esistente ({eta:.1f}h fa), ancora valida.")

    print(f"Completato: {successi}/{len(LOCALITA)} localita' aggiornate.")

    # Allarme (exit 1 => mail) solo se un problema E' PERSISTENTE:
    # nessuna localita' aggiornata, oppure almeno una senza cache valida.
    if successi == 0:
        print("ALLARME: nessuna localita' aggiornata.")
        sys.exit(1)
    if localita_stantie:
        print(f"ALLARME: cache stantia o assente per: {', '.join(localita_stantie)}.")
        sys.exit(1)

    print("Tutto ok.")


if __name__ == "__main__":
    main()