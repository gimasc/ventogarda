/* =============================================================
   SCHEDA "IN TEMPO REALE" — vento MISURATO dalle stazioni
   =============================================================
   Legge data/reale_<stazione>.json, prodotto ogni 10 minuti da
   scripts/reale_stazioni.py. Contiene solo la finestra che si vede:
   ultimo dato, ultime 6 ore minuto per minuto, 10 giorni in medie orarie.

   E' l'unico posto del sito dove si puo' scrivere "tempo reale": tutto il
   resto sono previsioni. Se il dato invecchia oltre la soglia, la scheda lo
   dice invece di far finta di niente — mostrare un dato vecchio come fosse
   fresco e' peggio che ammettere che manca.
   ============================================================= */
(function () {
  const STAZIONI = [
    { chiave: 'torbole_surf', nome: 'Circolo Surf' },
    { chiave: 'hotel_pier',   nome: 'Hotel Pièr' },
  ];

  // Le finestre selezionabili sotto al grafico.
  const FINESTRE = [
    { id: '3h',  testo: '3 ore',    ore: 3,   serie: 'dettaglio' },
    { id: '6h',  testo: '6 ore',    ore: 6,   serie: 'dettaglio' },
    { id: '48h', testo: '2 giorni', ore: 48,  serie: 'oraria' },
    { id: '10g', testo: '10 giorni', ore: 240, serie: 'oraria' },
  ];

  // Oltre questi minuti il dato non e' piu' "adesso" e va detto.
  const SOGLIA_VECCHIO_MIN = 45;

  const COLORI = { raffica: '#e63c1e', vento: '#1a3a5c' };

  let stazioneAttiva = STAZIONI[0].chiave;
  let finestraAttiva = '6h';
  const cache = {};
  let grafico = null;

  const el = (id) => document.getElementById(id);

  // Gli orari nei nostri JSON sono UTC senza marcatura: va aggiunta la "Z",
  // altrimenti il browser li interpreta come ora locale. E' la stessa
  // convenzione degli altri file del sito.
  const quando = (iso) => new Date(iso + 'Z');

  const oraBreve = (d) =>
    d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

  function rosaDeiVenti(gradi) {
    if (gradi === null || gradi === undefined) return '';
    const punti = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                   'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
    return punti[Math.round(gradi / 22.5) % 16];
  }

  /* La freccia indica DOVE VA il vento, non da dove viene: e' la convenzione
     piu' leggibile per chi guarda il lago. La direzione meteorologica dice la
     provenienza, quindi si ruota di 180 gradi. */
  function frecciaSVG(gradi) {
    if (gradi === null || gradi === undefined) return '';
    return `<svg class="reale-freccia" viewBox="0 0 40 40" aria-hidden="true">
      <g transform="rotate(${(gradi + 180) % 360} 20 20)">
        <line x1="20" y1="31" x2="20" y2="9" stroke="${COLORI.raffica}"
              stroke-width="2.5" stroke-linecap="round"/>
        <polyline points="13,16 20,8 27,16" fill="none" stroke="${COLORI.raffica}"
                  stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      </g>
    </svg>`;
  }

  function pulsanti(contenitore, voci, attivo, alClic) {
    contenitore.innerHTML = '';
    voci.forEach((v) => {
      const b = document.createElement('button');
      b.className = 'btn-minimal' + (v.id === attivo ? ' attivo' : '');
      b.textContent = v.testo;
      b.onclick = () => alClic(v.id);
      contenitore.appendChild(b);
    });
  }

  async function carica(chiave) {
    if (cache[chiave]) return cache[chiave];
    const r = await fetch(`data/reale_${chiave}.json?_=${Date.now()}`);
    if (!r.ok) throw new Error('file non disponibile');
    cache[chiave] = await r.json();
    return cache[chiave];
  }

  function disegnaOra(d) {
    const u = d.ultimo || {};
    const eta = d.eta_minuti;
    const vecchio = eta !== undefined && eta > SOGLIA_VECCHIO_MIN;
    const dir = u.direzione_gradi;

    el('reale-ora').innerHTML = `
      ${frecciaSVG(dir)}
      <div class="reale-num"><b>${u.vento_medio_kn ?? '–'}</b><span>nodi</span></div>
      <div class="reale-voce"><em>Raffica</em><strong>${u.raffica_kn ?? '–'} kn</strong></div>
      <div class="reale-voce"><em>Direzione</em><strong>${rosaDeiVenti(dir)}${
        dir !== null && dir !== undefined ? ' · ' + Math.round(dir) + '°' : ''
      }</strong></div>
      ${u.temperatura_c !== null && u.temperatura_c !== undefined
        ? `<div class="reale-voce"><em>Temperatura</em><strong>${u.temperatura_c}°</strong></div>` : ''}
    `;

    const stato = document.createElement('div');
    stato.className = 'reale-stato' + (vecchio ? ' vecchio' : '');
    stato.textContent = vecchio
      ? `Attenzione: ultimo dato di ${eta} minuti fa. La stazione potrebbe essere ferma.`
      : `Misurato alle ${oraBreve(quando(u.time))} · stazione ${d.stazione_nome}`;
    el('reale-ora').after(stato);

    el('reale-fonte').textContent = `Fonte: stazione ${d.stazione_nome} · dato misurato`;
  }

  function disegnaGrafico(d) {
    const f = FINESTRE.find((x) => x.id === finestraAttiva);
    const s = f.serie === 'dettaglio' ? d.serie_dettaglio : d.serie_oraria;
    if (!s || !s.time || !s.time.length) return;

    const limite = Date.now() - f.ore * 3600 * 1000;
    const punti = [];
    s.time.forEach((t, i) => {
      const q = quando(t);
      if (q.getTime() >= limite) {
        punti.push({ q, vento: s.vento_medio_kn[i], raffica: s.raffica_kn[i] });
      }
    });
    if (!punti.length) return;

    // Il grafico scorre in orizzontale come quello delle raffiche: si dà una
    // larghezza proporzionale ai punti, con un minimo per non comprimerlo.
    const larghezza = Math.max(340, Math.min(punti.length * 6, 2400));
    const canvas = el('reale-grafico');
    canvas.style.width = larghezza + 'px';

    if (grafico) grafico.destroy();
    grafico = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: punti.map((p) => oraBreve(p.q)),
        datasets: [
          { label: 'Raffica', data: punti.map((p) => p.raffica),
            borderColor: COLORI.raffica, backgroundColor: COLORI.raffica + '22',
            borderWidth: 1.6, pointRadius: 0, tension: .25, fill: true },
          { label: 'Vento', data: punti.map((p) => p.vento),
            borderColor: COLORI.vento, borderWidth: 1.4,
            pointRadius: 0, tension: .25, fill: false },
        ],
      },
      options: {
        responsive: false, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, labels: { boxWidth: 10, font: { size: 10 } } },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y} kn` } },
        },
        scales: {
          x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10,
                        font: { size: 9 } }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { font: { size: 9 }, callback: (v) => v + ' kn' },
               grid: { color: 'rgba(26,58,92,.08)' } },
        },
      },
    });

    // Si parte dal fondo: quello che interessa e' adesso, non tre ore fa.
    const wrap = el('reale-grafico-wrap');
    wrap.scrollLeft = wrap.scrollWidth;
  }

  async function mostra() {
    try {
      const d = await carica(stazioneAttiva);
      document.querySelectorAll('.reale-stato').forEach((n) => n.remove());
      disegnaOra(d);
      disegnaGrafico(d);
    } catch (e) {
      el('reale-ora').innerHTML =
        '<div class="reale-stato">Dato non disponibile al momento.</div>';
      console.warn('[reale]', e);
    }
  }

  function avvia() {
    if (!el('reale-ora')) return;          // la scheda non c'e' in questa pagina
    pulsanti(el('reale-stazioni'),
      STAZIONI.map((s) => ({ id: s.chiave, testo: s.nome })),
      stazioneAttiva,
      (id) => { stazioneAttiva = id; avviaPulsanti(); mostra(); });
    pulsanti(el('reale-finestre'), FINESTRE, finestraAttiva,
      (id) => { finestraAttiva = id; avviaPulsanti(); mostra(); });
    mostra();
  }

  function avviaPulsanti() {
    pulsanti(el('reale-stazioni'),
      STAZIONI.map((s) => ({ id: s.chiave, testo: s.nome })),
      stazioneAttiva,
      (id) => { stazioneAttiva = id; avviaPulsanti(); mostra(); });
    pulsanti(el('reale-finestre'), FINESTRE, finestraAttiva,
      (id) => { finestraAttiva = id; avviaPulsanti(); mostra(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', avvia);
  } else {
    avvia();
  }
})();
