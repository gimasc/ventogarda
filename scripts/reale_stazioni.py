#!/usr/bin/env python3
"""
Il vento MISURATO, per la scheda del sito.

Legge le stazioni reali (Circolo Surf Torbole e Hotel Pier, via relivecam.it) e
tiene aggiornati due file che il browser dei visitatori scarica:

    data/reale_torbole_surf.json
    data/reale_hotel_pier.json

Ciascuno contiene SOLO quello che si vede a schermo: l'ultimo dato, le ultime
ore minuto per minuto, e dieci giorni in medie orarie.

PERCHE' STA NEL REPOSITORY PUBBLICO
L'archivio completo delle misure — quasi un milione di righe al minuto da
giugno 2025 — vive nel repository privato ventogarda-motore e non esce di li'.
Ma il file che la pagina disegna deve per forza essere pubblico: lo scarica il
browser di ogni visitatore. Questo programma mantiene quella sola finestra,
senza toccare l'archivio.

Il vantaggio pratico: sui repository pubblici le esecuzioni automatiche sono
illimitate, quindi la scheda puo' aggiornarsi ogni 10 minuti invece che ogni 30.

COME MANTIENE LA FINESTRA
A ogni giro chiede alla stazione la giornata intera e la fonde con quello che
ha gia' nel file, poi taglia via cio' che e' piu' vecchio della finestra. Non
serve nessun archivio d'appoggio: lo stato sta nel file stesso. Se un'esecuzione
salta, quella dopo recupera da sola.

CREDENZIALI: dalle variabili d'ambiente RELIVECAM_USER e RELIVECAM_PASS, che su
GitHub arrivano dai Secrets del repository. I Secrets non sono leggibili nemmeno
in un repository pubblico, e non vengono passati ai workflow avviati da fork.
"""
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from math import atan2, cos, degrees, radians, sin
from pathlib import Path
from zoneinfo import ZoneInfo

ROMA = ZoneInfo("Europe/Rome")

URL_LOGIN = "https://www.relivecam.it/public/api/login.php"
URL_SERIE = "https://www.relivecam.it/public/api/meteoData.php"
STAZIONE_KEY = os.environ.get("RELIVECAM_STATION", "w45aLCWAtlzZzRNj")

# Le stesse stazioni del motore privato: a cambiare e' solo id_servizio.
STAZIONI = [
    {"chiave": "torbole_surf", "nome": "Circolo Surf Torbole", "id_servizio": 23},
    {"chiave": "hotel_pier", "nome": "Hotel Pier", "id_servizio": 25},
]

NODI_PER_MS = 1.94384

# Quanto tiene la coda mostrata dal grafico.
GIORNI_CODA = 10
# Entro quante ore si tiene il dettaglio minuto per minuto. Oltre, medie orarie.
# Sei ore bastano a vedere l'Ora che monta e tengono il file sui 20 KB.
ORE_DETTAGLIO = 6

# Se il dato piu' recente supera questa eta', la pagina lo dira' invece di
# far finta di niente: mostrare un dato vecchio come fosse fresco e' peggio
# che ammettere che manca.
SOGLIA_ETA_MIN = 60

RETRY_TENTATIVI = 3
RETRY_PAUSE = [2, 5, 10]

DIR_DATI = Path("data")


def chiamata(url, dati=None, intestazioni=None):
    """Una richiesta HTTP con retry a pause crescenti (2, 5, 10 secondi)."""
    testate = {"Accept": "application/json"}
    if intestazioni:
        testate.update(intestazioni)
    corpo = json.dumps(dati).encode("utf-8") if dati is not None else None
    if corpo:
        testate["Content-Type"] = "application/json"

    ultimo = None
    for tentativo in range(RETRY_TENTATIVI):
        try:
            req = urllib.request.Request(url, data=corpo, headers=testate)
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            ultimo = e
            if tentativo < RETRY_TENTATIVI - 1:
                time.sleep(RETRY_PAUSE[tentativo])
    raise RuntimeError(f"{url}: {ultimo}")


def login():
    utente = os.environ.get("RELIVECAM_USER")
    password = os.environ.get("RELIVECAM_PASS")
    if not utente or not password:
        raise RuntimeError("Mancano RELIVECAM_USER e RELIVECAM_PASS "
                           "(su GitHub: i Secrets del repository).")
    r = chiamata(URL_LOGIN, dati={"username": utente, "password": password})
    if not r.get("token"):
        raise RuntimeError(f"Login rifiutato: {r.get('error', r)}")
    # L'endpoint della serie vuole ANCHE X-User-Id, che quello del solo ultimo
    # dato non richiedeva.
    return {"Authorization": f"Bearer {r['token']}",
            "X-User-Id": str(r.get("user_id", ""))}


