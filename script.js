// ============================================================
// METEO GARDA · TORBOLE
// Dati vento: MeteoSwiss ICON-CH1 via Open-Meteo
// Dati meteo: ICON Seamless via Open-Meteo
// ============================================================

const SPOTS = [
  { nome: "Spiaggia Lucertole", lat: 45.84928, lon: 10.86224, colore: "#ebc402" },
  { nome: "Hotel Pièr",         lat: 45.84487, lon: 10.82867, colore: "#0901fc" },
  { nome: "Hotel Trota",        lat: 45.86073, lon: 10.83341, colore: "#e65100" },
  { nome: "Conca d'Oro",        lat: 45.86212, lon: 10.87536, colore: "#15b101" },
];

const LAT_METEO = 45.86212;
const LON_METEO = 10.87536;

const SOGLIE = [
  { kn: 10, colore: "#bbbbbb", label: "10 kn" },
  { kn: 20, colore: "#999999", label: "20 kn" },
  { kn: 30, colore: "#666666", label: "30 kn" },
];

const GIORNI  = ["Dom","Lun","Mar","Mer","Gio","Ven","Sab"];
const SLOT_ORE = [[6,11],[12,17],[18,22]];
const SLOT_NOMI = ["Mat","Pom","Ser"];

let vistaModo  = "slot";
let meteoCache = null;
const adesso = new Date();

// ============================================================
// UTILITÀ
// ============================================================

function kmhToKn(kmh) {
  return kmh !== null ? Math.round(kmh / 1.852 * 10) / 10 : null;
}

function toLocalTime(isoString) {
  return new Date(isoString + "Z");
}

// ============================================================
// WMO → stile
// ============================================================

function wmoToStile(code) {
  if (code === 0)               return { bg: "#f5c842", tipo: "sereno",    scuro: false };
  if (code === 1)               return { bg: "#efc030", tipo: "velato",    scuro: false };
  if (code === 2)               return { bg: "#c8b060", tipo: "parz",      scuro: false };
  if (code === 3)               return { bg: "#909088", tipo: "nuvoloso",  scuro: true  };
  if (code >= 51 && code <= 67) return { bg: "#686860", tipo: "pioggia",   scuro: true  };
  if (code >= 71 && code <= 77) return { bg: "#7888a0", tipo: "neve",      scuro: true  };
  if (code >= 80 && code <= 82) return { bg: "#585850", tipo: "pioggia",   scuro: true  };
  if (code >= 95 && code <= 99) return { bg: "#282820", tipo: "temporale", scuro: true  };
  return                               { bg: "#909088", tipo: "nuvoloso",  scuro: true  };
}

// ============================================================
// RETTANGOLO METEO RIUTILIZZABILE
// fill = mm reali, numero = probabilità %
// ============================================================

function rettangolo(bg, scuro, temp, prob, mm, tipo, w, h, fs) {
  const colT = scuro ? "#f0f0ee" : "#5a3e00";
  const colP = scuro ? "#c8d8ff" : "#5a3e00";
  // Fill proporzionale ai mm (max visivo a 3mm = 70%)
  // Se mm=0 ma prob>30, mostra un fill minimo basato sulla prob
  const fillH = mm > 0 ? Math.min(Math.round(mm / 0.3 * 70), 70) : (prob > 30 ? Math.round(prob / 100 * 30) : 0);
  const fillPioggia = fillH > 0
    ? `<div style="position:absolute;bottom:0;left:0;right:0;height:${fillH}%;background:rgba(40,100,220,0.55);z-index:0;"></div>`
    : "";
  const fulmine = tipo === "temporale"
    ? `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:2;">
         <svg width="12" height="18" viewBox="0 0 18 26" fill="none"><polygon points="10,0 3,14 9,14 8,26 15,12 9,12" fill="#ffe566" opacity="0.95"/></svg>
       </div>`
    : "";
  const probStr = prob > 0 ? `${prob}%` : "";
  return `<div style="width:${w}px;height:${h}px;border-radius:5px;background:${bg};position:relative;overflow:hidden;border:0.5px solid rgba(0,0,0,0.12);">
    ${fillPioggia}${fulmine}
    <span style="position:absolute;top:4px;left:0;right:0;text-align:center;font-size:${fs}px;font-weight:500;color:${colT};z-index:3;">${temp}°</span>
    <span style="position:absolute;bottom:3px;left:0;right:0;text-align:center;font-size:${Math.max(fs-2,8)}px;color:${colP};z-index:3;">${probStr}</span>
  </div>`;
}

