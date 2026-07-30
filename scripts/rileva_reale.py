#!/usr/bin/env python3
"""
RILEVAZIONE REALE — stazione meteo del Circolo Surf Torbole (via relivecam.it).

E' il primo dato MISURATO del progetto: fino ad ora il sito mostrava solo
previsioni. Serve a due cose diverse:
  1. la scheda "in tempo reale" sulla pagina di Torbole (l'ultimo dato + la
     coda dei dieci giorni precedenti)
  2. l'archivio grezzo previsione-contro-realta', base della Fase 3

Legge:  API relivecam (login + meteoDataLatest)
Scrive: data/reale_torbole.json                       (per il sito)
        data/storico/reale/misure_AAAA-MM-GG.csv      (archivio grezzo)
        data/storico/reale/log_reale.txt              (registro esecuzioni)

Va eseguito dalla radice della repository.

CREDENZIALI — non sono scritte qui dentro. Lo script le legge da due
variabili d'ambiente, che su GitHub arrivano dai Secrets del repository:
    RELIVECAM_USER
    RELIVECAM_PASS
Per provarlo sul proprio computer basta impostarle prima di lanciarlo.

ORARI — la stazione datta in ORA ITALIANA ("2026-07-30 18:12:02", verificato
confrontando l'orologio del PC con la risposta dell'API). Tutto il resto del
progetto ragiona in UTC, quindi la conversione avviene qui, subito: nei file
salvati l'ora italiana resta solo come colonna di lettura umana.

UNITA' — la stazione esprime il vento in metri al secondo. E' una deduzione,
non una conferma del fornitore: 4,7 m/s = 9,1 nodi contro gli 11 nodi letti su
Addicted Sports nello stesso momento, mentre km/h (2,5 nodi) e nodi (4,7) erano
lontanissimi. Per non restare ostaggio di questa deduzione, l'archivio conserva
SIA il valore grezzo SIA quello convertito: se un giorno il fornitore dicesse
un'altra unita', si ricalcola tutto senza aver perso niente.
"""
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from math import atan2, cos, degrees, radians, sin
from pathlib import Path
from zoneinfo import ZoneInfo

ROMA = ZoneInfo("Europe/Rome")

URL_LOGIN = "https://www.relivecam.it/public/api/login.php"
URL_DATI = "https://www.relivecam.it/public/api/meteoDataLatest.php"
STAZIONE_KEY = os.environ.get("RELIVECAM_STATION", "w45aLCWAtlzZzRNj")

LOCALITA = "torbole"
STAZIONE_NOME = "circolo_surf_torbole"

# Fattore di conversione. Vedi la nota UNITA' in cima al file.
NODI_PER_MS = 1.94384

# Quanto passato tiene la coda mostrata dal sito.
GIORNI_CODA = 10
# Entro quante ore la coda resta a piena risoluzione (un punto ogni chiamata).
# Oltre, si passa alla media oraria: tiene il file leggero senza perdere la
# forma della giornata.
ORE_DETTAGLIO = 48

# Se il dato piu' recente e' piu' vecchio di questa soglia, lo script esce con
# errore: GitHub manda una mail e il problema non passa inosservato. La
# stazione aggiorna ogni minuto e noi passiamo ogni dieci, quindi un'ora di
# silenzio significa che qualcosa si e' rotto davvero.
SOGLIA_ETA_MIN = 60

RETRY_TENTATIVI = 3
RETRY_PAUSE = [2, 5, 10]

OUT_JSON = Path("data/reale_torbole.json")
OUT_DIR = Path("data/storico/reale")
LOG = OUT_DIR / "log_reale.txt"
LOG_RIGHE_MAX = 500

COLONNE = [
    "istante_utc", "istante_italia", "localita", "stazione",
    "vento_medio_kn", "raffica_kn", "direzione_gradi", "direzione_testo",
    "vento_medio_ms", "raffica_ms",
    "temperatura_c", "umidita_pct", "punto_rugiada_c", "pressione_hpa",
    "radiazione_wm2", "uv", "pioggia_mm", "pioggia_giorno_mm",
]


# ---------------------------------------------------------------- utilita'

def num(v):
    """Legge un numero che l'API puo' mandare come numero o come stringa."""
    if v is None or v == "":
        return None
    try:
        return float(str(v).replace(",", "."))
    except ValueError:
        return None


