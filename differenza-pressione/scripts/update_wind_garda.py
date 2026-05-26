#!/usr/bin/env python3
import json
import statistics
import urllib.request
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

STATIONS = {
    "bolzano": "16020",
    "ghedi": "16088",
}

# IMPORTANTE:
# Questo script viene eseguito dalla root della repository.
# Tutti i file di questa pagina restano dentro differenza-pressione/.
OUTFILE = Path("differenza-pressione/data/wind_garda.json")

DWD_BASE = "https://opendata.dwd.de/weather/local_forecasts/mos/MOSMIX_L/single_stations"


def download_kmz(station_id: str) -> bytes:
    url = f"{DWD_BASE}/{station_id}/kml/MOSMIX_L_LATEST_{station_id}.kmz"
    req = urllib.request.Request(url, headers={"User-Agent": "ventogarda-github-action/1.0"})
    with urllib.request.urlopen(req, timeout=60) as response:
        return response.read()


def kmz_to_kml_text(kmz_bytes: bytes) -> str:
    with zipfile.ZipFile(BytesIO(kmz_bytes)) as zf:
        kml_names = [name for name in zf.namelist() if name.endswith(".kml")]
        if not kml_names:
            raise RuntimeError("Nessun file KML trovato nel KMZ")
        return zf.read(kml_names[0]).decode("utf-8")


def find_child_text_any_ns(node, local_name: str):
    for child in node.iter():
        if child.tag.endswith("}" + local_name) or child.tag == local_name:
            return child.text
    return None


def parse_mosmix_parameter(kml_text: str, parameter: str = "PPPP"):
    root = ET.fromstring(kml_text)

    times = []
    for node in root.iter():
        if node.tag.endswith("}TimeStep") or node.tag == "TimeStep":
            if node.text:
                times.append(node.text.strip())

    values_text = None
    for node in root.iter():
        if not (node.tag.endswith("}Forecast") or node.tag == "Forecast"):
            continue

        element_name = None
        for key, value in node.attrib.items():
            if key.endswith("}elementName") or key == "elementName":
                element_name = value
                break

        if element_name == parameter:
            values_text = find_child_text_any_ns(node, "value")
            break

    if values_text is None:
        raise RuntimeError(f"Parametro {parameter} non trovato")

    values = []
    for raw in values_text.split():
        if raw == "-":
            values.append(None)
        else:
            values.append(float(raw))

    if len(times) != len(values):
        raise RuntimeError(f"Tempi e valori hanno lunghezze diverse: {len(times)} vs {len(values)}")

    numeric = [v for v in values if v is not None]
    if numeric and statistics.median(numeric) > 2000:
        values = [None if v is None else v / 100.0 for v in values]

    return dict(zip(times, values))


def get_station_pressure_hpa(station_id: str):
    kmz = download_kmz(station_id)
    kml = kmz_to_kml_text(kmz)
    return parse_mosmix_parameter(kml, "PPPP")


def main():
    bolzano = get_station_pressure_hpa(STATIONS["bolzano"])
    ghedi = get_station_pressure_hpa(STATIONS["ghedi"])

    rows = []
    for time in sorted(set(bolzano) & set(ghedi)):
        p_bolzano = bolzano[time]
        p_ghedi = ghedi[time]

        if p_bolzano is None or p_ghedi is None:
            continue

        delta = p_ghedi - p_bolzano
        rows.append({
            "time": time,
            "bolzano_hpa": round(p_bolzano, 2),
            "ghedi_hpa": round(p_ghedi, 2),
            "delta_hpa": round(delta, 2),
        })

    if not rows:
        raise RuntimeError("Nessuna riga comune tra Bolzano e Brescia/Ghedi")

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "DWD MOSMIX-L",
        "parameter": "PPPP",
        "stations": {
            "bolzano": "16020",
            "brescia_ghedi": "16088"
        },
        "formula": "delta_hpa = brescia_ghedi_hpa - bolzano_hpa",
        "rows": rows
    }

    OUTFILE.parent.mkdir(parents=True, exist_ok=True)
    OUTFILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Scritto {OUTFILE} con {len(rows)} righe")


if __name__ == "__main__":
    main()