// ============================================================
// CARICA METEO — 7 giorni icon_seamless
// ============================================================

async function caricaMeteo() {
  const params = new URLSearchParams({
    latitude:      LAT_METEO,
    longitude:     LON_METEO,
    hourly:        "temperature_2m,precipitation_probability,precipitation,weather_code",
    forecast_days: 7,
    models:        "icon_seamless",
  });
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  const d = await r.json();
  return {
    ore:    d.hourly.time.map(toLocalTime),
    temp:   d.hourly.temperature_2m,
    prob:   d.hourly.precipitation_probability,
    mm:     d.hourly.precipitation,
    codici: d.hourly.weather_code,
  };
}

// ============================================================
// RIEPILOGO GIORNI (mini rettangoli nell'header)
// ============================================================

function disegnaRiepilogo(meteo) {
  const wrapper = document.getElementById("riepilogo-giorni");
  if (!wrapper) return;

  const giorni = {};
  meteo.ore.forEach((ora, i) => {
    const key = ora.toDateString();
    if (!giorni[key]) giorni[key] = { temp:[], prob:[], mm:[], codici:[], data: ora };
    const h = ora.getHours();
    if (h >= 8 && h <= 20) {
      giorni[key].codici.push(meteo.codici[i] ?? 3);
      if (meteo.temp[i] !== null) giorni[key].temp.push(meteo.temp[i]);
      if (meteo.prob[i] !== null) giorni[key].prob.push(meteo.prob[i]);
      if (meteo.mm[i]   !== null) giorni[key].mm.push(meteo.mm[i]);
    }
  });

  const chiavi = Object.keys(giorni).slice(0, 7);
  let html = '<div style="display:flex;gap:3px;align-items:flex-end;">';

  chiavi.forEach(key => {
    const g = giorni[key];
    const moda = [...g.codici].sort((a,b) =>
      g.codici.filter(v=>v===b).length - g.codici.filter(v=>v===a).length
    )[0] ?? 3;
    const stile   = wmoToStile(moda);
    const tempMax = g.temp.length ? Math.round(Math.max(...g.temp)) : "—";
    const probMax = g.prob.length ? Math.round(Math.max(...g.prob)) : 0;
    const mmTot   = g.mm.length   ? g.mm.reduce((a,b)=>a+b, 0)     : 0;
    const gg      = GIORNI[g.data.getDay()];
    html += `
      <div style="display:flex;flex-direction:column;align-items:center;width:28px;">
        ${rettangolo(stile.bg, stile.scuro, tempMax, probMax, mmTot, stile.tipo, 28, 40, 9)}
        <span style="font-size:8px;color:#6d96b8;margin-top:2px;">${gg}</span>
      </div>`;
  });

  html += "</div>";
  wrapper.innerHTML = html;
}

// ============================================================
// TIMELINE ORA PER ORA
// ============================================================

function disegnaTimelineOre(meteo) {
  const wrapper = document.getElementById("timeline-meteo");
  if (!wrapper) return;

  const adesso = new Date();
  let start = 0;
  while (start < meteo.ore.length && meteo.ore[start] < adesso) start++;

  let html = '<div style="display:flex;gap:0;width:max-content;padding:4px 0;align-items:flex-end;">';
  let lastDay = null;

  for (let i = start; i < meteo.ore.length; i++) {
    const ora    = meteo.ore[i];
    const temp   = meteo.temp[i]   !== null ? Math.round(meteo.temp[i]) : "—";
    const prob   = meteo.prob[i]   !== null ? meteo.prob[i] : 0;
    const mm     = meteo.mm[i]     !== null ? meteo.mm[i]   : 0;
    const codice = meteo.codici[i] ?? 3;
    const stile  = wmoToStile(codice);
    const hLabel = String(ora.getHours()).padStart(2, "0");
    const dayKey = ora.toDateString();

    if (dayKey !== lastDay) {
      lastDay = dayKey;
      const gg   = GIORNI[ora.getDay()];
      const data = `${gg} ${String(ora.getDate()).padStart(2,"0")}/${String(ora.getMonth()+1).padStart(2,"0")}`;
      html += `
        <div style="display:flex;flex-direction:column;align-items:center;margin:0 4px;">
          <div style="width:1px;height:52px;background:#4fc3f740;"></div>
          <span style="font-size:9px;color:#4fc3f7;margin-top:4px;white-space:nowrap;font-style:italic;">${data}</span>
        </div>`;
    }

    html += `
      <div style="display:flex;flex-direction:column;align-items:center;width:44px;margin:0 1px;">
        ${rettangolo(stile.bg, stile.scuro, temp, prob, mm, stile.tipo, 44, 52, 11)}
        <span style="font-size:9px;color:#6d96b8;margin-top:3px;">${hLabel}</span>
      </div>`;
  }

  html += "</div>";
  wrapper.innerHTML = html;
}

