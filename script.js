// Cache buster per il grafico vento — forza il browser a ricaricare sempre l'immagine aggiornata
document.getElementById('grafico-vento').src = 'vento_torbole.png?_=' + Date.now();
