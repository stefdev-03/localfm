// Turns a file name such as "Daft Punk - Get Lucky (Official Audio).mp3"
// into { artist: "Daft Punk", title: "Get Lucky" }. Pure functions, no I/O.

// Bracketed chunks that describe the upload rather than the song.
const NOISE =
  /\s*[([{][^)\]}]*\b(official|video|audio|lyrics?|visuali[sz]er|hd|hq|4k|mv|explicit|full song)\b[^)\]}]*[)\]}]/gi;

// A video id that download tools append, e.g. " [dQw4w9WgXcQ]".
const TRAILING_ID = /\s*\[[A-Za-z0-9_-]{11}\]$/;

// " - " with spaces (so "Jay-Z" survives), or an en/em dash with or without spaces.
const SEPARATOR = /\s+-\s+|\s*[–—]\s*/;

// "01. Song" / "1) Song" / "01 Song" (zero-padded only, so "50 Cent" survives).
const LEADING_NUMBER = /^(\d{1,3}[.)]\s+|0\d\s+)/;

export function parseFileName(fileName) {
  const raw = String(fileName).replace(/\.[^.]+$/, '');
  let base = raw.replace(TRAILING_ID, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const withoutNoise = base.replace(NOISE, '').replace(/\s+/g, ' ').trim();
  if (withoutNoise) base = withoutNoise;

  const parts = base
    .split(SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean);

  // "07 - Artist - Title" or "07 - Title": the first part is a track number.
  if (parts.length >= 3 && /^\d{1,3}$/.test(parts[0])) parts.shift();
  else if (parts.length === 2 && /^\d{1,2}$/.test(parts[0])) parts.shift();

  if (parts.length >= 2) {
    const artist = parts[0].replace(LEADING_NUMBER, '').trim() || parts[0];
    return { artist, title: parts.slice(1).join(' - ') };
  }

  const only = parts[0] ?? base;
  const title = only.replace(LEADING_NUMBER, '').trim() || only || raw || String(fileName);
  return { artist: '', title };
}

// Tags win when they exist; the file name fills in whatever is missing.
export function resolveNames(fileName, tags = {}) {
  const fromFile = parseFileName(fileName);
  const tagTitle = typeof tags.title === 'string' ? tags.title.trim() : '';
  const tagArtist = typeof tags.artist === 'string' ? tags.artist.trim() : '';
  return {
    title: tagTitle || fromFile.title,
    artist: tagArtist || fromFile.artist,
  };
}
