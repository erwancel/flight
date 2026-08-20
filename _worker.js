// PréVol DR400 — worker Cloudflare Pages (mode avancé)
//
// Un seul fichier à la racine : Cloudflare le prend en compte même avec un
// dépôt par glisser-déposer (contrairement au dossier /functions, qui exige
// l'outil Wrangler).
//
// Rôle : servir l'app normalement, et relayer /api/wx vers l'Aviation
// Weather Center. Ce relais est nécessaire parce que l'API de l'AWC
// n'autorise pas les appels directs depuis un navigateur (pas de CORS).

// Deux points d'entrée AWC. Le second est plus léger et répond quand le
// premier sature (erreurs 502/504 fréquentes aux heures chargées).
const ENDPOINTS = [
  'https://aviationweather.gov/api/data/metar',
  'https://aviationweather.gov/cgi-bin/data/metar.php'
];

// Seuls ces paramètres sont transmis à l'AWC : le relais ne peut pas
// servir de proxy ouvert vers d'autres adresses.
const ALLOWED = ['ids', 'bbox', 'taf', 'hours', 'format'];

const TIMEOUT_MS = 12000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/wx') {
      return handleWx(url);
    }

    // Tout le reste : fichiers statiques de l'app (index.html, sw.js, icônes…)
    return env.ASSETS.fetch(request);
  }
};

async function handleWx(url) {
  const params = new URLSearchParams();
  for (const key of ALLOWED) {
    const value = url.searchParams.get(key);
    if (value) params.set(key, value);
  }
  params.set('format', 'json');

  if (!params.get('ids') && !params.get('bbox')) {
    return json({ error: 'Préciser ids= ou bbox=' }, 400);
  }

  const query = params.toString();
  let lastError = 'Serveur météo injoignable';

  // Chaque point d'entrée est tenté deux fois : l'AWC renvoie
  // régulièrement une erreur passagère qui disparaît au réessai.
  for (const base of ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const data = await tryFetch(`${base}?${query}`);
        if (data !== null) return json(data, 200);
      } catch (err) {
        lastError = err.message || lastError;
      }
      // Courte pause avant le réessai
      await new Promise(r => setTimeout(r, 400));
    }
  }

  return json({ error: lastError }, 502);
}

async function tryFetch(target) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(target, {
      signal: controller.signal,
      headers: {
        // L'AWC demande un User-Agent identifiable pour ne pas filtrer
        // le trafic légitime.
        'User-Agent': 'PreVol-DR400/1.0 (application privee de preparation de vol)',
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      throw new Error(`Serveur météo : HTTP ${res.status}`);
    }

    const text = await res.text();
    if (!text.trim()) return [];        // aucune station : réponse valide

    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      throw new Error('Réponse météo illisible');
    }

    // Les deux points d'entrée renvoient soit un tableau, soit un objet
    // contenant le tableau.
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.data)) return data.data;
    return [];
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Serveur météo : délai dépassé');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      // Une observation météo ne doit jamais être servie depuis un cache.
      'Cache-Control': 'no-store'
    }
  });
}
