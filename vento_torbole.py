import requests
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from datetime import datetime, timedelta

# Fuso orario: aggiungiamo 2 ore (ora legale italiana, UTC+2)
# A novembre cambia in UTC+1: basta modificare hours=2 in hours=1
ORE_OFFSET = 2

# Punti di interesse
SPOTS = [
    {"nome": "Spiaggia Lucertole", "lat": 45.84928, "lon": 10.86224, "colore": "#ebc402"},
    {"nome": "Hotel Pièr",         "lat": 45.84487, "lon": 10.82867, "colore": "#0901fc"},
    {"nome": "Terrazza Ponale",    "lat": 45.87807, "lon": 10.83904, "colore": "#e65100"},
    {"nome": "Conca d'Oro",        "lat": 45.86212, "lon": 10.87536, "colore": "#15b101"},
]

url = "https://api.open-meteo.com/v1/forecast"

# Scarica dati per tutti i punti
print("Scarico dati per tutti i punti...")
dati_spots = []
ore = None

for spot in SPOTS:
    params = {
        "latitude":  spot["lat"],
        "longitude": spot["lon"],
        "hourly": "wind_gusts_10m,wind_direction_10m",
        "windspeed_unit": "kn",
        "forecast_days": 2,
        "models": "meteoswiss_icon_ch1"
    }
    r = requests.get(url, params=params)
    d = r.json()
    
    if ore is None:
        ore = [datetime.fromisoformat(t) + timedelta(hours=ORE_OFFSET)
               for t in d["hourly"]["time"]]
    dati_spots.append({
        "nome":      spot["nome"],
        "colore":    spot["colore"],
        "raffiche":  d["hourly"]["wind_gusts_10m"],
        "direzione": d["hourly"]["wind_direction_10m"],
    })
    print(f"  ✓ {spot['nome']}")


# Converti direzione in nome
def dir_nome(gradi):
    if gradi is None:
        return ""
    nomi = ["N","NE","E","SE","S","SW","W","NW","N"]
    return nomi[round(gradi / 45) % 8]

# Crea figura con due pannelli sovrapposti
fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(36, 10), sharex=False,
                                gridspec_kw={"height_ratios": [3, 1]})
fig.patch.set_facecolor("white")

# --- Pannello 1: raffiche ---
ax1.set_facecolor("white")
for s in dati_spots:
    spessore = 2.8
    ax1.plot(ore, s["raffiche"], color=s["colore"], linewidth=spessore,
             label=s["nome"], alpha=0.85)

# Linee soglia vento
SOGLIE = [
    {"kn": 10, "colore": "#bbbbbb", "spessore": 1.0, "label": "10 kn"},
    {"kn": 20, "colore": "#999999", "spessore": 1.5, "label": "20 kn"},
    {"kn": 30, "colore": "#bbbbbb", "spessore": 1.0, "label": "30 kn"},
]
for soglia in SOGLIE:
    ax1.axhline(soglia["kn"], color=soglia["colore"], linewidth=soglia["spessore"],
                linestyle="--", alpha=0.6, zorder=1)

ax1.set_title("Raffiche vento (10m) · Area Torbole / Riva", fontsize=13, pad=10, color="#222")
ax1.set_ylabel("Nodi (kn)", color="#444")
ax1.tick_params(colors="#444")
ax1.legend(facecolor="white", edgecolor="#ccc", loc="upper left", bbox_to_anchor=(0, 1.08), ncol=4)
ax1.grid(True, alpha=0.3, color="#aaa")
for spine in ax1.spines.values():
    spine.set_edgecolor("#ccc")
ax1.xaxis.set_major_locator(mdates.HourLocator(interval=1))
ax1.xaxis.set_major_formatter(mdates.DateFormatter("%H"))
ax1.tick_params(axis="x", labelsize=14, labelcolor="#444", rotation=90)

# --- Pannello 2: direzione (Conca d'Oro come riferimento) ---
ref = dati_spots[3]  # Conca d'Oro è l'ultimo della lista
ax2.set_facecolor("#f7f9fc")
ax2.scatter(ore, ref["direzione"], color="#1565c0", s=12, zorder=3)
ax2.plot(ore, ref["direzione"], color="#1565c0", linewidth=1, alpha=0.4)
ax2.set_ylabel("Direzione\n(Conca d'Oro)", color="#444", fontsize=8)
ax2.set_ylim(0, 360)
ax2.set_yticks([0, 90, 180, 270, 360])
ax2.set_yticklabels(["N", "E", "S", "W", "N"], color="#444")
ax2.tick_params(colors="#444")
ax2.grid(True, alpha=0.3, color="#aaa")
for spine in ax2.spines.values():
    spine.set_edgecolor("#ccc")

# Etichette direzione ogni 3 ore
for o, d in zip(ore, ref["direzione"]):
    if d is not None and o.hour % 3 == 0:
        ax2.annotate(dir_nome(d), (o, d), textcoords="offset points",
                     xytext=(0, 6), ha="center", fontsize=9, color="#1565c0")

ax2.xaxis.set_major_locator(mdates.HourLocator(interval=1))
ax2.xaxis.set_major_formatter(mdates.DateFormatter("%H"))
ax2.tick_params(axis="x", labelsize=14, labelcolor="#444", rotation=90)

# Linee verticali e nomi giorni + etichette soglie
giorni_visti = set()
for o in ore:
    giorno = o.date()
    if giorno not in giorni_visti:
        giorni_visti.add(giorno)
        for ax in (ax1, ax2):
            ax.axvline(o, color="#33333325", linewidth=1.2)
        ax1.text(o, ax1.get_ylim()[1] * 0.93,
                 o.strftime("%a %d/%m"),
                 color="#555", fontsize=9, ha="left", fontstyle="italic")
        # Etichette soglie all inizio di ogni giorno
        for soglia in SOGLIE:
            ax1.text(o, soglia["kn"] + 0.4, soglia["label"],
                     fontsize=7, color=soglia["colore"], ha="left", va="bottom")

plt.tight_layout()
plt.savefig("vento_torbole.png", dpi=150, facecolor="white")
print("\nGrafico salvato come vento_torbole.png")
plt.show()