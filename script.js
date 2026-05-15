// ============================================================
// GRAFICO VENTO - Raffiche Area Torbole / Riva
// Dati: MeteoSwiss ICON-CH1 via Open-Meteo API
// Generato in tempo reale nel browser ad ogni caricamento
// ============================================================

const SPOTS = [
  { nome: "Spiaggia Lucertole", lat: 45.84928, lon: 10.86224, colore: "#ebc402" },
  { nome: "Hotel Pièr",         lat: 45.84487, lon: 10.82867, colore: "#0901fc" },
  { nome: "Terrazza Ponale",    lat: 45.87807, lon: 10.83904, colore: "#e65100" },
  { nome: "Conca d'Oro",        lat: 45.86212, lon: 10.87536, colore: "#15b101" },
];

const ORE_OFFSET = 0; // UTC+2 ora legale italiana

// Soglie vento
const SOGLIE = [
  { kn: 10, colore: "#bbbbbb", label: "10 kn" },
  { kn: 20, colore: "#999999", label: "20 kn" },
  { kn: 30, colore: "#666666", label: "30 kn" },
];

// Converti km/h in nodi (Open-Meteo ICON-CH1 restituisce km/h)
function kmhToKn(kmh) {
  return kmh !== null ? Math.round(kmh / 1.852 * 10) / 10 : null;
}

// Converti gradi in punto cardinale
function dirNome(gradi) {
  if (gradi === null) return "";
  const nomi = ["N","NE","E","SE","S","SW","W","NW","N"];
  return nomi[Math.round(gradi / 45) % 8];
}

// Formatta data in ora locale italiana
function toLocalTime(isoString) {
  return new Date(isoString + "Z"); // il browser converte automaticamente in ora locale
}

async function caricaDati() {
  const url = "https://api.open-meteo.com/v1/forecast";
  const risultati = [];

  for (const spot of SPOTS) {
    const params = new URLSearchParams({
      latitude:      spot.lat,
      longitude:     spot.lon,
      hourly:        "wind_gusts_10m,wind_direction_10m",
      forecast_days: 2,
      models:        "meteoswiss_icon_ch1",
    });

    const r = await fetch(`${url}?${params}`);
    const d = await r.json();

    risultati.push({
      nome:      spot.nome,
      colore:    spot.colore,
      raffiche:  d.hourly.wind_gusts_10m.map(kmhToKn),
      direzione: d.hourly.wind_direction_10m,
      ore:       d.hourly.time.map(toLocalTime),
    });
  }

  return risultati;
}

function disegnaGrafico(dati) {
  const ore    = dati[0].ore;
  const labels = ore.map(d => `${String(d.getHours()).padStart(2,"0")}`);

  // Trova inizio dati validi (salta i null iniziali)
  let start = 0;
  while (start < dati[0].raffiche.length && dati[0].raffiche[start] === null) start++;

  // Trova fine dati validi (taglia i null finali)
  let end = dati[0].raffiche.length;
  while (end > start && dati[0].raffiche[end - 1] === null) end--;

  const oreSlice    = ore.slice(start, end);
  const labelsSlice = labels.slice(start, end);

  // Dataset linee spots
  const datasets = dati.map((s, i) => ({
    label:       s.nome,
    data:        s.raffiche.slice(start, end),
    borderColor: s.colore,
    borderWidth: i === 3 ? 2.8 : 1.8,
    pointRadius: 0,
    tension:     0.3,
    fill:        false,
    spanGaps:    true,
  }));

  // Dataset linee soglia
  SOGLIE.forEach(soglia => {
    datasets.push({
      label:       soglia.label,
      data:        new Array(labelsSlice.length).fill(soglia.kn),
      borderColor: soglia.colore,
      borderWidth: 1,
      borderDash:  [4, 4],
      pointRadius: 0,
      fill:        false,
    });
  });

  // Linee verticali per i giorni
  const dayLines = [];
  let lastDay = null;
  oreSlice.forEach((d, i) => {
    const day = d.toDateString();
    if (day !== lastDay) {
      lastDay = day;
      dayLines.push(i);
    }
  });

  // Plugin personalizzato per linee giorni ed etichette soglie
  const pluginGiorni = {
    id: "giorni",
    afterDraw(chart) {
      const { ctx, scales: { x, y } } = chart;

      dayLines.forEach(i => {
        const xPos = x.getPixelForValue(i);
        ctx.save();
        ctx.strokeStyle = "#33333325";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(xPos, chart.chartArea.top);
        ctx.lineTo(xPos, chart.chartArea.bottom);
        ctx.stroke();

        const d = oreSlice[i];
        const gg = ["Dom","Lun","Mar","Mer","Gio","Ven","Sab"][d.getDay()];
        const data = `${gg} ${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
        ctx.fillStyle = "#555";
        ctx.font = "italic 11px DM Sans, sans-serif";
        ctx.fillText(data, xPos + 4, chart.chartArea.top + 14);
        ctx.restore();
      });

      SOGLIE.forEach(soglia => {
        const yPos = y.getPixelForValue(soglia.kn);
        dayLines.forEach(i => {
          const xPos = x.getPixelForValue(i);
          ctx.save();
          ctx.fillStyle = soglia.colore;
          ctx.font = "9px DM Sans, sans-serif";
          ctx.fillText(soglia.label, xPos + 2, yPos - 3);
          ctx.restore();
        });
      });
    }
  };

  // Crea grafico
  const canvas = document.getElementById("canvas-vento");
  new Chart(canvas, {
    type: "line",
    data: { labels: labelsSlice, datasets },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y} kn`,
          }
        }
      },
      scales: {
        x: {
          ticks: {
            maxRotation: 90,
            minRotation: 90,
            font: { size: 10 },
            color: "#444",
            maxTicksLimit: 50,
          },
          grid: { color: "#e0e0e0" },
        },
        y: {
          ticks: { color: "#444", font: { size: 11 } },
          grid: { color: "#e0e0e0" },
          title: { display: true, text: "Nodi (kn)", color: "#444" },
        }
      }
    },
    plugins: [pluginGiorni],
  });
}

// Avvia tutto
async function init() {
  const wrapper = document.getElementById("grafico-vento-wrap");
  wrapper.innerHTML = '<p style="text-align:center;color:#6d96b8;padding:2rem;">Caricamento dati...</p>';

  try {
    const dati = await caricaDati();
    wrapper.innerHTML = '<canvas id="canvas-vento" width="1200" height="400"></canvas>';
    disegnaGrafico(dati);
  } catch (e) {
    wrapper.innerHTML = '<p style="text-align:center;color:#e65100;padding:2rem;">Errore caricamento dati meteo</p>';
    console.error(e);
  }
}

document.addEventListener("DOMContentLoaded", init);
