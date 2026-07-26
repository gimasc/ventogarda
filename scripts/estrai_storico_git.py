#!/usr/bin/env python3
"""
RECUPERO RETROATTIVO — si esegue UNA VOLTA SOLA.

Ricostruisce l'archivio storico delle previsioni leggendo la storia di Git:
ogni volta che la sveglia automatica ha salvato i JSON, Git ne ha conservato
uno snapshot immutabile. Quegli snapshot NON somigliano alle previsioni che
abbiamo mostrato agli utenti: SONO quelle previsioni, byte per byte.

Legge:  data/meteo_torbole.json, data/meteo_malcesine.json,
        differenza-pressione/data/wind_garda.json  (tutte le versioni passate)
Scrive: data/storico/previsioni_AAAA-MM.csv

Va eseguito dalla radice della repository, con la storia completa disponibile
(su GitHub Actions serve "fetch-depth: 0" nel checkout).

Rieseguirlo non crea duplicati: le release gia' presenti vengono saltate.
"""
import hashlib
import json
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

from storico_comune import parse_utc, righe_da_snapshot, scrivi_mensili, ROMA

FILE_SORGENTE = [
    "data/meteo_torbole.json",
    "data/meteo_malcesine.json",
    "differenza-pressione/data/wind_garda.json",
]

OUT_DIR = Path("data/storico")


def elenco_commit(path):
    """Tutti i commit che hanno toccato il file, dal piu' recente al piu' vecchio."""
    r = subprocess.run(["git", "log", "--follow", "--format=%H", "--", path],
                       capture_output=True, text=True)
    return [s for s in r.stdout.split() if s]


def contenuto(sha, path):
    r = subprocess.run(["git", "show", f"{sha}:{path}"], capture_output=True, text=True)
    if r.returncode != 0:
        return None
    try:
        return json.loads(r.stdout)
    except json.JSONDecodeError:
        return None


def main():
    if not Path(".git").exists():
        print("ERRORE: eseguire dalla radice della repository (manca .git).")
        sys.exit(1)

    tutte_le_righe = []

    for path in FILE_SORGENTE:
        commit = elenco_commit(path)
        if not commit:
            print(f"{path}: nessuno snapshot in archivio, salto.")
            continue
        print(f"{path}: {len(commit)} snapshot da esaminare...")

        # La sveglia gira ogni 30 minuti, ma il modello esce ogni 3 ore: molti
        # salvataggi contengono numeri IDENTICI al precedente. Teniamo una sola
        # copia per ciascun contenuto, datata al momento in cui e' comparso la
        # prima volta (cioe' quando quella previsione e' diventata disponibile
        # per gli utenti). Cosi' l'archivio non conta due volte la stessa
        # previsione, che falserebbe le statistiche di affidabilita'.
        viste = set()
        snapshot = []
        for sha in reversed(commit):          # dal piu' vecchio al piu' recente
            d = contenuto(sha, path)
            if not d or not d.get("generated_at"):
                continue
            emesso = parse_utc(d["generated_at"])
            if emesso is None:
                continue
            impronta = hashlib.md5(
                json.dumps({k: v for k, v in d.items() if k != "generated_at"},
                           sort_keys=True).encode()
            ).hexdigest()
            if impronta in viste:
                continue
            viste.add(impronta)
            snapshot.append((emesso, d))

        # numero progressivo della release dentro la giornata ITALIANA
        contatore = defaultdict(int)
        righe_file = 0
        for emesso, d in snapshot:
            giorno = emesso.astimezone(ROMA).strftime("%Y-%m-%d")
            contatore[giorno] += 1
            righe = righe_da_snapshot(d, emesso, contatore[giorno])
            tutte_le_righe.extend(righe)
            righe_file += len(righe)
        print(f"  -> {len(snapshot)} release distinte, {righe_file} righe")

    if not tutte_le_righe:
        print("Nessun dato da archiviare.")
        return

    print(f"\nScrittura archivio ({len(tutte_le_righe)} righe totali)...")
    aggiunte = scrivi_mensili(tutte_le_righe, OUT_DIR)
    print(f"\nCompletato: {aggiunte} righe aggiunte all'archivio.")
    if aggiunte == 0:
        print("(erano gia' tutte presenti: nessun duplicato creato)")


if __name__ == "__main__":
    main()
