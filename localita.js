// ============================================================
// LOCALITA.JS — Dati di tutte le località
// Per aggiungere una località: aggiungi un blocco come quelli
// esistenti. Per modificare spot o coordinate: modifica qui.
// ============================================================

const LOCALITA = {

  torbole: {
    nome:        "Torbole",
    sottotitolo: "Lago di Garda Nord",
    lat:         45.86212,
    lon:         10.87536,
    altra:       { nome: "Malcesine / Medio Garda", url: "/malcesine/" },
    spots: [
      { nome: "Spiaggia Lucertole", lat: 45.84928, lon: 10.86224, colore: "#ebc402" },
      { nome: "Hotel Pièr",         lat: 45.84487, lon: 10.82867, colore: "#0901fc" },
      { nome: "Terrazza Ponale",    lat: 45.87807, lon: 10.83904, colore: "#e65100" },
      { nome: "Conca d'Oro",        lat: 45.86212, lon: 10.87536, colore: "#15b101" },
    ],
  },

  malcesine: {
    nome:        "Malcesine",
    sottotitolo: "Lago di Garda Medio",
    lat:         45.780,
    lon:         10.810,
    altra:       { nome: "Torbole / Garda Nord", url: "/" },
    spots: [
      { nome: "Limone",        lat: 45.807156, lon: 10.791900, colore: "#ebc402" },
      { nome: "Navene",        lat: 45.804429, lon: 10.843017, colore: "#0901fc" },
      { nome: "Parcheggione", lat: 45.775657, lon: 10.813822, colore: "#e65100" },
      { nome: "Campione",      lat: 45.754310, lon: 10.752089, colore: "#15b101" },
    ],
  },

};