def ms_a_nodi(v):
    return None if v is None else round(v * NODI_PER_MS, 1)


def fmt_utc(d):
    return d.strftime("%Y-%m-%d %H:%M:%S")


def fmt_italia(d):
    return d.astimezone(ROMA).strftime("%Y-%m-%d %H:%M:%S")


def iso_breve(d):
    """Formato degli orari dentro i JSON del sito: UTC senza marcatura.

    E' la convenzione gia' in uso (data/meteo_*.json): il browser aggiunge la
    "Z" prima di interpretarli, vedi la funzione di lettura in
    scripts/script_cachefirst.js.
    """
    return d.strftime("%Y-%m-%dT%H:%M")


def scrivi_log(riga):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    testo = f"{datetime.now(timezone.utc):%Y-%m-%d %H:%M:%S} UTC  {riga}"
    print(testo)
    vecchie = LOG.read_text(encoding="utf-8").splitlines() if LOG.exists() else []
    vecchie.append(testo)
    LOG.write_text("\n".join(vecchie[-LOG_RIGHE_MAX:]) + "\n", encoding="utf-8")


def chiamata(url, dati=None, token=None):
    """Una richiesta HTTP con retry a pause crescenti (2, 5, 10 secondi).

    Il retry scatta solo in caso di errore: in condizioni normali la chiamata
    resta una sola.
    """
    intestazioni = {"Accept": "application/json"}
    corpo = None
    if dati is not None:
        corpo = json.dumps(dati).encode("utf-8")
        intestazioni["Content-Type"] = "application/json"
    if token:
        intestazioni["Authorization"] = f"Bearer {token}"

    ultimo_errore = None
    for tentativo in range(RETRY_TENTATIVI):
        try:
            req = urllib.request.Request(url, data=corpo, headers=intestazioni)
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:                      # rete, timeout, JSON rotto
            ultimo_errore = e
            if tentativo < RETRY_TENTATIVI - 1:
                time.sleep(RETRY_PAUSE[tentativo])
    raise RuntimeError(f"{url}: {ultimo_errore}")


# ---------------------------------------------------------------- lettura

def login():
    utente = os.environ.get("RELIVECAM_USER")
    password = os.environ.get("RELIVECAM_PASS")
    if not utente or not password:
        raise RuntimeError(
            "Mancano le credenziali: impostare RELIVECAM_USER e RELIVECAM_PASS "
            "(su GitHub arrivano dai Secrets del repository)."
        )
    risposta = chiamata(URL_LOGIN, dati={"username": utente, "password": password})
    if not risposta.get("token"):
        raise RuntimeError(f"Login rifiutato: {risposta.get('error', risposta)}")
    return risposta["token"]


def normalizza(grezzo):
    """Trasforma la risposta dell'API in una riga d'archivio.

    Restituisce (istante_utc, dizionario_riga).
    """
    testo_data = grezzo.get("data")
    if not testo_data:
        raise RuntimeError("La risposta non contiene la data del rilevamento.")

    # L'orario arriva senza fuso: e' ora italiana (vedi nota ORARI in cima).
    # Nell'ora ripetuta del cambio d'ora si sceglie la prima occorrenza: e'
    # una convenzione, e riguarda un solo dato all'anno.
    locale = datetime.strptime(testo_data, "%Y-%m-%d %H:%M:%S").replace(tzinfo=ROMA)
    utc = locale.astimezone(timezone.utc)

    vento_ms = num(grezzo.get("velocita_vento_media"))
    if vento_ms is None:
        vento_ms = num(grezzo.get("velocita_vento"))
    raffica_ms = num(grezzo.get("raffica_vento"))

    riga = {
        "istante_utc": fmt_utc(utc),
        "istante_italia": fmt_italia(utc),
        "localita": LOCALITA,
        "stazione": STAZIONE_NOME,
        "vento_medio_kn": ms_a_nodi(vento_ms),
        "raffica_kn": ms_a_nodi(raffica_ms),
        "direzione_gradi": num(grezzo.get("gradi_direzione_vento")),
        "direzione_testo": grezzo.get("direzione_vento", ""),
        "vento_medio_ms": vento_ms,
        "raffica_ms": raffica_ms,
        "temperatura_c": num(grezzo.get("temperatura")),
        "umidita_pct": num(grezzo.get("umidita")),
        "punto_rugiada_c": num(grezzo.get("punto_rugiada")),
        "pressione_hpa": num(grezzo.get("pressione")),
        "radiazione_wm2": num(grezzo.get("radiazionesolare")),
        "uv": num(grezzo.get("uv_factor")),
        "pioggia_mm": num(grezzo.get("rainmm")),
        "pioggia_giorno_mm": num(grezzo.get("dailyrainmm")),
    }
    riga = {c: ("" if riga.get(c) is None else riga.get(c, "")) for c in COLONNE}
    return utc, riga


