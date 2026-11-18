import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildAlbums, buildCatalog, norm, albumKey, ALBUM_SORTS, ARTIST_SORTS, VARIOUS_ARTISTS } from '../../src/renderer/js/catalog.js';
import { albumFromFolder } from '../../src/main/library.js';

let next = 0;
const track = (fields) => ({
  id: String(next++),
  path: `C:\\Music\\${fields.dir ?? 'Loose'}\\${fields.title ?? 'Song'}.mp3`,
  title: 'Song',
  artist: '',
  album: '',
  art: null,
  duration: 100,
  mtime: 1,
  ...fields,
});
const titles = (album) => album.tracks.map((t) => t.title);

test('norm drops accents, case and extra spaces', () => {
  assert.equal(norm('  Beyoncé   Knowles '), 'beyonce knowles');
  assert.equal(norm('ＡＢＣ'), 'abc');
  assert.equal(norm(undefined), '');
});

test('songs without an album name belong to no album', () => {
  const albums = buildAlbums([track({ title: 'Loose', artist: 'A' }), track({ album: '   ', artist: 'A' })]);
  assert.equal(albums.length, 0);
});

test('an album artist keeps an album together across folders and guest credits', () => {
  const albums = buildAlbums([
    track({ album: 'Night Drive', albumArtist: 'Iris Vale', artist: 'Iris Vale', title: 'One', dir: 'CD1' }),
    track({ album: 'night drive', albumArtist: 'IRIS VALE', artist: 'Iris Vale feat. Someone', title: 'Two', dir: 'CD2' }),
  ]);
  assert.equal(albums.length, 1);
  assert.equal(albums[0].artist, 'Iris Vale');
  assert.equal(albums[0].title, 'Night Drive');
});

test('without an album artist, songs group by album name and folder', () => {
  const albums = buildAlbums([
    track({ album: 'Greatest Hits', artist: 'Harbour Sound', title: 'A', dir: 'Harbour' }),
    track({ album: 'Greatest Hits', artist: 'Harbour Sound', title: 'B', dir: 'Harbour' }),
    track({ album: 'Greatest Hits', artist: 'Maple Avenue', title: 'C', dir: 'Maple' }),
  ]);
  assert.equal(albums.length, 2, 'two albums that share a name stay apart');
  const byArtist = Object.fromEntries(albums.map((album) => [album.artist, album]));
  assert.deepEqual(titles(byArtist['Harbour Sound']), ['A', 'B']);
  assert.deepEqual(titles(byArtist['Maple Avenue']), ['C']);
});

test('an album artist and a folder-grouped album with the same name are different albums', () => {
  const albums = buildAlbums([
    track({ album: 'Greatest Hits', albumArtist: 'Harbour Sound', artist: 'Harbour Sound', dir: 'X' }),
    track({ album: 'Greatest Hits', artist: 'Harbour Sound', dir: 'X' }),
  ]);
  assert.equal(albums.length, 2);
});

test('a compilation is credited to "Various artists"', () => {
  const tagged = buildAlbums([
    track({ album: 'Summer Hits', albumArtist: 'Various Artists', artist: 'A', dir: 'S' }),
    track({ album: 'Summer Hits', albumArtist: 'Various Artists', artist: 'B', dir: 'S' }),
  ]);
  assert.equal(tagged[0].artist, VARIOUS_ARTISTS);
  const untagged = buildAlbums([
    track({ album: 'Mix', artist: 'A', dir: 'M' }),
    track({ album: 'Mix', artist: 'B', dir: 'M' }),
    track({ album: 'Mix', artist: 'C', dir: 'M' }),
  ]);
  assert.equal(untagged.length, 1, 'different artists in one folder are one album');
  assert.equal(untagged[0].artist, VARIOUS_ARTISTS, 'no artist covers half the songs');
});

test('without an album artist, the artist of at least half the songs wins, in its usual spelling', () => {
  const [album] = buildAlbums([
    track({ album: 'Live', artist: 'Maple Avenue', dir: 'L' }),
    track({ album: 'Live', artist: 'maple avenue', dir: 'L' }),
    track({ album: 'Live', artist: 'Maple Avenue', dir: 'L' }),
    track({ album: 'Live', artist: 'Guest', dir: 'L' }),
  ]);
  assert.equal(album.artist, 'Maple Avenue');
});

