// Decides whether an online search result is the same song as a local track.
// Pure functions, no I/O.

export function normalize(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(/\b(feat|ft|featuring)\b\.?.*$/u, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// "Calvin Harris, Dua Lipa" / "A & B" / "A x B" / "A feat. B" -> "Calvin Harris"
export function primaryArtist(artist) {
  const first = String(artist ?? '').split(/\s*(?:,|;|&|\bx\b|\bvs\.?\b|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b)\s*/i)[0];
  return first.trim() || String(artist ?? '').trim();
}

const containsWords = (haystack, needle) => ` ${haystack} `.includes(` ${needle} `);

export function isSameSong(local, candidate) {
  const localTitle = normalize(local.title);
  const localArtist = normalize(local.artist);
  const localPrimary = normalize(primaryArtist(local.artist));
  const title = normalize(candidate.title);
  const artist = normalize(candidate.artist);
  if (!localTitle || !localArtist || !title || !artist) return false;

  const artistOk =
    artist === localArtist ||
    (localPrimary && containsWords(artist, localPrimary)) ||
    containsWords(localArtist, artist);
  if (!artistOk) return false;

  return title === localTitle || title.startsWith(`${localTitle} `) || localTitle.startsWith(`${title} `);
}

export function lookupKey(artist, title) {
  return `${normalize(primaryArtist(artist))}|${normalize(title)}`;
}
