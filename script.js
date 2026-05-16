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

// Coordinate di riferimento per il meteo generale (Conca d'Oro)
const LAT_METEO = 45.86212;
const LON_METEO = 10.87536;

// Soglie vento
const SOGLIE = [
  { kn: 10, colore: "#bbbbbb", label: "10 kn" },
  { kn: 20, colore: "#999999", label: "20 kn" },
  { kn: 30, colore: "#666666", label: "30 kn" },
];

// ============================================================
// UTILITÀ
// ============================================================

function kmhToKn(kmh) {
  return kmh !== null ? Math.round(kmh / 1.852 * 10) / 10 : null;
}

function dirNome(gradi) {
  if (gradi === null) return "";
  const nomi = ["N","NE","E","SE","S","SW","W","NW","N"];
  return nomi[Math.round(gradi / 45) % 8];
}

function toLocalTime(isoString) {
  return new Date(isoString + "Z");
}

// ============================================================
// TIMELINE METEO
// WMO weather codes → colore sfondo e intensità nuvole
// ============================================================

function wmoToStile(code) {
  if (code === 0)                          return { bg: "#f5c842", tipo: "sereno",    nuvole: 0   };
  if (code === 1)                          return { bg: "#f0c035", tipo: "velato",    nuvole: 0.2 };
  if (code === 2)                          return { bg: "#ddb830", tipo: "parz",      nuvole: 0.5 };
  if (code === 3)                          return { bg: "#a0a098", tipo: "nuvoloso",  nuvole: 0   };
  if (code >= 51 && code <= 67)            return { bg: "#787870", tipo: "pioggia",   nuvole: 0   };
  if (code >= 71 && code <= 77)            return { bg: "#8090a0", tipo: "neve",      nuvole: 0   };
  if (code >= 80 && code <= 82)            return { bg: "#606058", tipo: "pioggia",   nuvole: 0   };
  if (code >= 95 && code <= 99)            return { bg: "#303028", tipo: "temporale", nuvole: 0   };
  return                                          { bg: "#a0a098", tipo: "nuvoloso",  nuvole: 0   };
}

async function caricaMeteo() {
  const params = new URLSearchParams({
    latitude:               LAT_METEO,
    longitude:              LON_METEO,
    hourly:                 "temperature_2m,precipitation_probability,weather_code",
    forecast_days:          2,
    models:                 "meteoswiss_icon_ch1",
  });
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  const d = await r.json();
  return {
    ore:         d.hourly.time.map(toLocalTime),
    temp:        d.hourly.temperature_2m,
    pioggia:     d.hourly.precipitation_probability,
    codici:      d.hourly.weather_code,
  };
}

