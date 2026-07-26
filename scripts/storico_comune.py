#!/usr/bin/env python3
"""
Funzioni condivise per l'archivio storico delle previsioni VentoGarda.

Usato da:
  - estrai_storico_git.py    (recupero retroattivo, una volta sola)
  - archivia_previsioni.py   (archiviazione continua, ad ogni release)

CONVENZIONE SUGLI ORARI — importante:
  Tutti gli orari salvati nei nostri JSON sono in UTC (ora universale).
  Nell'archivio ogni istante compare in DUE colonne:
    *_utc     -> chiave tecnica, senza ambiguita', usata per i calcoli e per
                 abbinare in futuro i dati realmente misurati
    *_italia  -> stessa identica istante, scritto in ora italiana, per la
                 lettura umana (tiene conto dell'ora legale)
  L'ora italiana NON va usata per i calcoli: il 25 ottobre le 02:00 esistono
  due volte e a marzo non esistono affatto.
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
import csv

ROMA = ZoneInfo("Europe/Rome")

# Intestazione unica per tutte le fonti. Le colonne non pertinenti restano vuote
# (es. delta_hpa sulle righe di vento): serve ad avere un'unica tabella
# omogenea, facile da leggere e da unire con i rilevamenti reali.
COLONNE = [
    "emesso_utc", "emesso_italia", "n_rel",
    "valida_utc", "valida_italia", "anticipo_h",
    "fonte", "localita", "spot",
    "raffica_kn", "vento_medio_kn", "direzione_gradi",
    "delta_hpa", "bolzano_hpa", "ghedi_hpa",
    "temperatura_c", "prob_pioggia_pct", "pioggia_mm", "codice_meteo",
]

KMH_PER_NODO = 1.852

# Fin dove archiviare le CONDIZIONI PREVISTE (temperatura, pioggia, cielo).
# Servono come "ingredienti" per correggere la previsione di vento, quindi ha
# senso conservarle sulla stessa finestra delle raffiche (48 ore). Archiviare
# tutti e 7 i giorni raddoppierebbe il peso senza aggiungere nulla di utile.
ORIZZONTE_CONDIZIONI_H = 48

# Da quando la timeline meteo e' salvata in UTC.
# Prima di questa data era in ora italiana mentre le raffiche erano gia' in UTC:
# archiviarle insieme creerebbe una serie sfalsata di 1-2 ore. Le condizioni
# precedenti vengono quindi ignorate; se un giorno serviranno, si recuperano
# dall'archivio "Previous Runs" di Open-Meteo, che le conserva nella forma
# corretta (valore previsto con un dato anticipo).
# SE LA CORREZIONE VENISSE PUBBLICATA PIU' TARDI, spostare avanti questa data.
DAL_QUALE_ORARI_UTC = datetime(2026, 7, 27, 0, 0, tzinfo=timezone.utc)


def kmh_to_kn(v):
    """Converte km/h in nodi con lo stesso arrotondamento usato dal sito."""
    if v is None:
        return None
    return round(v / KMH_PER_NODO, 1)


def parse_utc(s):
    """Legge un orario dei nostri JSON e restituisce un datetime in UTC.

    Accetta sia '2026-07-26T14:00' (senza marcatura => UTC per convenzione)
    sia '2026-07-26T14:00:00.000Z' sia '...+00:00'.
    """
    if not s:
        return None
    s = s.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    d = datetime.fromisoformat(s)
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc)


def fmt_utc(d):
    return d.strftime("%Y-%m-%d %H:%M") if d else ""


def fmt_italia(d):
    return d.astimezone(ROMA).strftime("%Y-%m-%d %H:%M") if d else ""


def mese_archivio(d):
    """Il file mensile e' scelto in base al mese ITALIANO di emissione."""
    return d.astimezone(ROMA).strftime("%Y-%m")