// ============================================================
// TIMELINE 3 SLOT AL GIORNO
// ============================================================

function disegnaTimelineSlot(meteo) {
  const wrapper = document.getElementById("timeline-meteo");
  if (!wrapper) return;

  const giorni = {};
  meteo.ore.forEach((ora, i) => {
    const dayKey = ora.toDateString();
    if (!giorni[dayKey]) giorni[dayKey] = { data: ora, slot: [null, null, null] };
    const h = ora.getHours();
    SLOT_ORE.forEach(([da, a], si) => {
      if (h >= da && h <= a && ora >= adesso) {
        if (!giorni[dayKey].slot[si]) giorni[dayKey].slot[si] = { temp:[], prob:[], mm:[], codici:[] };
        const s = giorni[dayKey].slot[si];
        if (meteo.temp[i]   !== null) s.temp.push(meteo.temp[i]);
        if (meteo.prob[i]   !== null) s.prob.push(meteo.prob[i]);
        if (meteo.mm[i]     !== null) s.mm.push(meteo.mm[i]);
        s.codici.push(meteo.codici[i] ?? 3);
      }
    });
  });

  // Filtra i giorni che hanno almeno un slot con dati
  const chiavi = Object.keys(giorni).filter(key => 
    giorni[key].slot.some(s => s && s.temp.length > 0)
  );

  let html = '<div style="display:flex;gap:3px;width:max-content;padding:4px 0;align-items:flex-start;">';

  chiavi.forEach(key => {
    const g    = giorni[key];
    const gg   = GIORNI[g.data.getDay()];
    const data = `${gg} ${String(g.data.getDate()).padStart(2,"0")}/${String(g.data.getMonth()+1).padStart(2,"0")}`;

    // Separatore tra giorni (non prima del primo)
    if (html !== '<div style="display:flex;gap:3px;width:max-content;padding:4px 0;align-items:flex-start;">') {
      html += `<div style="display:flex;align-items:stretch;margin:0 4px;">
        <div style="width:1px;background:#4fc3f730;align-self:stretch;margin-top:18px;"></div>
      </div>`;
    }
    html += `<div style="display:flex;flex-direction:column;align-items:center;gap:3px;">
      <span style="font-size:9px;color:#4fc3f7;font-style:italic;white-space:nowrap;">${data}</span>
      <div style="display:flex;gap:3px;">`;

    g.slot.forEach((s, si) => {
      if (!s || s.temp.length === 0) return;
      const moda = [...s.codici].sort((a,b) =>
        s.codici.filter(v=>v===b).length - s.codici.filter(v=>v===a).length
      )[0] ?? 3;
      const stile = wmoToStile(moda);
      const temp  = Math.round(s.temp.reduce((a,b)=>a+b)/s.temp.length);
      const prob  = Math.round(Math.max(...s.prob));
      const mm    = s.mm.reduce((a,b)=>a+b, 0);

      html += `<div style="display:flex;flex-direction:column;align-items:center;">
        ${rettangolo(stile.bg, stile.scuro, temp, prob, mm, stile.tipo, 50, 62, 12)}
        <span style="font-size:8px;color:#6d96b8;margin-top:2px;">${SLOT_NOMI[si]}</span>
      </div>`;
    });

    html += `</div></div>`;
  });

  html += "</div>";
  wrapper.innerHTML = html;
}

// ============================================================
// TOGGLE
// ============================================================

function disegnaTimeline(meteo) {
  if (vistaModo === "ore") disegnaTimelineOre(meteo);
  else disegnaTimelineSlot(meteo);
}