function disegnaTimeline(meteo) {
  const wrapper = document.getElementById("timeline-meteo");
  if (!wrapper) return;

  const adesso = new Date();
  const H = meteo.ore.length;

  // Trova inizio (ora corrente) e fine (max 36 ore dopo)
  let start = 0;
  while (start < H && meteo.ore[start] < adesso) start++;
  const end = Math.min(start + 36, H);

  let html = '<div style="display:flex;gap:3px;width:max-content;padding:4px 0;">';

  for (let i = start; i < end; i++) {
    const ora     = meteo.ore[i];
    const temp    = meteo.temp[i] !== null ? Math.round(meteo.temp[i]) : "—";
    const pioggia = meteo.pioggia[i] !== null ? meteo.pioggia[i] : 0;
    const codice  = meteo.codici[i] ?? 3;
    const stile   = wmoToStile(codice);
    const hLabel  = String(ora.getHours()).padStart(2, "0");

    // Colore testo: scuro su sfondi chiari, chiaro su sfondi scuri
    const testoScuro = ["sereno","velato","parz"].includes(stile.tipo);
    const colTesto   = testoScuro ? "#5a3e00" : "#f0f0ee";
    const colPioggia = testoScuro ? "#5a3e00" : "#e0e8ff";

    // Fill nuvole (bianco semitrasparente, solo per sereno/velato/parz)
    const fillNuvole = stile.nuvole > 0
      ? `<div style="position:absolute;bottom:0;left:0;right:0;height:${Math.round(stile.nuvole * 100)}%;background:rgba(255,255,255,0.55);"></div>`
      : "";

    // Fill pioggia (blu dal basso)
    const fillPioggia = pioggia > 5
      ? `<div style="position:absolute;bottom:0;left:0;right:0;height:${pioggia}%;background:rgba(40,80,200,${0.35 + pioggia/200});"></div>`
      : "";

    // Fulmine per temporale
    const fulmine = stile.tipo === "temporale"
      ? `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">
           <svg width="16" height="24" viewBox="0 0 18 26" fill="none"><polygon points="10,0 3,14 9,14 8,26 15,12 9,12" fill="#ffe566" opacity="0.9"/></svg>
         </div>`
      : "";

    html += `
      <div style="display:flex;flex-direction:column;align-items:center;width:48px;">
        <div style="width:48px;height:75px;border-radius:6px;background:${stile.bg};position:relative;overflow:hidden;border:0.5px solid rgba(0,0,0,0.15);">
          ${fillNuvole}
          ${fillPioggia}
          ${fulmine}
          <span style="position:absolute;top:7px;left:0;right:0;text-align:center;font-size:13px;font-weight:500;color:${colTesto};z-index:1;">${temp}°</span>
          <span style="position:absolute;bottom:5px;left:0;right:0;text-align:center;font-size:10px;color:${colPioggia};z-index:1;">${pioggia}%</span>
        </div>
        <span style="font-size:11px;color:#6d96b8;margin-top:4px;">${hLabel}</span>
      </div>`;
  }

  html += "</div>";
  wrapper.innerHTML = html;
}

// ============================================================
// GRAFICO VENTO
// ============================================================

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
  const labels = ore.map(d => `${String(d.getHours()).padStart(2,"00")}`);

  let start = 0;
  while (start < dati[0].raffiche.length && dati[0].raffiche[start] === null) start++;

  let end = dati[0].raffiche.length;
  while (end > start && dati[0].raffiche[end - 1] === null) end--;

  const oreSlice    = ore.slice(start, end);
  const labelsSlice = labels.slice(start, end);

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

  const dayLines = [];
  let lastDay = null;
  oreSlice.forEach((d, i) => {
    const day = d.toDateString();
    if (day !== lastDay) { lastDay = day; dayLines.push(i); }
  });

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
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y} kn` } }
      },
      scales: {
        x: {
          ticks: { maxRotation: 90, minRotation: 90, font: { size: 10 }, color: "#444", maxTicksLimit: 50 },
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

// ============================================================
// AVVIO
// ============================================================

async function init() {
  // Timeline meteo
  const wrapTimeline = document.getElementById("timeline-meteo");
  if (wrapTimeline) wrapTimeline.innerHTML = '<p style="color:#6d96b8;font-size:13px;padding:1rem 0;">Caricamento...</p>';

  // Grafico vento
  const wrapVento = document.getElementById("grafico-vento-wrap");
  if (wrapVento) wrapVento.innerHTML = '<p style="text-align:center;color:#6d96b8;padding:2rem;">Caricamento dati...</p>';

  try {
    const [meteo, dati] = await Promise.all([caricaMeteo(), caricaDati()]);

    disegnaTimeline(meteo);

    wrapVento.innerHTML = '<canvas id="canvas-vento" width="1200" height="400"></canvas>';
    disegnaGrafico(dati);

  } catch (e) {
    if (wrapTimeline) wrapTimeline.innerHTML = "";
    if (wrapVento) wrapVento.innerHTML = '<p style="text-align:center;color:#e65100;padding:2rem;">Errore caricamento dati meteo</p>';
    console.error(e);
  }
}

document.addEventListener("DOMContentLoaded", init);