def num(v):
    if v is None or v == "":
        return None
    try:
        return float(str(v).replace(",", "."))
    except ValueError:
        return None


def media_direzioni(gradi):
    """Media di direzioni fatta come vettori.

    La media aritmetica sbaglia: fra 350 e 10 gradi darebbe 180 (sud) invece di
    0 (nord). Si sommano i versori e si guarda dove punta la somma.
    """
    validi = [g for g in gradi if g is not None]
    if not validi:
        return None
    x = sum(cos(radians(g)) for g in validi)
    y = sum(sin(radians(g)) for g in validi)
    if abs(x) < 1e-9 and abs(y) < 1e-9:
        return None
    return round(degrees(atan2(y, x))) % 360


def scarica_oggi(intestazioni, st, adesso):
    """La giornata in corso. Nella prima ora dopo mezzanotte prende anche ieri,
    cosi' un'esecuzione saltata non lascia un buco."""
    oggi = adesso.astimezone(ROMA).date()
    da = oggi - timedelta(days=1) if adesso.astimezone(ROMA).hour < 1 else oggi
    url = (f"{URL_SERIE}?station_key={STAZIONE_KEY}&id_servizio={st['id_servizio']}"
           f"&data_inizio={da:%Y-%m-%d}&data_fine={oggi:%Y-%m-%d}")
    r = chiamata(url, intestazioni=intestazioni)
    if isinstance(r, list):
        return r
    return []                      # "Record non trovato" o forma inattesa


def normalizza(grezzi):
    """Da record dell'API a punti (istante UTC, vento, raffica, direzione).

    Gli orari della stazione sono in ORA ITALIANA, il vento in metri al secondo.
    Qui diventano UTC e nodi, che e' la convenzione di tutto il progetto.
    """
    punti = {}
    for g in grezzi:
        testo = g.get("data")
        if not testo:
            continue
        try:
            locale = datetime.strptime(testo, "%Y-%m-%d %H:%M:%S").replace(tzinfo=ROMA)
        except ValueError:
            continue
        utc = locale.astimezone(timezone.utc)
        vento = num(g.get("velocita_vento_media"))
        if vento is None:
            vento = num(g.get("velocita_vento"))
        raffica = num(g.get("raffica_vento"))
        punti[utc.strftime("%Y-%m-%dT%H:%M")] = {
            "v": round(vento * NODI_PER_MS, 1) if vento is not None else None,
            "r": round(raffica * NODI_PER_MS, 1) if raffica is not None else None,
            "d": num(g.get("gradi_direzione_vento")),
            "testo": g.get("direzione_vento", ""),
            "t": num(g.get("temperatura")),
            "u": num(g.get("umidita")),
            "p": num(g.get("pressione")),
        }
    return punti


def leggi_esistente(path):
    """I punti gia' salvati nel file, riportati alla forma interna."""
    if not path.exists():
        return {}, {}
    try:
        d = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}, {}
    dett = {}
    s = d.get("serie_dettaglio") or {}
    for i, t in enumerate(s.get("time") or []):
        dett[t] = {"v": (s.get("vento_medio_kn") or [None])[i]
                   if i < len(s.get("vento_medio_kn") or []) else None,
                   "r": (s.get("raffica_kn") or [None])[i]
                   if i < len(s.get("raffica_kn") or []) else None,
                   "d": (s.get("direzione_gradi") or [None])[i]
                   if i < len(s.get("direzione_gradi") or []) else None}
    ore = {}
    o = d.get("serie_oraria") or {}
    for i, t in enumerate(o.get("time") or []):
        ore[t] = {"v": (o.get("vento_medio_kn") or [None])[i]
                  if i < len(o.get("vento_medio_kn") or []) else None,
                  "r": (o.get("raffica_kn") or [None])[i]
                  if i < len(o.get("raffica_kn") or []) else None,
                  "d": (o.get("direzione_gradi") or [None])[i]
                  if i < len(o.get("direzione_gradi") or []) else None,
                  "n": (o.get("n_campioni") or [None])[i]
                  if i < len(o.get("n_campioni") or []) else None}
    return dett, ore


def aggrega_ore(punti):
    """Medie orarie dai punti al minuto.

    Le stesse regole con cui andranno confrontate le previsioni: il vento e' la
    MEDIA dell'ora, la raffica il MASSIMO (i modelli danno il picco orario), la
    direzione una media vettoriale.
    """
    per_ora = {}
    for t, p in punti.items():
        per_ora.setdefault(t[:13] + ":00", []).append(p)
    fuori = {}
    for ora, gruppo in per_ora.items():
        venti = [p["v"] for p in gruppo if p["v"] is not None]
        raff = [p["r"] for p in gruppo if p["r"] is not None]
        fuori[ora] = {
            "v": round(sum(venti) / len(venti), 1) if venti else None,
            "r": max(raff) if raff else None,
            "d": media_direzioni([p.get("d") for p in gruppo]),
            "n": len(gruppo),
        }
    return fuori


