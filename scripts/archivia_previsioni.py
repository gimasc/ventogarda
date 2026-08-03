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

# ---- FINESTRA RECENTE DELLA PRESSIONE ----
# L'archivio mensile e' la verita' completa, ma pesa 11-15 MB: una pagina web
# non puo' scaricarlo per disegnare una linea. Da qui si ritaglia una finestra
# piccola con le ore GIA' PASSATE, che nel file di previsione non ci sono piu'
# (MOSMIX riparte da poche ore prima di ogni run, quattro volte al giorno).
# Serve al grafico dell'Indice Vento: i modelli di vento coprono la giornata da
# mezzanotte, e senza il ΔP di quelle ore l'indice non viene calcolato.
# Per ogni ora si tiene la previsione con l'ANTICIPO PIU' CORTO, cioe' l'ultima
# cosa che avevamo detto prima che quell'ora arrivasse.
FILE_PRESSIONE_RECENTE = Path("data/pressione_recente.json")
ORE_FINESTRA_RECENTE = 48


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


def scrivi_pressione_recente():
    """Ritaglia dall'archivio le ultime ore di pressione gia' passate.

    Non aggiunge un secondo archivio: legge quello che c'e' e ne estrae una
    finestra. Se qualcosa va storto stampa un avviso e non blocca nulla —
    l'archiviazione, che e' il compito principale, resta comunque salva.
    """
    import csv
    from datetime import datetime, timedelta, timezone

    adesso = datetime.now(timezone.utc)
    limite = adesso - timedelta(hours=ORE_FINESTRA_RECENTE)

    # il mese corrente basta quasi sempre; a cavallo di mese serve anche il precedente
    mesi = {adesso.astimezone(ROMA).strftime("%Y-%m"),
            (adesso - timedelta(days=2)).astimezone(ROMA).strftime("%Y-%m")}

    migliori = {}   # ora di validita' -> (anticipo, delta)
    for m in sorted(mesi):
        f = OUT_DIR / f"previsioni_{m}.csv"
        if not f.exists():
            continue
        with f.open(newline="", encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                if r["fonte"] != "pressione" or not r["delta_hpa"]:
                    continue
                valida = parse_utc(r["valida_utc"])
                if valida is None or not (limite <= valida <= adesso):
                    continue
                try:
                    ant = float(r["anticipo_h"])
                except (TypeError, ValueError):
                    continue
                chiave = valida.strftime("%Y-%m-%dT%H:00:00.000Z")
                if chiave not in migliori or ant < migliori[chiave][0]:
                    migliori[chiave] = (ant, float(r["delta_hpa"]))

    tempi = sorted(migliori)
    payload = {
        "generated_at": adesso.isoformat(),
        "descrizione": ("Ore gia' passate, ritagliate dall'archivio delle previsioni. "
                        "Per ogni ora il valore previsto con l'anticipo piu' corto. "
                        "La previsione delle ore future sta in "
                        "differenza-pressione/data/wind_garda.json"),
        "ore_finestra": ORE_FINESTRA_RECENTE,
        "time": tempi,
        "delta_hpa": [migliori[t][1] for t in tempi],
    }
    FILE_PRESSIONE_RECENTE.parent.mkdir(parents=True, exist_ok=True)
    FILE_PRESSIONE_RECENTE.write_text(
        json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{FILE_PRESSIONE_RECENTE}: {len(tempi)} ore passate "
          f"(finestra {ORE_FINESTRA_RECENTE}h)")


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

    # Sottoprodotto: la finestra recente della pressione per il grafico.
    # Isolata: un suo errore non deve far fallire l'archiviazione.
    try:
        scrivi_pressione_recente()
    except Exception as e:
        print(f"  avviso: finestra pressione non aggiornata ({e}); l'archivio e' salvo.")


if __name__ == "__main__":
    main()