# ---------------------------------------------------------------- archivio

def file_del_giorno(utc):
    """Un file per giorno, non per mese.

    Ogni salvataggio riscrive il file per intero e Git ne conserva una copia:
    con file mensili da qualche megabyte, riscritti ogni dieci minuti, la
    repository crescerebbe di centinaia di megabyte al mese. I file giornalieri
    restano piccoli e il peso resta trascurabile.
    """
    return OUT_DIR / f"misure_{utc.astimezone(ROMA):%Y-%m-%d}.csv"


def salva_riga(utc, riga):
    """Aggiunge la misura al file del giorno. Se c'e' gia', non fa nulla.

    L'identita' del dato e' l'istante MISURATO dalla stazione, non l'ora in cui
    lo abbiamo chiesto: rilanciare lo script non crea doppioni.
    """
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    f = file_del_giorno(utc)

    esistenti = []
    if f.exists():
        with f.open(newline="", encoding="utf-8") as fh:
            esistenti = list(csv.DictReader(fh))
        if any(r["istante_utc"] == riga["istante_utc"] for r in esistenti):
            return False

    esistenti.append(riga)
    esistenti.sort(key=lambda r: r["istante_utc"])
    with f.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=COLONNE)
        w.writeheader()
        w.writerows(esistenti)
    return True


def leggi_coda(fino_a):
    """Rilegge dall'archivio le misure degli ultimi GIORNI_CODA giorni."""
    righe = []
    for delta in range(GIORNI_CODA + 1):
        giorno = fino_a - timedelta(days=delta)
        f = file_del_giorno(giorno)
        if not f.exists():
            continue
        with f.open(newline="", encoding="utf-8") as fh:
            righe.extend(csv.DictReader(fh))

    limite = fino_a - timedelta(days=GIORNI_CODA)
    fuori = []
    for r in righe:
        try:
            t = datetime.strptime(r["istante_utc"], "%Y-%m-%d %H:%M:%S").replace(
                tzinfo=timezone.utc)
        except (KeyError, ValueError):
            continue
        if t >= limite:
            fuori.append((t, r))
    fuori.sort(key=lambda x: x[0])
    return fuori


def media_direzioni(gradi):
    """Media di direzioni, fatta come vettori.

    La media aritmetica qui sbaglia: fra 350 e 10 gradi darebbe 180 (sud)
    invece di 0 (nord). Si sommano i versori e si guarda dove punta la somma.
    """
    validi = [g for g in gradi if g is not None]
    if not validi:
        return None
    x = sum(cos(radians(g)) for g in validi)
    y = sum(sin(radians(g)) for g in validi)
    if abs(x) < 1e-9 and abs(y) < 1e-9:
        return None                       # direzioni opposte che si annullano
    # L'arrotondamento precede il modulo: al contrario, una somma che punta a
    # nord con un errore di calcolo infinitesimo darebbe 360 invece di 0.
    return round(degrees(atan2(y, x))) % 360


def aggrega_orario(coda):
    """Comprime le misure in valori orari.

    Le stesse regole con cui andranno confrontate le previsioni: il vento e' la
    MEDIA dell'ora, la raffica e' il MASSIMO dell'ora (i modelli danno il picco
    orario, non la media dei picchi).
    """
    per_ora = {}
    for t, r in coda:
        chiave = t.replace(minute=0, second=0, microsecond=0)
        per_ora.setdefault(chiave, []).append(r)

    fuori = []
    for ora in sorted(per_ora):
        gruppo = per_ora[ora]
        venti = [num(r["vento_medio_kn"]) for r in gruppo]
        venti = [v for v in venti if v is not None]
        raffiche = [num(r["raffica_kn"]) for r in gruppo]
        raffiche = [v for v in raffiche if v is not None]
        fuori.append({
            "time": iso_breve(ora),
            "vento_medio_kn": round(sum(venti) / len(venti), 1) if venti else None,
            "raffica_kn": max(raffiche) if raffiche else None,
            "direzione_gradi": media_direzioni([num(r["direzione_gradi"]) for r in gruppo]),
            "n_campioni": len(gruppo),
        })
    return fuori


