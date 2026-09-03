// ============================================================
// METEO GARDA · TORBOLE
// Dati vento: MeteoSwiss ICON-CH1 via Open-Meteo
// Dati meteo: ICON Seamless via Open-Meteo
// ============================================================
//
// *** COPIA DI PROVA — NON E' IL FILE DEL SITO ***
//
// Copia di scripts/script_cachefirst.js del 25 agosto 2026, con in piu' le
// FASCE DI MALTEMPO sul grafico raffiche: quando il modello prevede pioggia o
// temporale, dietro le linee compare una fascia verticale con il simbolo, per
// dire «si', fa vento, ma e' vento di temporale».
//
// Usata solo da test-maltempo.html e malcesine/test-maltempo.html.
// Le pagine ufficiali continuano a caricare script_cachefirst.js.
// Se la prova convince, le modifiche vanno riportate li' dentro; cercare
// "MALTEMPO" per trovarle tutte (sono quattro punti).
// ============================================================

// Dati dalla configurazione localita.js
// LOC_ID è definito nell index.html di ogni località
const _loc   = LOCALITA[typeof LOC_ID !== "undefined" ? LOC_ID : "torbole"];
const SPOTS      = _loc.spots;
const LAT_METEO  = _loc.lat;
const LON_METEO  = _loc.lon;

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
// Info sulla freschezza delle RAFFICHE (il dato critico per chi va in acqua):
// fonte 'cache' = file già pronto entro la soglia; 'ritardo' = stesso file ma
// oltre la soglia, mostrato lo stesso e dichiarato all'utente.
let raffInfo = { fonte: null, orario: null };
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

// Testo dell'etichetta di freschezza per il grafico raffiche.
// Fonte 'cache'   (regime normale): mostriamo l'ora del generated_at del JSON.
// Fonte 'ritardo' (file oltre la soglia): stessi dati, ma lo diciamo apertamente.
function testoFreschezzaRaffiche(info) {
  const d = info.orario ? new Date(info.orario) : null;
  const oraValida = d && !isNaN(d.getTime());
  if (info.fonte === 'ritardo') {
    const hhmmRit = oraValida
      ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
      : null;
    return hhmmRit
      ? `Previsioni delle ${hhmmRit} · aggiornamento in ritardo`
      : 'Aggiornamento in ritardo';
  }
  if (!oraValida) return "aggiornata a ultima release disponibile";

  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const oreFa = (Date.now() - d.getTime()) / 3600000;

  // Oltre 4h = probabile che il cron abbia saltato piu' di un run ICON-CH1
  // (che escono ogni 3h): dicitura onesta senza fissare un orario ingannevole.
  if (oreFa > 4) {
    return "aggiornata a ultima release disponibile";
  }
  return `Dati MeteoSwiss · aggiornati alle ${hhmm}`;
}

// ============================================================
// WMO → stile
// ============================================================

function wmoToStile(code, mm, prob) {
  if (code === 0)               return { bg: "#f5c842", tipo: "sereno",    scuro: false, nuvola: 0 };
  if (code === 1)               return { bg: "#f5c842", tipo: "velato",    scuro: false, nuvola: 1 };
  if (code === 2)               return { bg: "#f5c842", tipo: "parz",      scuro: false, nuvola: 2 };
  if (code === 3)               return { bg: "#909088", tipo: "nuvoloso",  scuro: true,  nuvola: 0 };
  if (code >= 51 && code <= 67) return { bg: "#686860", tipo: "pioggia",   scuro: true,  nuvola: 0 };
  if (code >= 71 && code <= 77) return { bg: "#7888a0", tipo: "neve",      scuro: true,  nuvola: 0 };
  if (code >= 80 && code <= 82) return { bg: "#585850", tipo: "pioggia",   scuro: true,  nuvola: 0 };
  if (code >= 95 && code <= 99) {
    // Filtro "temporale-fantasma": il modello grezzo a volte segnala temporale (95-99)
    // senza alcuna precipitazione né probabilità reale. In quel caso declassiamo a
    // nuvoloso (niente fulmine). La pioggia/probabilità eventuali restano disegnate a parte.
    const pioggia = Number.isFinite(mm) ? mm : 0;
    const probab  = Number.isFinite(prob) ? prob : 0;
    if (pioggia < 0.2 && probab < 30) {
      return { bg: "#909088", tipo: "nuvoloso", scuro: true, nuvola: 0 };
    }
    return { bg: "#6b6880", tipo: "temporale", scuro: true,  nuvola: 0 };
  }
  return                               { bg: "#909088", tipo: "nuvoloso",  scuro: true,  nuvola: 0 };
}

// Nuvola: barra grigio chiaro che entra da destra, proporzionale alla nuvolosità
// size 0=nessuna, 1=velato (~35%), 2=parziale (~60%)
function svgNuvola(size, w, h) {
  if (size === 0) return "";
  const col = "#b8bfc8";
  const larghezza = size === 1 ? Math.round(w * 0.38) : Math.round(w * 0.65);
  return `<div style="position:absolute;top:0;right:0;width:${larghezza}px;height:100%;background:${col};z-index:1;"></div>`;
}

// ============================================================
// MALTEMPO (1/4) — colori e simboli delle fasce sul grafico raffiche
// ============================================================
//
// Il grafico delle raffiche da solo non distingue il vento buono dal vento di
// un temporale: una linea a 30 nodi e' identica nei due casi. Queste fasce
// mettono l'avvertimento dentro il grafico, dove si guarda, invece di
// obbligare a incrociarlo con la striscia meteo piu' sopra.
//
// Tinte scelte in continuita' con i rettangoli della striscia meteo, ma molto
// piu' trasparenti: la fascia deve stare DIETRO le linee del vento, non
// competerci. Il temporale e' piu' carico della pioggia — e' l'unico caso in
// cui si sta dicendo «non uscire», e deve saltare all'occhio da fermo.

