#!/usr/bin/env python3
"""
La finestra recente della pressione — resta nel repository PUBBLICO.

Il grafico dell'Indice Vento ha bisogno del ΔP delle ore GIA' PASSATE, che nel
file di previsione non ci sono piu': MOSMIX riparte da poche ore prima di ogni
run, quattro volte al giorno. Senza quei valori l'indice non si calcola per le
prime ore della giornata, perche' i modelli di vento coprono dalla mezzanotte.

Legge:  differenza-pressione/data/wind_garda.json   (la previsione corrente)
Scrive: data/pressione_recente.json                 (le ultime 48 ore passate)

PERCHE' STA QUI E NON NEL MOTORE PRIVATO
Prima questa finestra veniva ritagliata dall'archivio delle previsioni, dentro
archivia_previsioni.py. L'archivio e' passato al repository privato, ma questo
file no: **lo scarica il browser di ogni visitatore**, quindi deve restare
pubblico. Non svela nulla — sono valori di ΔP Bolzano-Brescia gia' disegnati
sul sito, e provengono da dati aperti DWD.

COME FA A SAPERE IL VALORE "GIUSTO" DI UN'ORA PASSATA
A ogni esecuzione prende dal file di previsione le ore ormai trascorse e le
aggiunge, ma **solo se non le ha gia'**. Cosi' per ogni ora resta registrato il
valore dell'ultima previsione emessa PRIMA che quell'ora arrivasse: l'anticipo
piu' corto, cioe' l'ultima cosa che avevamo detto. E' lo stesso criterio che
usava la versione precedente.

Va eseguito dalla radice della repository.
"""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

SORGENTE = Path("differenza-pressione/data/wind_garda.json")
DESTINAZIONE = Path("data/pressione_recente.json")

# Quante ore passate tenere. Il grafico ne mostra molte meno, ma il margine
# serve a coprire un'esecuzione saltata senza lasciare buchi.
ORE_FINESTRA = 48


def parse_utc(s):
    """Legge un orario dei nostri JSON e restituisce un datetime in UTC."""
    if not s:
        return None
    s = s.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        d = datetime.fromisoformat(s)
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc)


def chiave(d):
    """Formato usato dal grafico per gli orari."""
    return d.strftime("%Y-%m-%dT%H:00:00.000Z")


def main():
    adesso = datetime.now(timezone.utc)
    limite = adesso - timedelta(hours=ORE_FINESTRA)

    if not SORGENTE.exists():
        print(f"{SORGENTE}: assente, non aggiorno nulla.")
        return

    previsione = json.loads(SORGENTE.read_text(encoding="utf-8"))

    # Quello che abbiamo gia' registrato, ripulito dalle ore troppo vecchie.
    gia_noti = {}
    if DESTINAZIONE.exists():
        try:
            vecchio = json.loads(DESTINAZIONE.read_text(encoding="utf-8"))
            for t, v in zip(vecchio.get("time", []), vecchio.get("delta_hpa", [])):
                istante = parse_utc(t)
                if istante and istante >= limite:
                    gia_noti[chiave(istante)] = v
        except Exception as e:
            # Un file rovinato non deve bloccare l'aggiornamento: si riparte.
            print(f"{DESTINAZIONE}: illeggibile ({e}), lo rifaccio da zero.")

    # Le ore ormai passate presenti nella previsione corrente. Si aggiungono
    # solo quelle che mancano: la prima volta che un'ora diventa "passata", il
    # valore salvato e' quello dell'ultima previsione disponibile, cioe' con
    # l'anticipo piu' corto.
    nuove = 0
    for r in previsione.get("rows") or []:
        istante = parse_utc(r.get("time"))
        if istante is None or not (limite <= istante <= adesso):
            continue
        delta = r.get("delta_hpa")
        if delta is None:
            continue
        k = chiave(istante)
        if k not in gia_noti:
            gia_noti[k] = delta
            nuove += 1

    tempi = sorted(gia_noti)
    documento = {
        "generated_at": adesso.isoformat(),
        "descrizione": ("Ore gia' passate: per ciascuna, il valore previsto con "
                        "l'anticipo piu' corto. La previsione delle ore future "
                        "sta in differenza-pressione/data/wind_garda.json"),
        "ore_finestra": ORE_FINESTRA,
        "time": tempi,
        "delta_hpa": [gia_noti[t] for t in tempi],
    }

    DESTINAZIONE.parent.mkdir(parents=True, exist_ok=True)
    DESTINAZIONE.write_text(json.dumps(documento, ensure_ascii=False, indent=1),
                            encoding="utf-8")
    print(f"{DESTINAZIONE}: {len(tempi)} ore passate ({nuove} nuove, "
          f"finestra {ORE_FINESTRA}h)")


if __name__ == "__main__":
    main()
