// Albums and artists worked out from the track list. Pure, with no imports
// from the rest of the window, so it can be unit-tested under plain Node.
//
// Tracks cached by an older version may lack albumArtist, year, trackNo and
// discNo for a moment after launch; every one of them is optional here.

export const VARIOUS_ARTISTS = 'Various artists';

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

// Lower-case, accents dropped, spaces collapsed: "Beyoncé " and "beyonce" match.
export function norm(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const isVarious = (name) => ['various artists', 'various', 'va'].includes(norm(name));

// The folder a file sits in, lower-cased, for either kind of slash.
function folderOf(filePath) {
  const text = String(filePath ?? '');
  return text.slice(0, Math.max(text.lastIndexOf('\\'), text.lastIndexOf('/'))).toLowerCase();
}

// The value most entries share, with its count; ties go to the first seen.
function mostCommon(values) {
  const counts = new Map();
  let best = null;
  for (const value of values) {
    const count = (counts.get(value) ?? 0) + 1;
    counts.set(value, count);
    if (!best || count > best.count) best = { value, count };
  }
  return best;
}

const byAlbumOrder = (a, b) =>
  (a.discNo || 0) - (b.discNo || 0) || (a.trackNo || 0) - (b.trackNo || 0) || collator.compare(a.path ?? '', b.path ?? '');

export function albumKey(track) {
  const album = norm(track.album);
  if (!album) return null;
  const albumArtist = norm(track.albumArtist);
  return albumArtist ? `${album}|aa:${albumArtist}` : `${album}|dir:${folderOf(track.path)}`;
}

function albumArtistFor(tracks) {
  const tagged = mostCommon(tracks.map((track) => track.albumArtist?.trim()).filter(Boolean));
  if (tagged) return isVarious(tagged.value) ? VARIOUS_ARTISTS : tagged.value;
  // No album artist: the artist at least half the songs share, spelled the
  // way most of them spell it.
  const credited = tracks.map((track) => track.artist?.trim()).filter(Boolean);
  const top = mostCommon(credited.map(norm));
  if (!top || top.count * 2 < tracks.length) return VARIOUS_ARTISTS;
  return mostCommon(credited.filter((name) => norm(name) === top.value)).value;
}

export function buildAlbums(tracks) {
  const groups = new Map();
  for (const track of tracks) {
    const key = albumKey(track);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(track);
  }
  const albums = [];
  for (const [key, members] of groups) {
    const ordered = members.slice().sort(byAlbumOrder);
    const year = mostCommon(members.map((track) => track.year).filter((value) => Number.isInteger(value) && value > 0));
    albums.push({
      key,
      title: members[0].album.trim(),
      artist: albumArtistFor(members),
      year: year?.value ?? 0,
      tracks: ordered,
      art: ordered.find((track) => track.art)?.art ?? null,
      duration: members.reduce((sum, track) => sum + (track.duration || 0), 0),
      added: Math.max(...members.map((track) => track.mtime || 0)),
    });
  }
  return albums;
}

// ---- artists -----------------------------------------------------------
//
// Tags credit collaborations in many ways ("A, B", "A & B", "A feat. B"), and
// some real names contain the same punctuation ("Earth, Wind & Fire"). So a
// credit is split only when the library itself proves a part is an artist:
// some song or album credits that part on its own.

// " feat. B", " (ft. B)", " featuring B" at the end of a credit.
const FEATURING = /\s*[([]?\s*\b(?:feat\.?|ft\.?|featuring)(?:\s|$).*$/i;
const SEPARATORS = /\s*(?:,|;|&|\s+x\s+|\s+vs\.?\s+|\b(?:feat\.?|ft\.?|featuring)(?=\s|$)|[()[\]])\s*/i;

export const mainCredit = (artist) => String(artist ?? '').replace(FEATURING, '').trim();

// The names a track is credited to, in the library's own terms.
export function creditedArtists(artist, known) {
  const text = String(artist ?? '').trim();
  if (!text) return [];
  const parts = text.split(SEPARATORS).map((part) => part.trim()).filter(Boolean);
  const matched = [...new Set(parts.filter((part) => known.has(norm(part))))];
  return matched.length ? matched : [mainCredit(text) || text];
}

export function buildArtists(tracks, albums) {
  const known = new Set();
  for (const track of tracks) {
    const main = norm(mainCredit(track.artist));
    if (main) known.add(main);
    if (track.albumArtist && !isVarious(track.albumArtist)) known.add(norm(track.albumArtist));
  }

  const groups = new Map(); // key -> { spellings, tracks }
  const group = (name) => {
    const key = norm(name);
    if (!groups.has(key)) groups.set(key, { spellings: [], tracks: new Set() });
    return groups.get(key);
  };
  for (const track of tracks) {
    for (const name of creditedArtists(track.artist, known)) {
      const entry = group(name);
      entry.spellings.push(name);
      entry.tracks.add(track);
    }
  }
  // An album artist with no song credited to them still has albums to show.
  for (const album of albums) {
    if (album.artist !== VARIOUS_ARTISTS) group(album.artist).spellings.push(album.artist);
  }

  const artists = [];
  for (const [key, entry] of groups) {
    if (!key) continue;
    artists.push({
      key,
      name: mostCommon(entry.spellings).value,
      tracks: [...entry.tracks].sort((a, b) => collator.compare(a.title, b.title) || collator.compare(a.artist, b.artist)),
      albums: albums.filter((album) => album.artist !== VARIOUS_ARTISTS && norm(album.artist) === key),
    });
  }
  return artists;
}

export function buildCatalog(tracks) {
  const albums = buildAlbums(tracks);
  const artists = buildArtists(tracks, albums);
  return {
    albums,
    albumMap: new Map(albums.map((album) => [album.key, album])),
    artists,
    artistMap: new Map(artists.map((artist) => [artist.key, artist])),
  };
}

export const ARTIST_SORTS = {
  name: { label: 'Name', compare: (a, b) => collator.compare(a.name, b.name) },
  songs: { label: 'Most songs', compare: (a, b) => b.tracks.length - a.tracks.length || collator.compare(a.name, b.name) },
};

// Sort orders for the albums page.
const byTitle = (a, b) => collator.compare(a.title, b.title) || collator.compare(a.artist, b.artist);
export const ALBUM_SORTS = {
  title: { label: 'Title', compare: byTitle },
  artist: { label: 'Artist', compare: (a, b) => collator.compare(a.artist, b.artist) || (b.year || 0) - (a.year || 0) || byTitle(a, b) },
  year: {
    label: 'Year',
    // Newest first; albums without a year go last.
    compare: (a, b) => (!a.year !== !b.year ? (a.year ? -1 : 1) : b.year - a.year || byTitle(a, b)),
  },
  recent: { label: 'Recently added', compare: (a, b) => b.added - a.added || byTitle(a, b) },
};