const MALTEMPO_STILE = {
  pioggia:   { fascia: "rgba(93,124,163,0.13)",  simbolo: "#3d6fd4", bordo: "rgba(24,60,120,0.55)" },
  temporale: { fascia: "rgba(107,104,128,0.26)", simbolo: "#f0b400", bordo: "rgba(90,66,0,0.75)"   },
};

// Goccia. Disegnata a mano invece che con un carattere emoji: le emoji
// cambiano forma e dimensione da un dispositivo all'altro, e su un canvas
// scalato diventano imprevedibili.
function disegnaGoccia(ctx, cx, cy, s, colore, bordo) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy - s);
  ctx.bezierCurveTo(cx + s * 0.95, cy + s * 0.20, cx + s * 0.60, cy + s, cx, cy + s);
  ctx.bezierCurveTo(cx - s * 0.60, cy + s, cx - s * 0.95, cy + s * 0.20, cx, cy - s);
  ctx.closePath();
  ctx.fillStyle = colore;
  ctx.fill();
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = bordo;
  ctx.stroke();
  ctx.restore();
}

// Fulmine: stessa sagoma del fulmine gia' usato nei rettangoli meteo
// (funzione rettangolo, viewBox 18x26), cosi' l'utente riconosce lo stesso
// segno nei due punti della pagina. Qui pero' con il bordo scuro: il giallo
// dei rettangoli sta su fondo viola, sul grafico bianco sparirebbe.
function disegnaFulmine(ctx, cx, cy, h, colore, bordo) {
  const punti = [[10,0],[3,14],[9,14],[8,26],[15,12],[9,12]];
  const k = h / 26;
  ctx.save();
  ctx.beginPath();
  punti.forEach(([px, py], i) => {
    const X = cx + (px - 9) * k;
    const Y = cy + (py - 13) * k;
    if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
  });
  ctx.closePath();
  ctx.fillStyle = colore;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = bordo;
  ctx.stroke();
  ctx.restore();
}

// ============================================================
// RETTANGOLO METEO RIUTILIZZABILE
// fill = mm reali, numero = probabilità %
// ============================================================

function rettangolo(bg, scuro, temp, prob, mm, tipo, w, h, fs, nuvola) {
  // Testo sempre scuro — leggibile su tutti gli sfondi
  const colT = "#1a1a1a";
  const colP = "#1a1a1a";
  const fillH = mm > 0 ? Math.min(Math.round(mm / 2 * 50), 50) : 0;
  const fillPioggia = prob > 0
    ? `<div style="position:absolute;bottom:0;left:0;right:0;height:${Math.max(fillH, 4)}px;background:#3d6fd4;z-index:1;"></div>`
    : "";
  const cloud = svgNuvola(nuvola || 0, w, h);
  const fulmine = tipo === "temporale"
    ? `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:5;">
         <svg width="14" height="20" viewBox="0 0 18 26" fill="none"><polygon points="10,0 3,14 9,14 8,26 15,12 9,12" fill="#ffe566"/></svg>
       </div>`
    : "";
  const probStr = prob > 0 ? `${prob}%` : "";
  return `<div style="width:${w}px;height:${h}px;border-radius:5px;background:${bg};position:relative;overflow:hidden;border:0.5px solid rgba(0,0,0,0.12);">
    ${cloud}
    ${fillPioggia}
    ${fulmine}
    <span style="position:absolute;top:4px;left:0;right:0;text-align:center;font-size:${fs}px;font-weight:500;color:${colT};z-index:10;">${temp}°</span>
    <span style="position:absolute;bottom:3px;left:0;right:0;text-align:center;font-size:${Math.max(fs-2,8)}px;font-weight:500;color:${colP};z-index:10;">${probStr}</span>
  </div>`;
}

// ============================================================
// CARICA DATI — solo dal JSON già pronto del nostro sito
// Il browser non chiama mai Open-Meteo: che i visitatori siano 10 o 10.000,
// le chiamate a Open-Meteo restano quelle della sveglia automatica.
// Se il file manca, la pagina lo dice; se è vecchio, mostra comunque i dati
// dichiarando il ritardo (vedi caricaMeteo / caricaDati).
// ============================================================

async function caricaCache() {
  // Le pagine di prova possono puntare a una cartella dati diversa definendo
  // CARTELLA_DATI prima di caricare questo script (es. "/data/test").
  // Le pagine ufficiali non la definiscono e leggono i file di produzione.
  const base = (typeof CARTELLA_DATI !== "undefined") ? CARTELLA_DATI : "/data";
  const r = await fetch(`${base}/meteo_${LOC_ID}.json?_=${Date.now()}`);
  if (!r.ok) throw new Error("Cache non disponibile");
  return r.json();
}

// ---- SOGLIA DI RITARDO ----
// Oltre questa eta' il file e' considerato in ritardo: i dati si mostrano
// lo stesso (meglio previsioni di stamattina che una pagina vuota) ma
// l'etichetta sotto il grafico lo dichiara, e l'evento viene registrato.
const CACHE_MAX_ETA_ORE = 6;

let _cachePromise = null;
function caricaCacheUnaVolta() {
  // meteo e raffiche leggono lo stesso file: una sola richiesta per pagina
  if (!_cachePromise) _cachePromise = caricaCache();
  return _cachePromise;
}

function etaCacheOre(cache) {
  const d = cache && cache.generated_at ? new Date(cache.generated_at) : null;
  if (!d || isNaN(d.getTime())) return Infinity;
  return (Date.now() - d.getTime()) / 3600000;
}