function aggiornaBottoni() {
  const btnOre  = document.getElementById("btn-ore");
  const btnSlot = document.getElementById("btn-slot");
  if (!btnOre || !btnSlot) return;
  if (vistaModo === "ore") {
    btnOre.style.color = "#0d1b2a"; btnOre.style.background = "#4fc3f7";
    btnSlot.style.color = "#4fc3f7"; btnSlot.style.background = "none";
  } else {
    btnSlot.style.color = "#0d1b2a"; btnSlot.style.background = "#4fc3f7";
    btnOre.style.color = "#4fc3f7"; btnOre.style.background = "none";
  }
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
  const labels = ore.map(d => `${String(d.getHours()).padStart(2,"0")}`);
  let start = 0;
  while (start < dati[0].raffiche.length && dati[0].raffiche[start] === null) start++;
  let end = dati[0].raffiche.length;
  while (end > start && dati[0].raffiche[end - 1] === null) end--;
  const oreSlice    = ore.slice(start, end);
  const labelsSlice = labels.slice(start, end);
  const datasets = dati.map((s, i) => ({
    label: s.nome, data: s.raffiche.slice(start, end),
    borderColor: s.colore, borderWidth: i === 3 ? 2.8 : 1.8,
    pointRadius: 0, tension: 0.3, fill: false, spanGaps: true,
  }));
  SOGLIE.forEach(soglia => {
    datasets.push({
      label: soglia.label, data: new Array(labelsSlice.length).fill(soglia.kn),
      borderColor: soglia.colore, borderWidth: 1, borderDash: [4,4],
      pointRadius: 0, fill: false,
    });
  });
  const dayLines = [];
  let lastDay2 = null;
  oreSlice.forEach((d, i) => {
    const day = d.toDateString();
    if (day !== lastDay2) { lastDay2 = day; dayLines.push(i); }
  });
  const pluginGiorni = {
    id: "giorni",
    afterDraw(chart) {
      const { ctx, scales: { x, y } } = chart;
      dayLines.forEach(i => {
        const xPos = x.getPixelForValue(i);
        ctx.save();
        ctx.strokeStyle = "#33333325"; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(xPos, chart.chartArea.top); ctx.lineTo(xPos, chart.chartArea.bottom); ctx.stroke();
        const d = oreSlice[i];
        const gg = GIORNI[d.getDay()];
        ctx.fillStyle = "#555"; ctx.font = "italic 11px DM Sans, sans-serif";
        ctx.fillText(`${gg} ${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`, xPos+4, chart.chartArea.top+14);
        ctx.restore();
      });
      SOGLIE.forEach(soglia => {
        const yPos = y.getPixelForValue(soglia.kn);
        dayLines.forEach(i => {
          const xPos = x.getPixelForValue(i);
          ctx.save(); ctx.fillStyle = soglia.colore; ctx.font = "9px DM Sans, sans-serif";
          ctx.fillText(soglia.label, xPos+2, yPos-3); ctx.restore();
        });
      });
    }
  };
  const canvas = document.getElementById("canvas-vento");
  const chartRef = new Chart(canvas, {
    type: "line", data: { labels: labelsSlice, datasets },
    options: {
      responsive: false, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y} kn` } } },
      scales: {
        x: { ticks: { maxRotation: 90, minRotation: 90, font: { size: 10 }, color: "#444", maxTicksLimit: 50 }, grid: { color: "#e0e0e0" } },
        y: { ticks: { color: "#444", font: { size: 11 } }, grid: { color: "#e0e0e0" }, title: { display: true, text: "Nodi (kn)", color: "#444" } }
      }
    },
    plugins: [pluginGiorni],
  });
  return chartRef;
}

// ============================================================
// PANNELLO DIREZIONE VENTO (frecce rotanti)
// ============================================================

function disegnaDirezione(dati, chartRef) {
  const canvas = document.getElementById("canvas-dir");
  if (!canvas) return;

  const ref = dati[3] || dati[0];
  let start = 0;
  while (start < ref.raffiche.length && ref.raffiche[start] === null) start++;
  let end = ref.raffiche.length;
  while (end > start && ref.raffiche[end - 1] === null) end--;

  const oreSlice = ref.ore.slice(start, end);
  const dirSlice = ref.direzione.slice(start, end);

  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  // Leggi offset e larghezza area grafico da Chart.js
  const chartArea = chartRef ? chartRef.chartArea : null;
  const areaLeft  = chartArea ? chartArea.left  : 0;
  const areaWidth = chartArea ? (chartArea.right - chartArea.left) : W;
  const colW = areaWidth / oreSlice.length;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, W, H);

  oreSlice.forEach((ora, i) => {
    const gradi = dirSlice[i];
    const cx = areaLeft + i * colW + colW / 2;
    const cy = H / 2 - 8;

    if (gradi !== null) {
      // Disegna freccia ruotata
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((gradi * Math.PI) / 180);

      // Punta freccia (blu)
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.lineTo(5, 4);
      ctx.lineTo(0, 1);
      ctx.lineTo(-5, 4);
      ctx.closePath();
      ctx.fillStyle = "#1565c0cc";
      ctx.fill();



      ctx.restore();
    }

    // Ora sotto
    ctx.fillStyle = "#6d96b8";
    ctx.font = "9px DM Sans, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String(ora.getHours()).padStart(2,"0"), cx, H - 4);
  });
}

// ============================================================
// AVVIO
// ============================================================

async function init() {
  const wrapTimeline = document.getElementById("timeline-meteo");
  if (wrapTimeline) wrapTimeline.innerHTML = '<p style="color:#6d96b8;font-size:13px;padding:0.5rem 0;">Caricamento...</p>';
  const wrapVento = document.getElementById("grafico-vento-wrap");
  if (wrapVento) wrapVento.innerHTML = '<p style="text-align:center;color:#6d96b8;padding:2rem;">Caricamento dati...</p>';

  try {
    const [meteo, dati] = await Promise.all([caricaMeteo(), caricaDati()]);
    meteoCache = meteo;
    disegnaTimeline(meteo);
    aggiornaBottoni();

    document.getElementById("btn-ore")?.addEventListener("click", () => {
      vistaModo = "ore"; aggiornaBottoni(); disegnaTimeline(meteoCache);
    });
    document.getElementById("btn-slot")?.addEventListener("click", () => {
      vistaModo = "slot"; aggiornaBottoni(); disegnaTimeline(meteoCache);
    });

    wrapVento.innerHTML = '<canvas id="canvas-vento" width="1200" height="340"></canvas><canvas id="canvas-dir" width="1200" height="80" style="display:block;border-top:1px solid #e0e0e0;"></canvas>';
    const chartRef = disegnaGrafico(dati);
    disegnaDirezione(dati, chartRef);
  } catch (e) {
    if (wrapTimeline) wrapTimeline.innerHTML = "";
    if (wrapVento) wrapVento.innerHTML = '<p style="text-align:center;color:#e65100;padding:2rem;">Errore caricamento dati meteo</p>';
    console.error(e);
  }
}

// ============================================================
// MAPPA SPOTS
// ============================================================

let mappaIstanza = null;

function toggleMappa() {
  const wrap = document.getElementById("mappa-wrap");
  const btn  = document.getElementById("btn-mappa");
  if (!wrap) return;

  if (wrap.style.display === "none") {
    wrap.style.display = "block";
    btn.style.background = "#4fc3f7";
    btn.style.color = "#0d1b2a";

    // Inizializza mappa solo la prima volta
    if (!mappaIstanza) {
      mappaIstanza = L.map("mappa-leaflet", { zoomControl: false, attributionControl: false })
        .setView([45.858, 10.855], 13);

      const tileLayer = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
      }).addTo(mappaIstanza);
      // Filtro CSS per tonalità azzurra intonata col sito
      document.getElementById("mappa-leaflet").style.filter = "hue-rotate(180deg) saturate(0.6) brightness(1.1)";

      // Pin per ogni spot
      const colori = {
        "Spiaggia Lucertole": "#ebc402",
        "Hotel Pièr":         "#0901fc",
        "Hotel Trota":        "#e65100",
        "Conca d'Oro":        "#15b101",
      };

      SPOTS.forEach(spot => {
        const col = colori[spot.nome] || "#4fc3f7";
        const icona = L.divIcon({
          html: `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
            <div style="width:14px;height:14px;border-radius:50%;background:${col};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.5);"></div>
            <span style="font-size:9px;font-family:'DM Sans',sans-serif;font-weight:500;color:#0d1b2a;white-space:nowrap;background:rgba(255,255,255,0.85);padding:1px 3px;border-radius:3px;line-height:1.2;">${spot.nome}</span>
          </div>`,
          className: "",
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });
        L.marker([spot.lat, spot.lon], { icon: icona }).addTo(mappaIstanza);
      });

      // Fix dimensioni dopo apertura
      setTimeout(() => mappaIstanza.invalidateSize(), 100);
    } else {
      setTimeout(() => mappaIstanza.invalidateSize(), 100);
    }
  } else {
    wrap.style.display = "none";
    btn.style.background = "none";
    btn.style.color = "#4fc3f7";
  }
}

document.addEventListener("DOMContentLoaded", init);
