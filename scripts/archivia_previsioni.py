#!/usr/bin/env python3
"""
ARCHIVIAZIONE CONTINUA — si esegue ad ogni giro della sveglia.

Prende le previsioni appena salvate e le aggiunge al file del mese in corso.
Da qui in avanti non si perde piu' nulla: ogni release resta registrata
esattamente com'e' stata mostrata agli utenti.

Legge:  data/meteo_torbole.json, data/meteo_malcesine.json,
        differenza-pressione/data/wind_garda.json
Scrive: data/storico/previsioni_AAAA-MM.csv  (il mese corrente si allunga)

E' innocuo rieseguirlo: se la release e' gia' archiviata, non fa nulla. Cosi'
puo' girare anche ogni 30 minuti pur uscendo il modello ogni 3 ore.
"""
import json
import sys
from collections import defaultdict
from pathlib import Path

from storico_comune import (ROMA, parse_utc, righe_da_snapshot, scrivi_mensili)

FILE_SORGENTE = [
    Path("data/meteo_torbole.json"),
    Path("data/meteo_malcesine.json"),
    Path("differenza-pressione/data/wind_garda.json"),
]

OUT_DIR = Path("data/storico")


def numero_release_del_giorno(emesso, fonte_file):
    """Quante release di questo file risultano gia' archiviate oggi, +1.

    Serve solo come colonna di comodo ('e' la terza release di oggi'):
    l'identita' vera di una previsione resta l'orario di emissione.
    """
    import csv
    giorno = emesso.astimezone(ROMA).strftime("%Y-%m-%d")
    f = OUT_DIR / f"previsioni_{emesso.astimezone(ROMA).strftime('%Y-%m')}.csv"
    if not f.exists():
        return 1
    viste = set()
    with f.open(newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            if r["emesso_italia"][:10] == giorno and r["fonte"] == fonte_file:
                viste.add(r["emesso_utc"])
    return len(viste) + 1


def main():
    righe = []
    letti = 0

    for path in FILE_SORGENTE:
        if not path.exists():
            print(f"{path}: assente, salto.")
            continue
        try:
            dati = json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"{path}: illeggibile ({e}), salto.")
            continue

        emesso = parse_utc(dati.get("generated_at"))
        if emesso is None:
            print(f"{path}: manca la data di emissione, salto.")
            continue

        # la fonte principale del file, per contare le release della giornata
        fonte = "pressione" if "rows" in dati else "meteoswiss_ch1"
        n_rel = numero_release_del_giorno(emesso, fonte)

        nuove = righe_da_snapshot(dati, emesso, n_rel)
        righe.extend(nuove)
        letti += 1
        print(f"{path.name}: release delle {emesso.astimezone(ROMA):%d/%m %H:%M} "
              f"(ora italiana) -> {len(nuove)} righe")

    if not righe:
        print("Niente da archiviare.")
        return

    aggiunte = scrivi_mensili(righe, OUT_DIR)
    if aggiunte:
        print(f"Archiviate {aggiunte} righe nuove.")
    else:
        print("Nessuna novita': queste release erano gia' in archivio.")


if __name__ == "__main__":
    main()