test('songs are ordered by disc, then track number, then file name', () => {
  const [album] = buildAlbums([
    track({ album: 'Deluxe', albumArtist: 'X', discNo: 2, trackNo: 1, title: 'd2t1' }),
    track({ album: 'Deluxe', albumArtist: 'X', discNo: 1, trackNo: 2, title: 'd1t2' }),
    track({ album: 'Deluxe', albumArtist: 'X', discNo: 1, trackNo: 1, title: 'd1t1' }),
    track({ album: 'Deluxe', albumArtist: 'X', discNo: 2, trackNo: 0, title: 'b10', path: 'C:\\M\\10 b.mp3' }),
    track({ album: 'Deluxe', albumArtist: 'X', discNo: 2, trackNo: 0, title: 'b9', path: 'C:\\M\\9 b.mp3' }),
  ]);
  assert.deepEqual(titles(album), ['d1t1', 'd1t2', 'b9', 'b10', 'd2t1']);
});

test('year, art, length and date added come from the songs', () => {
  const [album] = buildAlbums([
    track({ album: 'Y', albumArtist: 'X', trackNo: 1, year: 2019, art: null, duration: 60, mtime: 5 }),
    track({ album: 'Y', albumArtist: 'X', trackNo: 2, year: 2019, art: 'e-second.jpg', duration: 90, mtime: 9 }),
    track({ album: 'Y', albumArtist: 'X', trackNo: 3, year: 2020, art: 'e-third.jpg', duration: 30, mtime: 2 }),
    track({ album: 'Y', albumArtist: 'X', trackNo: 4, year: 0 }),
  ]);
  assert.equal(album.year, 2019);
  assert.equal(album.art, 'e-second.jpg', 'the first song in album order that has art');
  assert.equal(album.duration, 280);
  assert.equal(album.added, 9);
});

test('an album with one song is still an album, and missing fields are fine', () => {
  const albums = buildAlbums([{ id: 'x', path: 'C:\\a\\b.mp3', title: 'Only', artist: 'Solo', album: 'Single' }]);
  assert.equal(albums.length, 1);
  assert.equal(albums[0].artist, 'Solo');
  assert.equal(albums[0].year, 0);
  assert.equal(albums[0].art, null);
});

test('albumKey uses the album artist, else the folder', () => {
  assert.equal(albumKey({ album: 'Grace', albumArtist: 'Jeff Buckley', path: 'C:\\a\\x.mp3' }), 'grace|aa:jeff buckley');
  assert.equal(albumKey({ album: 'Grace', path: 'C:\\Music\\Albums\\x.mp3' }), 'grace|dir:c:\\music\\albums');
  assert.equal(albumKey({ album: '', path: 'x' }), null);
});

test('buildCatalog gives a lookup by key', () => {
  const catalog = buildCatalog([track({ album: 'K', albumArtist: 'X' })]);
  assert.equal(catalog.albumMap.get('k|aa:x').title, 'K');
});

test('sorts: year puts albums without a year last, recently added puts the newest first', () => {
  const albums = [
    { title: 'B', artist: 'Z', year: 0, added: 3 },
    { title: 'A', artist: 'Y', year: 2001, added: 1 },
    { title: 'C', artist: 'X', year: 2020, added: 2 },
  ];
  const order = (sort) => albums.slice().sort(ALBUM_SORTS[sort].compare).map((a) => a.title);
  assert.deepEqual(order('title'), ['A', 'B', 'C']);
  assert.deepEqual(order('artist'), ['C', 'A', 'B']);
  assert.deepEqual(order('year'), ['C', 'A', 'B']);
  assert.deepEqual(order('recent'), ['B', 'C', 'A']);
});

test('an "Artist - Album" folder is read from the folder name', () => {
  const roots = new Set([path.normalize('C:\\Music').toLowerCase()]);
  assert.deepEqual(albumFromFolder('C:\\Music\\Iris Vale - Paper Boats\\03 - Iris Vale - Origami.flac', roots), {
    albumArtist: 'Iris Vale',
    album: 'Paper Boats',
    trackNo: 3,
  });
  assert.equal(albumFromFolder('C:\\Music\\Iris Vale - Origami.mp3', roots), null, 'a file directly in a music folder');
  assert.equal(albumFromFolder('C:\\Music\\Iris Vale - Paper Boats\\Origami.mp3', roots), null, 'no track number');
  assert.equal(albumFromFolder('C:\\Music\\Albums\\01 - Iris Vale - Origami.mp3', roots), null, 'folder is not "A - B"');
});

// ---- artists ---------------------------------------------------------------

const artistsOf = (tracks) => {
  const { artists } = buildCatalog(tracks);
  return Object.fromEntries(artists.map((artist) => [artist.name, artist.tracks.map((t) => t.title)]));
};