def colonne(elenco, chiave):
    return [e[chiave] for e in elenco]


def scrivi_json(coda, ultimo_utc, ultima_riga):
    """Ricostruisce il file letto dal sito, partendo sempre dall'archivio.

    Non accoda al file precedente: lo rifa' da zero ogni volta. Cosi' se una
    esecuzione salta o scrive male, quella dopo rimette tutto a posto da sola.
    """
    dettaglio = [(t, r) for t, r in coda
                 if t >= ultimo_utc - timedelta(hours=ORE_DETTAGLIO)]

    serie_dettaglio = {
        "time": [iso_breve(t) for t, _ in dettaglio],
        "vento_medio_kn": [num(r["vento_medio_kn"]) for _, r in dettaglio],
        "raffica_kn": [num(r["raffica_kn"]) for _, r in dettaglio],
        "direzione_gradi": [num(r["direzione_gradi"]) for _, r in dettaglio],
    }

    oraria = aggrega_orario(coda)
    serie_oraria = {
        "time": colonne(oraria, "time"),
        "vento_medio_kn": colonne(oraria, "vento_medio_kn"),
        "raffica_kn": colonne(oraria, "raffica_kn"),
        "direzione_gradi": colonne(oraria, "direzione_gradi"),
        "n_campioni": colonne(oraria, "n_campioni"),
    }

    documento = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "localita": LOCALITA,
        "stazione": STAZIONE_NOME,
        "stazione_nome": "Circolo Surf Torbole",
        "fonte": "relivecam.it",
        "unita": {"vento": "kn", "temperatura": "C", "pressione": "hPa",
                  "orari": "UTC"},
        "ultimo": {
            "time": iso_breve(ultimo_utc),
            "vento_medio_kn": num(ultima_riga["vento_medio_kn"]),
            "raffica_kn": num(ultima_riga["raffica_kn"]),
            "direzione_gradi": num(ultima_riga["direzione_gradi"]),
            "direzione_testo": ultima_riga["direzione_testo"],
            "temperatura_c": num(ultima_riga["temperatura_c"]),
            "umidita_pct": num(ultima_riga["umidita_pct"]),
            "pressione_hpa": num(ultima_riga["pressione_hpa"]),
            "pioggia_giorno_mm": num(ultima_riga["pioggia_giorno_mm"]),
        },
        "serie_dettaglio": serie_dettaglio,
        "serie_oraria": serie_oraria,
    }

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(documento, ensure_ascii=False), encoding="utf-8")
    return len(serie_dettaglio["time"]), len(serie_oraria["time"])


# ---------------------------------------------------------------- principale

def main():
    try:
        token = login()
        grezzo = chiamata(f"{URL_DATI}?station_key={STAZIONE_KEY}", token=token)
        utc, riga = normalizza(grezzo)
    except Exception as e:
        scrivi_log(f"ERRORE: {e}")
        sys.exit(1)

    eta_min = (datetime.now(timezone.utc) - utc).total_seconds() / 60

    nuova = salva_riga(utc, riga)
    coda = leggi_coda(utc)
    n_dett, n_ore = scrivi_json(coda, utc, riga)

    stato = "nuova" if nuova else "gia' presente"
    scrivi_log(
        f"OK  misura {riga['istante_italia']} (ora italiana), {stato} · "
        f"vento {riga['vento_medio_kn']} kn, raffica {riga['raffica_kn']} kn, "
        f"dir {riga['direzione_gradi']}° · "
        f"coda {n_dett} punti di dettaglio + {n_ore} ore · "
        f"ritardo {eta_min:.0f} min"
    )

    if eta_min > SOGLIA_ETA_MIN:
        scrivi_log(
            f"ALLARME: il dato piu' recente ha {eta_min:.0f} minuti "
            f"(soglia {SOGLIA_ETA_MIN}). La stazione potrebbe essere ferma."
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