// ---- PREFERENZE DI VISUALIZZAZIONE ----
// Restano sul dispositivo di chi visita (memoria locale del browser), non sul
// nostro server, e non identificano nessuno: sono scelte di lettura fatte
// dall'utente stesso. Se il browser le blocca (navigazione in incognito), si
// riparte semplicemente dai valori di partenza, senza errori.
const PREF_SERIE = 'vg_serie_vento';     // 'raffiche' | 'medio'
const PREF_LOCALITA = 'vg_localita';     // 'torbole'  | 'malcesine'
const PREF_NOVITA = 'vg_novita_vista';   // ultima novita' gia' letta

// Avviso novita': cambiare questa sigla fa ricomparire la striscia UNA volta
// a tutti. Il testo sta nelle pagine (id="novita-testo"), qui c'e' solo la
// versione, cosi' si annuncia una cosa nuova senza toccare il codice.
const VERSIONE_NOVITA = 'v2.4';

function leggiPreferenza(chiave) {
  try { return localStorage.getItem(chiave); } catch (e) { return null; }
}

function salvaPreferenza(chiave, valore) {
  try { localStorage.setItem(chiave, valore); } catch (e) { /* ignora */ }
}

// Segnala che il file già pronto è in ritardo o irraggiungibile.
// Il nome dell'evento GA4 resta 'cache_fallback' anche se il ripiego su
// Open-Meteo non esiste più: cambiarlo spezzerebbe lo storico in Analytics.
// Il significato ora è «l'utente non ha visto dati freschi», che è la cosa
// che vogliamo continuare a misurare.
function registraProblemaCache(dove, motivo) {
  console.warn(`[cache_fallback] ${dove}: ${motivo}`);
  try {
    if (typeof gtag === 'function') {
      gtag('event', 'cache_fallback', {
        sezione: dove,
        motivo: String(motivo).slice(0, 100),
        localita: typeof LOC_ID !== 'undefined' ? LOC_ID : 'torbole',
      });
    }
  } catch (e) { /* il log non deve mai rompere la pagina */ }
}

async function caricaMeteo() {
  // Solo file già pronto. Se è oltre soglia lo diciamo (evento + console) ma
  // i dati si mostrano lo stesso. Se il file non si scarica proprio, l'errore
  // sale al chiamante, che mostra il messaggio di indisponibilità.
  const cache = await caricaCacheUnaVolta();
  const eta = etaCacheOre(cache);
  if (eta > CACHE_MAX_ETA_ORE) {
    registraProblemaCache('meteo', `file vecchio di ${eta.toFixed(1)}h`);
  }
  const m = cache.meteo;
  return { ore: m.time.map(toLocalTime), temp: m.temp, prob: m.prob, mm: m.mm, codici: m.codici };
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
    const tempMax = g.temp.length ? Math.round(Math.max(...g.temp)) : "—";
    const probMax = g.prob.length ? Math.round(Math.max(...g.prob)) : 0;
    const mmTot   = g.mm.length   ? g.mm.reduce((a,b)=>a+b, 0)     : 0;
    const stile   = wmoToStile(moda, mmTot, probMax);
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

  // Raggruppa per giorno mantenendo ordine
  const gruppi = {};
  for (let i = start; i < meteo.ore.length; i++) {
    const dayKey = meteo.ore[i].toDateString();
    if (!gruppi[dayKey]) gruppi[dayKey] = { data: meteo.ore[i], ore: [] };
    gruppi[dayKey].ore.push(i);
  }

  let html = '<div style="display:flex;gap:3px;width:max-content;padding:4px 0;align-items:flex-start;">';
  let primo = true;

  Object.keys(gruppi).forEach(key => {
    const g    = gruppi[key];
    const gg   = GIORNI[g.data.getDay()];
    const data = `${gg} ${String(g.data.getDate()).padStart(2,"0")}/${String(g.data.getMonth()+1).padStart(2,"0")}`;

    // Separatore tra giorni
    if (!primo) {
      html += `<div style="display:flex;align-items:stretch;margin:0 4px;">
        <div style="width:1px;background:#4fc3f730;align-self:stretch;margin-top:18px;"></div>
      </div>`;
    }
    primo = false;

    html += `<div style="display:flex;flex-direction:column;align-items:center;gap:3px;">
      <span style="font-size:9px;color:#1a1a1a;font-style:italic;white-space:nowrap;">${data}</span>
      <div style="display:flex;gap:1px;">`;

    g.ore.forEach(i => {
      const ora    = meteo.ore[i];
      const temp   = meteo.temp[i]   !== null ? Math.round(meteo.temp[i]) : "—";
      const prob   = meteo.prob[i]   !== null ? meteo.prob[i] : 0;
      const mm     = meteo.mm[i]     !== null ? meteo.mm[i]   : 0;
      const codice = meteo.codici[i] ?? 3;
      const stile  = wmoToStile(codice, mm, prob);
      const hLabel = String(ora.getHours()).padStart(2, "0");

      html += `<div style="display:flex;flex-direction:column;align-items:center;width:44px;">
        ${rettangolo(stile.bg, stile.scuro, temp, prob, mm, stile.tipo, 44, 62, 12, stile.nuvola)}
        <span style="font-size:9px;color:#6d96b8;margin-top:2px;">${hLabel}</span>
      </div>`;
    });

    html += `</div></div>`;
  });

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
      <span style="font-size:9px;color:#1a1a1a;font-style:italic;white-space:nowrap;">${data}</span>
      <div style="display:flex;gap:3px;">`;

    g.slot.forEach((s, si) => {
      if (!s || s.temp.length === 0) return;
      const moda = [...s.codici].sort((a,b) =>
        s.codici.filter(v=>v===b).length - s.codici.filter(v=>v===a).length
      )[0] ?? 3;
      const temp  = Math.round(s.temp.reduce((a,b)=>a+b)/s.temp.length);
      const prob  = Math.round(Math.max(...s.prob));
      const mm    = s.mm.reduce((a,b)=>a+b, 0);
      const stile = wmoToStile(moda, mm, prob);

      html += `<div style="display:flex;flex-direction:column;align-items:center;">
        ${rettangolo(stile.bg, stile.scuro, temp, prob, mm, stile.tipo, 44, 62, 12, stile.nuvola)}
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
    btnOre.classList.add("attivo");
    btnSlot.classList.remove("attivo");
  } else {
    btnSlot.classList.add("attivo");
    btnOre.classList.remove("attivo");
  }
}