def aggiorna(intestazioni, st, adesso):
    path = DIR_DATI / f"reale_{st['chiave']}.json"
    dett_vecchio, ore_vecchie = leggi_esistente(path)

    nuovi = normalizza(scarica_oggi(intestazioni, st, adesso))
    if not nuovi and not dett_vecchio:
        print(f"  {st['chiave']}: nessun dato e nessuno storico, salto.")
        return False

    # Le ore si ricalcolano dai punti nuovi e si fondono con quelle gia' note:
    # le ore vecchie non sono ricostruibili, quelle di oggi vanno riviste.
    ore = dict(ore_vecchie)
    ore.update(aggrega_ore(nuovi))

    dett = dict(dett_vecchio)
    for t, p in nuovi.items():
        dett[t] = {"v": p["v"], "r": p["r"], "d": p["d"]}

    # Si taglia via quello che e' uscito dalla finestra.
    limite_dett = (adesso - timedelta(hours=ORE_DETTAGLIO)).strftime("%Y-%m-%dT%H:%M")
    limite_ore = (adesso - timedelta(days=GIORNI_CODA)).strftime("%Y-%m-%dT%H:%M")
    dett = {t: p for t, p in dett.items() if t >= limite_dett}
    ore = {t: p for t, p in ore.items() if t >= limite_ore}

    t_dett = sorted(dett)
    t_ore = sorted(ore)
    if not t_dett:
        print(f"  {st['chiave']}: finestra vuota, non scrivo.")
        return False

    ultimo_t = t_dett[-1]
    ultimo_p = nuovi.get(ultimo_t, {})
    eta_min = (adesso - datetime.strptime(ultimo_t, "%Y-%m-%dT%H:%M").replace(
        tzinfo=timezone.utc)).total_seconds() / 60

    documento = {
        "generated_at": adesso.isoformat(),
        "stazione": st["chiave"],
        "stazione_nome": st["nome"],
        "fonte": "relivecam.it",
        "unita": {"vento": "kn", "temperatura": "C", "pressione": "hPa",
                  "orari": "UTC"},
        "eta_minuti": round(eta_min),
        "ultimo": {
            "time": ultimo_t,
            "vento_medio_kn": dett[ultimo_t]["v"],
            "raffica_kn": dett[ultimo_t]["r"],
            "direzione_gradi": dett[ultimo_t]["d"],
            "direzione_testo": ultimo_p.get("testo", ""),
            "temperatura_c": ultimo_p.get("t"),
            "umidita_pct": ultimo_p.get("u"),
            "pressione_hpa": ultimo_p.get("p"),
        },
        "serie_dettaglio": {
            "time": t_dett,
            "vento_medio_kn": [dett[t]["v"] for t in t_dett],
            "raffica_kn": [dett[t]["r"] for t in t_dett],
            "direzione_gradi": [dett[t]["d"] for t in t_dett],
        },
        "serie_oraria": {
            "time": t_ore,
            "vento_medio_kn": [ore[t]["v"] for t in t_ore],
            "raffica_kn": [ore[t]["r"] for t in t_ore],
            "direzione_gradi": [ore[t]["d"] for t in t_ore],
            "n_campioni": [ore[t].get("n") for t in t_ore],
        },
    }

    DIR_DATI.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(documento, ensure_ascii=False), encoding="utf-8")
    print(f"  {st['chiave']}: {len(nuovi)} misure ricevute · "
          f"{len(t_dett)} punti al minuto + {len(t_ore)} ore · "
          f"ultimo {dett[ultimo_t]['v']} kn / raffica {dett[ultimo_t]['r']} kn · "
          f"ritardo {eta_min:.0f} min")
    if eta_min > SOGLIA_ETA_MIN:
        print(f"    ATTENZIONE: dato vecchio di {eta_min:.0f} minuti.")
    return True


def main():
    adesso = datetime.now(timezone.utc)
    try:
        intestazioni = login()
    except Exception as e:
        print(f"ERRORE al login: {e}")
        sys.exit(1)

    esiti = []
    for st in STAZIONI:
        # Isolamento per stazione: una che fallisce non deve impedire all'altra
        # di aggiornarsi.
        try:
            esiti.append(aggiorna(intestazioni, st, adesso))
        except Exception as e:
            print(f"  {st['chiave']}: ERRORE ({e})")
            esiti.append(False)

    if not any(esiti):
        print("Nessuna stazione aggiornata.")
        sys.exit(1)


if __name__ == "__main__":
    main()