def righe_da_snapshot(dati, emesso, n_rel):
    """Trasforma uno snapshot JSON nelle righe dell'archivio.

    Riconosce da solo il tipo di file:
      - meteo_*.json          -> raffiche per spot (+ vento medio e ICON-2I se presenti)
      - wind_garda.json       -> differenza di pressione

    Le CONDIZIONI PREVISTE (temperatura, pioggia, cielo) vengono archiviate solo
    a partire da DAL_QUALE_ORARI_UTC: prima di quella data erano salvate in ora
    italiana mentre le raffiche erano in UTC, e mescolarle produrrebbe una serie
    sfalsata di 1-2 ore.
    """
    righe = []

    def aggiungi(valida, **campi):
        if valida is None:
            return
        # I file contengono anche ore GIA' PASSATE al momento del download
        # (la previsione parte sempre da mezzanotte). Non sono previsioni e il
        # grafico non le mostrava: escluderle evita di gonfiare l'archivio del
        # ~23% con righe che falserebbero le medie di affidabilita'.
        if valida < emesso:
            return
        r = {c: "" for c in COLONNE}
        r["emesso_utc"] = fmt_utc(emesso)
        r["emesso_italia"] = fmt_italia(emesso)
        r["n_rel"] = n_rel
        r["valida_utc"] = fmt_utc(valida)
        r["valida_italia"] = fmt_italia(valida)
        r["anticipo_h"] = round((valida - emesso).total_seconds() / 3600, 1)
        for k, v in campi.items():
            r[k] = "" if v is None else v
        righe.append(r)

    # ---- FILE METEO (raffiche per spot + eventuale ICON-2I) ----
    if "spots" in dati:
        loc = dati.get("localita", "")
        for s in dati.get("spots") or []:
            tempi = s.get("time") or []
            raff = s.get("raffiche") or []
            dire = s.get("direzione") or []
            medio = s.get("vento_medio") or []
            for i, t in enumerate(tempi):
                aggiungi(
                    parse_utc(t),
                    fonte="meteoswiss_ch1",
                    localita=loc,
                    spot=s.get("nome", ""),
                    raffica_kn=kmh_to_kn(raff[i] if i < len(raff) else None),
                    vento_medio_kn=kmh_to_kn(medio[i] if i < len(medio) else None),
                    direzione_gradi=dire[i] if i < len(dire) else None,
                )

        ic = dati.get("icon2i")
        if ic:
            tempi = ic.get("time") or []
            vento = ic.get("vento") or []
            raff = ic.get("raffiche") or []
            dire = ic.get("direzione") or []
            for i, t in enumerate(tempi):
                aggiungi(
                    parse_utc(t),
                    fonte="icon2i",
                    localita=loc,
                    spot="centro",
                    raffica_kn=kmh_to_kn(raff[i] if i < len(raff) else None),
                    vento_medio_kn=kmh_to_kn(vento[i] if i < len(vento) else None),
                    direzione_gradi=dire[i] if i < len(dire) else None,
                )

    # ---- CONDIZIONI PREVISTE (solo file con fuso dichiarato UTC) ----
    m = dati.get("meteo")
    if m and emesso >= DAL_QUALE_ORARI_UTC:
        loc = dati.get("localita", "")
        limite = emesso + timedelta(hours=ORIZZONTE_CONDIZIONI_H)
        tempi = m.get("time") or []
        temp = m.get("temp") or []
        prob = m.get("prob") or []
        mm = m.get("mm") or []
        cod = m.get("codici") or []
        for i, t in enumerate(tempi):
            valida = parse_utc(t)
            if valida is None or valida > limite:
                continue
            aggiungi(
                valida,
                fonte="condizioni",
                localita=loc,
                temperatura_c=temp[i] if i < len(temp) else None,
                prob_pioggia_pct=prob[i] if i < len(prob) else None,
                pioggia_mm=mm[i] if i < len(mm) else None,
                codice_meteo=cod[i] if i < len(cod) else None,
            )

    # ---- FILE PRESSIONE ----
    if "rows" in dati:
        for r in dati.get("rows") or []:
            aggiungi(
                parse_utc(r.get("time")),
                fonte="pressione",
                localita="garda",
                delta_hpa=r.get("delta_hpa"),
                bolzano_hpa=r.get("bolzano_hpa"),
                ghedi_hpa=r.get("ghedi_hpa"),
            )

    return righe


def scrivi_mensili(righe, out_dir: Path):
    """Distribuisce le righe nei file mensili, senza mai duplicare.

    Una release gia' presente (stesso emesso_utc + fonte + localita) viene
    saltata: lo script si puo' rieseguire quante volte si vuole.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    per_mese = {}
    for r in righe:
        emesso = datetime.strptime(r["emesso_utc"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
        per_mese.setdefault(mese_archivio(emesso), []).append(r)

    scritte = 0
    for mese, nuove in sorted(per_mese.items()):
        f = out_dir / f"previsioni_{mese}.csv"
        esistenti = []
        chiavi = set()
        if f.exists():
            with f.open(newline="", encoding="utf-8") as fh:
                for r in csv.DictReader(fh):
                    esistenti.append(r)
                    chiavi.add((r["emesso_utc"], r["fonte"], r["localita"]))
        da_aggiungere = [r for r in nuove
                         if (r["emesso_utc"], r["fonte"], r["localita"]) not in chiavi]
        if not da_aggiungere:
            continue
        tutte = esistenti + da_aggiungere
        tutte.sort(key=lambda r: (r["emesso_utc"], r["fonte"], r["localita"],
                                  r["spot"], r["valida_utc"]))
        with f.open("w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=COLONNE)
            w.writeheader()
            w.writerows(tutte)
        print(f"  {f.name}: +{len(da_aggiungere)} righe (totale {len(tutte)})")
        scritte += len(da_aggiungere)
    return scritte