// ============================================================
// GRAFICO VENTO
// ============================================================

async function caricaDati() {
  // Solo file già pronto (orario mostrato = generated_at del file).
  // Oltre soglia i dati si mostrano lo stesso, con l'etichetta che dichiara
  // il ritardo. Se il file non si scarica, l'errore sale al chiamante.
  const cache = await caricaCacheUnaVolta();
  const eta = etaCacheOre(cache);
  const inRitardo = eta > CACHE_MAX_ETA_ORE;
  if (inRitardo) {
    registraProblemaCache('raffiche', `file vecchio di ${eta.toFixed(1)}h`);
  }
  raffInfo = {
    fonte: inRitardo ? 'ritardo' : 'cache',
    orario: cache.generated_at || null,
  };
  return cache.spots.map(s => ({
    nome: s.nome, colore: s.colore,
    raffiche: s.raffiche.map(kmhToKn),
    // Presente solo nei file generati dopo l'aggiunta del vento medio:
    // se manca, il grafico non mostra i pulsanti e resta come prima.
    ventoMedio: Array.isArray(s.vento_medio) ? s.vento_medio.map(kmhToKn) : null,
    direzione: s.direzione,
    ore: s.time.map(toLocalTime),
  }));
}

function disegnaGrafico(dati, meteo) {
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
    serie: 'raffiche',              // usato dai pulsanti per riconoscere la serie
    coloreBase: s.colore, spessoreBase: i === 3 ? 2.8 : 1.8,
  }));

  // Vento medio: stessi colori degli spot ma TRATTEGGIATO, cosi' si distingue
  // a colpo d'occhio. Sempre disegnato, ma attenuato finche' non e' in primo
  // piano. Presente solo se il file dei dati lo contiene.
  const haVentoMedio = dati.every(s => Array.isArray(s.ventoMedio));
  if (haVentoMedio) {
    dati.forEach((s, i) => {
      datasets.push({
        label: `${s.nome} (medio)`, data: s.ventoMedio.slice(start, end),
        borderColor: s.colore, borderWidth: i === 3 ? 2.4 : 1.6,
        borderDash: [5, 4],
        pointRadius: 0, tension: 0.3, fill: false, spanGaps: true,
        serie: 'medio',
        coloreBase: s.colore, spessoreBase: i === 3 ? 2.4 : 1.6,
      });
    });
  }
  SOGLIE.forEach(soglia => {
    datasets.push({
      label: soglia.label, data: new Array(labelsSlice.length).fill(soglia.kn),
      borderColor: soglia.colore, borderWidth: 1, borderDash: [4,4],
      pointRadius: 0, fill: false,
    });
  });
  // ============================================================
  // MALTEMPO (2/4) — quali ore del grafico sono pioggia o temporale
  // ============================================================
  //
  // Meteo e raffiche escono dallo STESSO file (data/meteo_<localita>.json) e
  // sono gia' sulla stessa griglia oraria, tutta in orario di Greenwich. Ma
  // non hanno la stessa lunghezza: il meteo arriva a 7 giorni, le raffiche a 2.
  //
  // Per questo si appaiano per ORARIO e mai per posizione. Accoppiare per
  // indice funzionerebbe oggi e si romperebbe in silenzio il giorno in cui una
  // delle due serie cambiasse punto di partenza: le fasce finirebbero sull'ora
  // sbagliata senza che niente segnali il guasto — ed e' proprio l'errore che
  // rende il grafico peggio che inutile, perche' rassicura quando non deve.
  //
  // La classificazione non e' rifatta qui: si riusa wmoToStile(), la stessa
  // che colora i rettangoli piu' in alto. Cosi' i due punti della pagina non
  // possono contraddirsi, e il filtro "temporale-fantasma" (modello che
  // segnala temporale senza una goccia di pioggia) vale anche per le fasce.
  const indicePerOrario = new Map();
  if (meteo && Array.isArray(meteo.ore)) {
    meteo.ore.forEach((d, j) => indicePerOrario.set(d.getTime(), j));
  }
  const maltempo = oreSlice.map(ora => {
    const j = indicePerOrario.get(ora.getTime());
    if (j === undefined) return null;          // ora senza meteo: nessuna fascia
    const stile = wmoToStile(meteo.codici[j], meteo.mm[j], meteo.prob[j]);
    return (stile.tipo === "pioggia" || stile.tipo === "temporale") ? stile.tipo : null;
  });

  // Blocchi continui dello stesso tipo. Il simbolo si disegna una volta sola,
  // al centro del blocco: se piove dalle 14 alle 19 serve un simbolo, non sei.
  // Su un telefono le ore sono larghe pochi pixel e ripeterlo darebbe una fila
  // di puntini illeggibile.
  const blocchiMaltempo = [];
  let bloccoCorr = null;
  maltempo.forEach((tipo, i) => {
    if (bloccoCorr && tipo === bloccoCorr.tipo && i === bloccoCorr.fine + 1) {
      bloccoCorr.fine = i;
      return;
    }
    if (bloccoCorr) { blocchiMaltempo.push(bloccoCorr); bloccoCorr = null; }
    if (tipo) bloccoCorr = { tipo, inizio: i, fine: i };
  });
  if (bloccoCorr) blocchiMaltempo.push(bloccoCorr);

  // ============================================================
  // MALTEMPO (3/4) — il disegno
  // ============================================================
  //
  // Due momenti diversi, ed e' la parte che conta:
  //  · beforeDatasetsDraw  → le fasce, DIETRO le linee del vento
  //  · afterDraw           → i simboli, DAVANTI a tutto
  // Se le fasce si disegnassero dopo, coprirebbero le linee: il grafico del
  // vento resta la cosa principale, l'avvertimento e' lo sfondo.
  const pluginMaltempo = {
    id: "maltempo",
    beforeDatasetsDraw(chart) {
      if (!blocchiMaltempo.length) return;
      const { ctx, chartArea, scales: { x } } = chart;
      // Mezzo passo per lato: la fascia copre l'ORA, non il puntino dell'ora.
      const passo = maltempo.length > 1
        ? Math.abs(x.getPixelForValue(1) - x.getPixelForValue(0))
        : 10;
      blocchiMaltempo.forEach(b => {
        const sx = Math.max(x.getPixelForValue(b.inizio) - passo / 2, chartArea.left);
        const dx = Math.min(x.getPixelForValue(b.fine)   + passo / 2, chartArea.right);
        if (dx <= sx) return;
        ctx.save();
        ctx.fillStyle = MALTEMPO_STILE[b.tipo].fascia;
        ctx.fillRect(sx, chartArea.top, dx - sx, chartArea.bottom - chartArea.top);
        ctx.restore();
      });
    },
    afterDraw(chart) {
      if (!blocchiMaltempo.length) return;
      const { ctx, chartArea, scales: { x } } = chart;
      // Sotto le etichette dei giorni (disegnate a top+14), per non accavallarsi.
      const y = chartArea.top + 32;
      blocchiMaltempo.forEach(b => {
        const cx = (x.getPixelForValue(b.inizio) + x.getPixelForValue(b.fine)) / 2;
        if (cx < chartArea.left || cx > chartArea.right) return;
        const s = MALTEMPO_STILE[b.tipo];
        if (b.tipo === "temporale") disegnaFulmine(ctx, cx, y, 17, s.simbolo, s.bordo);
        else                        disegnaGoccia(ctx, cx, y, 6.5, s.simbolo, s.bordo);
      });
    }
  };

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

      // Frecce direzione vento nella zona bassa del grafico
      const arrowY = chart.chartArea.bottom + 40;
      oreSlice.forEach((ora, i) => {
        const gradi = dati[3] ? dati[3].direzione[start + i] : null;
        if (gradi === null) return;
        const xPos = x.getPixelForValue(i);
        ctx.save();
        ctx.translate(xPos, arrowY);
        ctx.rotate(((gradi + 180) * Math.PI) / 180);
        ctx.beginPath();
        ctx.moveTo(0, -8);
        ctx.lineTo(4, 4);
        ctx.lineTo(0, 1);
        ctx.lineTo(-4, 4);
        ctx.closePath();
        ctx.fillStyle = "#1565c0bb";
        ctx.fill();
        ctx.restore();
      });
    }
  };
  const canvas = document.getElementById("canvas-vento");
  const chartRef = new Chart(canvas, {
    type: "line", data: { labels: labelsSlice, datasets },
    options: {
      responsive: false, maintainAspectRatio: false, animation: false,
      layout: { padding: { bottom: 30 } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y} kn` } } },
      scales: {
        x: { ticks: { maxRotation: 90, minRotation: 90, font: { size: 10 }, color: "#444", maxTicksLimit: 50 }, grid: { color: "#e0e0e0" } },
        y: { ticks: { color: "#444", font: { size: 11 } }, grid: { color: "#e0e0e0" }, title: { display: true, text: "Nodi (kn)", color: "#444" } }
      }
    },
    plugins: [pluginMaltempo, pluginGiorni],
  });
  if (haVentoMedio) collegaPulsantiVento(chartRef);
  return chartRef;
}

// ============================================================
// PULSANTI RAFFICHE / VENTO MEDIO
// Due soli stati, sempre entrambe le serie disegnate:
//   A (iniziale) raffiche in primo piano, vento medio attenuato
//   B            vento medio in primo piano, raffiche attenuate
// Il pulsante della serie in primo piano e' rosso, l'altro grigio.
// ============================================================

// ============================================================
// AVVISO NOVITA'
// Striscia discreta sopra la prima scheda, mostrata UNA volta sola per
// versione. Compare subito al primo caricamento: sta in cima dentro la
// pagina, mentre il banner dei cookie e' fisso in fondo allo schermo, quindi
// non si sovrappongono.
// ============================================================

function mostraNovita() {
  const box = document.getElementById("novita");
  if (!box) return;
  if (leggiPreferenza(PREF_NOVITA) === VERSIONE_NOVITA) return;   // gia' letta

  box.style.display = "flex";
  const chiudi = document.getElementById("novita-chiudi");
  if (chiudi) {
    chiudi.addEventListener("click", () => {
      box.style.display = "none";
      salvaPreferenza(PREF_NOVITA, VERSIONE_NOVITA);
    });
  }
}

function collegaPulsantiVento(chart) {
  const btnRaff  = document.getElementById("btn-raffiche");
  const btnMedio = document.getElementById("btn-vento-medio");
  if (!btnRaff || !btnMedio) return;

  // Pulsanti e separatore restano nascosti finche' i dati non contengono il
  // vento medio: cosi' le pagine non cambiano aspetto prima del primo
  // aggiornamento della sveglia.
  const gruppo = btnRaff.parentElement;
  if (gruppo) gruppo.style.display = "";
  const separatore = document.getElementById("sep-vento");
  if (separatore) separatore.style.display = "";

  // Riparte dalla serie scelta l'ultima volta su questo dispositivo.
  let primoPiano = leggiPreferenza(PREF_SERIE) === "medio" ? "medio" : "raffiche";

  function attenua(colore) {
    // stesso colore, molto trasparente (aggiunge il canale alfa esadecimale)
    return colore.length === 7 ? colore + "40" : colore;
  }

  function applica() {
    chart.data.datasets.forEach(d => {
      if (!d.serie) return;                        // le soglie non si toccano
      const inPrimoPiano = d.serie === primoPiano;
      d.borderColor = inPrimoPiano ? d.coloreBase : attenua(d.coloreBase);
      d.borderWidth = inPrimoPiano ? d.spessoreBase : Math.max(d.spessoreBase - 0.6, 1);
    });
    btnRaff.classList.toggle("attivo", primoPiano === "raffiche");
    btnMedio.classList.toggle("attivo", primoPiano === "medio");
    chart.update();
  }

  function scegli(serie) {
    primoPiano = serie;
    salvaPreferenza(PREF_SERIE, serie);   // la prossima visita riparte da qui
    applica();
  }

  btnRaff.addEventListener("click", () => scegli("raffiche"));
  btnMedio.addEventListener("click", () => scegli("medio"));
  applica();
}



// ============================================================
// AVVIO
// ============================================================

function setStatus(msg, tipo = 'info') {
  const colori = { info: '#6d96b8', warn: '#f59e0b', error: '#e63c1e' };
  const wrapTimeline = document.getElementById("timeline-meteo");
  const wrapVento = document.getElementById("grafico-vento-wrap");
  const stile = `text-align:center;color:${colori[tipo]};font-size:.8rem;padding:1rem;`;
  if (wrapTimeline) wrapTimeline.innerHTML = `<p style="${stile}">${msg}</p>`;
  if (wrapVento) wrapVento.innerHTML = `<p style="${stile}">${msg}</p>`;
}

async function init() {
  const wrapTimeline = document.getElementById("timeline-meteo");
  const wrapVento = document.getElementById("grafico-vento-wrap");

  raffInfo = { fonte: null, orario: null }; // verrà valorizzato dal caricamento raffiche
  setStatus('Caricamento da MeteoSwiss...');

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

    wrapVento.innerHTML = '<canvas id="canvas-vento" width="1200" height="430"></canvas>';
  // Freccia scroll raffiche
  wrapVento.style.position = 'relative';
  const raffHint = document.createElement('div');
  raffHint.style.cssText = 'position:absolute;right:0;top:0;bottom:0;width:32px;display:flex;align-items:center;justify-content:center;background:linear-gradient(to right, transparent, rgba(255,255,255,0.95) 50%);pointer-events:none;z-index:10;';
  raffHint.innerHTML = '<svg width="16" height="48" viewBox="0 0 16 48" fill="none"><polyline points="4,4 12,24 4,44" stroke="#1a3a5c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/></svg>';
  wrapVento.appendChild(raffHint);
  wrapVento.addEventListener('scroll', () => {
    raffHint.style.display = wrapVento.scrollLeft > 20 ? 'none' : 'flex';
  });
    // MALTEMPO (4/4): il meteo entra nel grafico. E' gia' caricato qui sopra,
    // non costa nessuna richiesta in piu' — viene dallo stesso file.
    const chartRef = disegnaGrafico(dati, meteo);

    // Etichetta di freschezza, mostrata SEMPRE: trasparenza sull'orario
    // dell'ultimo aggiornamento.
    // Posizionata dentro l'area del grafico, appena sopra i numeri delle ore
    // (non in fondo al canvas, per non sovrapporsi alle frecce di direzione).
    const testoFresch = testoFreschezzaRaffiche(raffInfo);
    if (testoFresch) {
      // Grigia in regime normale, arancione se il file è oltre la soglia:
      // stesso arancione del messaggio di indisponibilità qui sotto.
      const colore = raffInfo.fonte === 'ritardo' ? '#e65100' : '#94a3b8';
      // chartArea.bottom è il bordo inferiore dell'area dati (sopra i tick delle ore).
      // chartArea.left è il bordo sinistro (subito a destra dell'asse Y / ordinate).
      const area = (chartRef && chartRef.chartArea) ? chartRef.chartArea : null;
      const areaBottom = area && area.bottom ? area.bottom : 230;
      const areaLeft = area && area.left ? area.left : 40;
      const tag = document.createElement('div');
      tag.style.cssText = `position:absolute;left:${areaLeft + 6}px;top:${areaBottom - 18}px;font-size:.6rem;color:${colore};background:rgba(255,255,255,0.82);padding:2px 6px;border-radius:3px;pointer-events:none;z-index:10;`;
      tag.textContent = testoFresch;
      wrapVento.appendChild(tag);
    }

  } catch (e) {
    if (wrapTimeline) wrapTimeline.innerHTML = "";
    if (wrapVento) wrapVento.innerHTML = '<p style="text-align:center;color:#e65100;padding:2rem;">Dati momentaneamente non disponibili. Riprova tra qualche minuto.</p>';
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
    btn.classList.add("attivo");
    const lgNorm = document.getElementById("legenda-normale");
    if (lgNorm) lgNorm.style.display = "none";

    // Inizializza mappa solo la prima volta
    if (!mappaIstanza) {
      mappaIstanza = L.map("mappa-leaflet", { zoomControl: false, attributionControl: false })
        .setView([_loc.lat, _loc.lon], 11);

      const tileLayer = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
      }).addTo(mappaIstanza);
      // Filtro CSS solo sulle tiles, non sui marker
      const style = document.createElement('style');
      style.textContent = '#mappa-leaflet .leaflet-tile-pane { filter: hue-rotate(180deg) saturate(0.6) brightness(1.1); }';
      document.head.appendChild(style);

      // Pin per ogni spot - usa colore direttamente da SPOTS
      SPOTS.forEach(spot => {
        const col = spot.colore;
        const icona = L.divIcon({
          html: `<div style="width:14px;height:14px;border-radius:50%;background:${col};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.5);"></div>`,
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
    btn.classList.remove("attivo");
    const lgNorm2 = document.getElementById("legenda-normale");
    if (lgNorm2) lgNorm2.style.display = "";
  }
}

// Aggiorna header con nome località e link all altra
document.addEventListener("DOMContentLoaded", () => {
  // Titolo e sottotitolo
  const h1 = document.querySelector("header h1");
  const p  = document.querySelector("header p");
  const coords = document.querySelector(".header-coords");
  if (coords) coords.innerHTML = `<span class="header-location">Lago di Garda · </span>${_loc.lat.toFixed(2)}°N ${_loc.lon.toFixed(2)}°E`;
  if (p)  p.textContent  = _loc.nome + " · " + _loc.sottotitolo;

  mostraNovita();

  // Ricorda la localita': chi frequenta solo Malcesine ci arriva diretto.
  // La preferenza si aggiorna sia arrivando su una pagina, sia CLICCANDO una
  // linguetta — quest'ultimo passaggio e' essenziale: senza, chi da Malcesine
  // sceglie Torbole verrebbe rispedito indietro dalla home.
  salvaPreferenza(PREF_LOCALITA, typeof LOC_ID !== "undefined" ? LOC_ID : "torbole");
  document.querySelectorAll("a.loc-tab[href]").forEach(a => {
    a.addEventListener("click", () => {
      const dest = a.getAttribute("href").includes("malcesine") ? "malcesine" : "torbole";
      salvaPreferenza(PREF_LOCALITA, dest);
    });
  });

  // Legenda spots dinamica
  // MALTEMPO: in coda agli spot, due voci che spiegano le fasce. Senza, chi
  // apre la pagina vede due sfondi colorati e deve indovinare cosa vogliano
  // dire. Il quadratino riprende la tinta esatta della fascia, ma con l'orlo
  // marcato: a quella trasparenza, su pochi pixel, altrimenti non si vede.
  ["legenda-normale", "legenda-mappa"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const spotsHtml = SPOTS.map(s =>
      `<span><span class="dot" style="background:${s.colore}"></span>${s.nome}</span>`
    ).join("");
    const meteoHtml = `
      <span title="Ore con pioggia prevista">
        <span class="dot" style="background:${MALTEMPO_STILE.pioggia.fascia};border:1px solid ${MALTEMPO_STILE.pioggia.simbolo};border-radius:2px;"></span>pioggia
      </span>
      <span title="Ore con temporale previsto: c'è vento, ma non è vento per uscire">
        <span class="dot" style="background:${MALTEMPO_STILE.temporale.fascia};border:1px solid ${MALTEMPO_STILE.temporale.bordo};border-radius:2px;"></span>temporale
      </span>`;
    el.innerHTML = spotsHtml + meteoHtml;
  });

  init();
});


// ============================================================
// GRAFICO PRESSIONE
// ============================================================
async function fetchPressione() {
  const r = await fetch(((window.location.pathname.includes('/malcesine') ? '../' : '') + 'differenza-pressione/data/wind_garda.json?v=') + Date.now(), { cache: 'no-store' });
  const d = await r.json();
  return d.rows || [];
}

async function initPressione() {
  try {
    const rows = await fetchPressione();
    if (!rows.length) { document.getElementById('press-status').textContent = 'Dati non disponibili'; return; }
    document.getElementById('press-status').style.display = 'none';

    const wrap = document.getElementById('press-wrap');
    const visibleW = wrap ? wrap.clientWidth : 700;
    // 6 giorni (144 ore) visibili nella finestra
    const pxPerHour = visibleW / 144;
    const w = Math.round(rows.length * pxPerHour);

    // Nascondi scroll hint dopo primo scroll
    const pressWrap = document.getElementById('press-wrap');
    if (pressWrap) pressWrap.addEventListener('scroll', () => {
      const hint = document.getElementById('press-scroll-hint');
      if (hint) hint.style.display = pressWrap.scrollLeft > 20 ? 'none' : 'flex';
    });

    const ctx = document.getElementById('press-canvas');
    ctx.style.width = w + 'px';
    ctx.width = w;
    ctx.style.height = '300px';
    ctx.height = 300;

    // Aggiusta frecce altezza dopo render
    const arrows = document.getElementById('press-arrows');

    const values = rows.map(r => r.delta_hpa);
    const maxVal = Math.max(...values.filter(v => v !== null));
    const minVal = Math.min(...values.filter(v => v !== null));
    const pad = 1.5;
    const yMax = Math.ceil((maxVal + pad) / 2) * 2;
    const yMin = Math.floor((minVal - pad) / 2) * 2;

    const pointColors = rows.map(r => r.delta_hpa >= 0 ? '#ff8a1f' : '#2f6bff');

    const zeroAndLines = {
      id: 'zeroAndLines',
      beforeDatasetsDraw(chart) {
        const { ctx, chartArea, scales } = chart;
        // Linee verticali ogni 6 ore
        const midnight = [];
        rows.forEach((r, i) => {
          const d = new Date(r.time);
          const h = d.getHours();
          if (h !== 0 && h !== 6 && h !== 12 && h !== 18) return;
          const xPos = scales.x.getPixelForValue(i);
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(xPos, chartArea.top);
          ctx.lineTo(xPos, chartArea.bottom);
          if (h === 0) {
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#1f293755';
            ctx.setLineDash([]);
            midnight.push({ xPos, time: r.time });
          } else if (h === 12) {
            ctx.lineWidth = 1;
            ctx.strokeStyle = '#1f293733';
            ctx.setLineDash([4, 3]);
          } else {
            ctx.lineWidth = 1;
            ctx.strokeStyle = '#e2e7ef';
            ctx.setLineDash([]);
          }
          ctx.stroke();
          ctx.restore();
        });
        // Linea zero
        const y0 = scales.y.getPixelForValue(0);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(chartArea.left, y0);
        ctx.lineTo(chartArea.right, y0);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#1f2937';
        ctx.setLineDash([]);
        ctx.stroke();
        ctx.restore();
        // Soglie ±2
        [2, -2].forEach(v => {
          const y = scales.y.getPixelForValue(v);
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(chartArea.left, y);
          ctx.lineTo(chartArea.right, y);
          ctx.lineWidth = 1;
          ctx.strokeStyle = v > 0 ? '#e6510066' : '#1565c066';
          ctx.setLineDash([6, 4]);
          ctx.stroke();
          ctx.restore();
        });
        // Aggiusta padding frecce
        if (arrows) {
          arrows.style.paddingTop = chartArea.top + 'px';
          arrows.style.paddingBottom = (ctx.canvas.height - chartArea.bottom) + 'px';
        }
      },
      afterDraw(chart) {
        const { ctx, chartArea, scales } = chart;
        // Etichette giorno
        const days = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'];
        const midnight = [];
        rows.forEach((r, i) => {
          if (new Date(r.time).getHours() === 0)
            midnight.push({ xPos: scales.x.getPixelForValue(i), time: r.time });
        });
        midnight.forEach((m, idx) => {
          const xEnd = idx + 1 < midnight.length ? midnight[idx+1].xPos : chartArea.right;
          const xCenter = (m.xPos + xEnd) / 2;
          const d = new Date(m.time);
          const label = days[d.getDay()] + ' ' + String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0');
          ctx.save();
          ctx.font = '700 11px system-ui, sans-serif';
          const tw = ctx.measureText(label).width;
          ctx.fillStyle = 'rgba(255,255,255,0.95)';
          ctx.fillRect(xCenter - tw/2 - 3, chartArea.top - 18, tw + 6, 16);
          ctx.fillStyle = '#1f2937cc';
          ctx.textAlign = 'center';
          ctx.fillText(label, xCenter, chartArea.top - 6);
          ctx.restore();
        });
      }
    };

    new Chart(ctx, {
      type: 'line',
      data: {
        labels: rows.map((_, i) => i),
        datasets: [{
          data: values,
          borderColor: '#3a8fb5',
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 5,
          tension: 0,
          pointBackgroundColor: pointColors,
          pointBorderColor: pointColors,
          pointHoverBackgroundColor: '#3a8fb5',
        }]
      },
      options: {
        responsive: false,
        maintainAspectRatio: false,
        layout: { padding: { top: 24 } },
        interaction: { mode: 'index', intersect: false },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(242,240,235,0.65)',
            borderColor: '#d8d4cc',
            borderWidth: 1,
            titleColor: '#1a3a5c',
            bodyColor: '#7a7060',
            padding: 8,
            callbacks: {
              label(ctx) {
                const r = rows[ctx.dataIndex];
                return `ΔP: ${r.delta_hpa.toFixed(1)} hPa`;
              },
              title(items) {
                const d = new Date(rows[items[0].dataIndex].time);
                return d.toLocaleString('it-IT', { weekday:'short', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
              }
            }
          }
        },
        scales: {
          x: {
            ticks: {
              maxRotation: 0,
              autoSkip: false,
              callback(val, index) {
                const d = new Date(rows[index].time);
                const h = d.getHours();
                if (h !== 0 && h !== 6 && h !== 12 && h !== 18) return null;
                return h === 0 ? '0' : String(h);
              },
              font(ctx) {
                const h = ctx.index < rows.length ? new Date(rows[ctx.index].time).getHours() : 0;
                return { weight: h === 0 ? '700' : '400', size: 9 };
              }
            },
            grid: { display: false }
          },
          y: {
            min: yMin,
            max: yMax,
            ticks: { stepSize: 2 },
            title: { display: true, text: 'ΔP hPa' },
            grid: { color: '#edf0f5' }
          }
        }
      },
      plugins: [zeroAndLines, {
        id: 'oraPeler',
        afterDraw(chart) {
          const { ctx, chartArea, scales } = chart;
          if (!scales.y) return;
          const yOra = scales.y.getPixelForValue(2);
          const yPeler = scales.y.getPixelForValue(-2);
          const x = chartArea.left + 26;
          ctx.save();
          ctx.font = '700 8px system-ui, sans-serif';
          ctx.textAlign = 'left';
          ctx.fillStyle = '#e65100cc';
          ctx.beginPath();
          ctx.moveTo(x, yOra - 8); ctx.lineTo(x+6, yOra); ctx.lineTo(x+3, yOra);
          ctx.lineTo(x+3, yOra+5); ctx.lineTo(x-3, yOra+5); ctx.lineTo(x-3, yOra);
          ctx.lineTo(x-6, yOra); ctx.closePath(); ctx.fill();
          ctx.fillText('ORA', x+10, yOra+4);
          ctx.fillStyle = '#1565c0cc';
          ctx.beginPath();
          ctx.moveTo(x, yPeler+8); ctx.lineTo(x+6, yPeler); ctx.lineTo(x+3, yPeler);
          ctx.lineTo(x+3, yPeler-5); ctx.lineTo(x-3, yPeler-5); ctx.lineTo(x-3, yPeler);
          ctx.lineTo(x-6, yPeler); ctx.closePath(); ctx.fill();
          ctx.fillText('PELÈR', x+10, yPeler+4);
          ctx.restore();
        }
      }, {
        id: 'crosshair',
        afterDraw(chart) {
          if (!chart.tooltip._active || !chart.tooltip._active.length) return;
          const { ctx, chartArea, scales } = chart;
          const x = chart.tooltip._active[0].element.x;
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(x, chartArea.top);
          ctx.lineTo(x, chartArea.bottom);
          ctx.lineWidth = 1;
          ctx.strokeStyle = '#1a3a5c44';
          ctx.setLineDash([4, 3]);
          ctx.stroke();
          ctx.restore();
        }
      }]
    });
  } catch(err) {
    document.getElementById('press-status').textContent = 'Errore: ' + err.message;
    console.error(err);
  }
}

initPressione();