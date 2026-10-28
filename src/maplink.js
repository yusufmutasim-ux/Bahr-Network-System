// Extract coordinates from Google Maps links, following short-link redirects (maps.app.goo.gl).

const ALLOWED_HOST = /^(maps\.app\.goo\.gl|goo\.gl|g\.co|(www\.|maps\.)?google\.[a-z.]{2,8}|consent\.google\.[a-z.]{2,8})$/i;

function coordsFromUrl(raw) {
  let u = String(raw);
  try {
    u = decodeURIComponent(u);
  } catch {
    /* keep raw */
  }
  const pick = (re) => {
    const m = u.match(re);
    if (!m) return null;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
  };
  return (
    // Exact place pin (more precise than the viewport centre).
    pick(/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/) ||
    pick(/[?&](?:q|query|ll|destination|center|daddr)=(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/) ||
    pick(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/) ||
    pick(/^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/)
  );
}

async function resolveMapLink(input, fetchImpl = fetch) {
  const direct = coordsFromUrl(input);
  if (direct) return direct;
  let url;
  try {
    url = new URL(String(input).trim());
  } catch {
    return null;
  }
  for (let hop = 0; hop < 6; hop++) {
    if (url.protocol !== 'https:' || !ALLOWED_HOST.test(url.hostname)) return null;
    // Consent interstitials carry the real target in ?continue=
    if (/^consent\./i.test(url.hostname) && url.searchParams.get('continue')) {
      const found = coordsFromUrl(url.searchParams.get('continue'));
      if (found) return found;
      url = new URL(url.searchParams.get('continue'));
      continue;
    }
    const res = await fetchImpl(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (BahrNetwork location resolver)' } });
    const loc = res.headers.get('location');
    if (loc) {
      const next = new URL(loc, url);
      const found = coordsFromUrl(next.href);
      if (found) return found;
      url = next;
      continue;
    }
    const found = coordsFromUrl(url.href);
    if (found) return found;
    // Some pages embed the coordinates in the HTML instead of the URL.
    const html = (await res.text()).slice(0, 400000);
    return coordsFromUrl(html.match(/https:\/\/www\.google\.[a-z.]+\/maps\/[^"'\s]*@-?\d+\.\d+,-?\d+\.\d+[^"'\s]*/)?.[0] || '');
  }
  return null;
}

module.exports = { coordsFromUrl, resolveMapLink };