test('a collaboration counts for each artist the library already knows', () => {
  const byName = artistsOf([
    track({ title: 'Solo A', artist: 'Northern Lights' }),
    track({ title: 'Solo B', artist: 'Maple Avenue' }),
    track({ title: 'Together', artist: 'Northern Lights & Maple Avenue' }),
    track({ title: 'Comma', artist: 'Maple Avenue, Northern Lights' }),
    track({ title: 'Cross', artist: 'Northern Lights x Maple Avenue' }),
  ]);
  assert.deepEqual(byName['Northern Lights'], ['Comma', 'Cross', 'Solo A', 'Together']);
  assert.deepEqual(byName['Maple Avenue'], ['Comma', 'Cross', 'Solo B', 'Together']);
  assert.equal(byName['Northern Lights & Maple Avenue'], undefined, 'the combined credit is not an artist of its own');
});

test('a name containing "&" or "," is not split when its parts are not artists', () => {
  const byName = artistsOf([
    track({ title: 'September', artist: 'Earth, Wind & Fire' }),
    track({ title: 'The Boxer', artist: 'Simon & Garfunkel' }),
    track({ title: 'Earfquake', artist: 'Tyler, The Creator' }),
  ]);
  assert.deepEqual(Object.keys(byName).sort(), ['Earth, Wind & Fire', 'Simon & Garfunkel', 'Tyler, The Creator']);
});

test('a "feat." credit goes to the main artist, and to the guest when the guest is known', () => {
  const byName = artistsOf([
    track({ title: 'Paper Moon', artist: 'Northern Lights feat. Iris Vale' }),
    track({ title: 'Guest Spot', artist: 'Northern Lights (ft. Unknown Singer)' }),
    track({ title: 'Lemonade', artist: 'Iris Vale' }),
    track({ title: 'Featuring', artist: 'Harbour Sound featuring Nobody Known' }),
  ]);
  assert.deepEqual(byName['Northern Lights'], ['Guest Spot', 'Paper Moon']);
  assert.deepEqual(byName['Iris Vale'], ['Lemonade', 'Paper Moon']);
  assert.deepEqual(byName['Harbour Sound'], ['Featuring']);
  assert.equal(byName['Unknown Singer'], undefined, 'an unknown guest does not become an artist');
  assert.equal(byName['Northern Lights feat. Iris Vale'], undefined);
});

test('words that merely contain "ft" or "x" are left alone', () => {
  const byName = artistsOf([track({ title: 'Get Lucky', artist: 'Daft Punk' }), track({ title: 'Xtal', artist: 'Max Exile' })]);
  assert.deepEqual(Object.keys(byName).sort(), ['Daft Punk', 'Max Exile']);
});

test('spellings merge, the most common wins, and songs without an artist belong to no one', () => {
  const byName = artistsOf([
    track({ title: 'A', artist: 'Beyoncé' }),
    track({ title: 'B', artist: 'Beyoncé' }),
    track({ title: 'C', artist: 'beyonce' }),
    track({ title: 'D', artist: '' }),
  ]);
  assert.deepEqual(byName, { 'Beyoncé': ['A', 'B', 'C'] });
});

test('an artist lists the albums credited to them, not compilations they appear on', () => {
  const { artistMap } = buildCatalog([
    track({ title: 'One', artist: 'Iris Vale', album: 'Night Garden', albumArtist: 'Iris Vale', year: 2017 }),
    track({ title: 'Two', artist: 'Iris Vale', album: 'Summer Hits', albumArtist: 'Various Artists' }),
    track({ title: 'Three', artist: 'Someone', album: 'Tribute', albumArtist: 'Iris Vale' }),
  ]);
  const iris = artistMap.get('iris vale');
  assert.deepEqual(iris.albums.map((album) => album.title).sort(), ['Night Garden', 'Tribute']);
  assert.deepEqual(iris.tracks.map((t) => t.title), ['One', 'Two'], 'songs are the ones credited to her');
  assert.equal(artistMap.get('various artists'), undefined, '"Various artists" is not an artist');
});

test('artist sorts: by name, or by most songs', () => {
  const artists = [
    { name: 'b', tracks: [1] },
    { name: 'A', tracks: [1, 2] },
    { name: 'c', tracks: [1, 2] },
  ];
  assert.deepEqual(artists.slice().sort(ARTIST_SORTS.name.compare).map((a) => a.name), ['A', 'b', 'c']);
  assert.deepEqual(artists.slice().sort(ARTIST_SORTS.songs.compare).map((a) => a.name), ['A', 'c', 'b']);
});
