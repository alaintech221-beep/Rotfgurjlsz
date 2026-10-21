// Netlify Function : trouve le lien .m3u8 actuel d'une chaîne.
// Utilisation :  /.netlify/functions/flux?id=france-4   ->  { "url": "https://....m3u8" }
//
// POUR AJOUTER UNE CHAÎNE : ajoute une ligne dans SOURCES ci-dessous, puis dans
// l'admin mets comme lien de la chaîne :  auto:ton-id

const SOURCES = {
  france-4: "https://www.stream4free.tv/france-4",
  // autre: "https://exemple.com/page-de-la-chaine",
};

const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const cache = {}; // { id: { url, t } }

async function lire(url, referer) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, "Referer": referer, "Accept-Language": "fr-FR,fr;q=0.9" },
    redirect: "follow",
  });
  if (!r.ok) throw new Error("HTTP " + r.status + " sur " + url);
  return r.text();
}

// Cherche un .m3u8 dans un texte (y compris échappé, encodé ou en base64)
function chercher(texte) {
  const variantes = [texte];
  variantes.push(texte.replace(/\\\//g, "/").replace(/\\u0026/g, "&").replace(/&amp;/g, "&"));
  try { variantes.push(decodeURIComponent(variantes[1])); } catch (e) {}
  // chaînes base64 qui contiennent un lien
  for (const m of texte.matchAll(/atob\(\s*["']([A-Za-z0-9+/=]{20,})["']\s*\)/g)) {
    try { variantes.push(Buffer.from(m[1], "base64").toString("utf8")); } catch (e) {}
  }
  for (const m of texte.matchAll(/["']([A-Za-z0-9+/=]{40,})["']/g)) {
    try {
      const d = Buffer.from(m[1], "base64").toString("utf8");
      if (/m3u8/i.test(d)) variantes.push(d);
    } catch (e) {}
  }
  for (const v of variantes) {
    const m = v.match(/https?:\/\/[^\s"'<>\\()]+?\.m3u8[^\s"'<>\\()]*/i);
    if (m) return m[0];
  }
  return null;
}

// Explore la page, puis ses iframes et ses scripts (2 niveaux max)
async function trouver(pageUrl, niveau = 0, vus = new Set()) {
  if (vus.has(pageUrl) || niveau > 2) return null;
  vus.add(pageUrl);
  let html;
  try { html = await lire(pageUrl, pageUrl); } catch (e) { if (niveau === 0) throw e; return null; }

  const direct = chercher(html);
  if (direct) return direct;

  const liens = [];
  for (const m of html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)) liens.push(m[1]);
  for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) liens.push(m[1]);
  for (const l of liens) {
    let abs;
    try { abs = new URL(l, pageUrl).href; } catch (e) { continue; }
    if (!/^https?:/.test(abs)) continue;
    const r = await trouver(abs, niveau + 1, vus);
    if (r) return r;
  }
  return null;
}

exports.handler = async (event) => {
  const id = (event.queryStringParameters || {}).id;
  const page = SOURCES[id];
  if (!page) return rep(404, { erreur: "Chaîne inconnue : " + id });
  try {
    const c = cache[id];
    if (c && Date.now() - c.t < 60000) return rep(200, { url: c.url });
    const url = await trouver(page);
    if (!url) return rep(404, { erreur: "Aucun lien m3u8 trouvé dans la page." });
    cache[id] = { url, t: Date.now() };
    return rep(200, { url });
  } catch (e) {
    return rep(502, { erreur: String(e.message || e) });
  }
};

function rep(code, obj) {
  return { statusCode: code, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(obj) };
}
