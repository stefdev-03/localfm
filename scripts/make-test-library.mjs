// Builds a small folder of silent MP3s (and a few test pictures) for trying the
// app without touching a real music collection:  npm run make-test-library
//
// The files cover the naming cases the scanner has to cope with: "Artist -
// Title" names, upload noise such as "(Official Video)", track-number
// prefixes, ID3 tags that disagree with the file name, embedded cover art,
// subfolders, and names with no artist at all.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.resolve(process.argv[2] ?? path.join(root, 'test-library'));

// --- a silent MPEG-1 Layer III stream (128 kbps, 44.1 kHz) -------------------
const FRAME_BYTES = 417;
const FRAME_SECONDS = 1152 / 44100;

function silentMp3(seconds) {
  const frame = Buffer.alloc(FRAME_BYTES);
  frame.set([0xff, 0xfb, 0x90, 0x00]);
  return Buffer.concat(Array.from({ length: Math.ceil(seconds / FRAME_SECONDS) }, () => frame));
}

// --- minimal PNG encoder -----------------------------------------------------
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
// pixel(x, y) -> [r, g, b]
function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) raw.set(pixel(x, y), row + 1 + x * 3);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const rings = (cx, cy, a, b) => (x, y) => {
  const t = (Math.sin(Math.hypot(x - cx, y - cy) / 22) + 1) / 2;
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
};

// --- ID3v2.3 tag -------------------------------------------------------------
function id3Frame(id, data) {
  const head = Buffer.alloc(10);
  head.write(id, 0, 'ascii');
  head.writeUInt32BE(data.length, 4);
  return Buffer.concat([head, data]);
}
const textFrame = (id, text) =>
  id3Frame(id, Buffer.concat([Buffer.from([0x01, 0xff, 0xfe]), Buffer.from(text, 'utf16le')]));
const pictureFrame = (pngBytes) =>
  id3Frame('APIC', Buffer.concat([Buffer.from([0x00]), Buffer.from('image/png\0', 'latin1'), Buffer.from([0x03, 0x00]), pngBytes]));

function id3({ title, artist, album, albumArtist, year, track, disc, picture } = {}) {
  const frames = [];
  if (title) frames.push(textFrame('TIT2', title));
  if (artist) frames.push(textFrame('TPE1', artist));
  if (album) frames.push(textFrame('TALB', album));
  if (albumArtist) frames.push(textFrame('TPE2', albumArtist));
  if (year) frames.push(textFrame('TYER', String(year)));
  if (track) frames.push(textFrame('TRCK', String(track)));
  if (disc) frames.push(textFrame('TPOS', String(disc)));
  if (picture) frames.push(pictureFrame(picture));
  if (!frames.length) return Buffer.alloc(0);
  const body = Buffer.concat(frames);
  const head = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0, 0, 0, 0]);
  for (let i = 0; i < 4; i++) head[9 - i] = (body.length >> (7 * i)) & 0x7f; // sync-safe size
  return Buffer.concat([head, body]);
}

// --- the library -------------------------------------------------------------
const embedded = png(360, 360, rings(120, 250, [255, 180, 84], [40, 28, 60]));

const songs = [
  { file: 'Daft Punk - Get Lucky.mp3', seconds: 9 },
  { file: 'Queen - Bohemian Rhapsody (Official Video).mp3', seconds: 12 },
  { file: 'Nirvana - Smells Like Teen Spirit [Official Music Video].mp3', seconds: 8 },
  { file: 'Michael Jackson - Billie Jean.mp3', seconds: 7 },
  { file: 'a-ha - Take On Me (Official Video) [djV11Xbc914].mp3', seconds: 10 },
  { file: 'Fleetwood Mac – Dreams.mp3', seconds: 6 },
  { file: '50 Cent - In Da Club.mp3', seconds: 8 },
  { file: 'Toto_-_Africa.mp3', seconds: 9 },
  { file: 'Albums/01 - The Beatles - Come Together.mp3', seconds: 7 },
  { file: 'Albums/02. Radiohead - Karma Police.mp3', seconds: 11 },
  { file: 'Albums/track07.mp3', seconds: 6, tags: { title: 'Hallelujah', artist: 'Jeff Buckley', album: 'Grace' } },
  {
    file: 'Home Recordings/Garage Demo.mp3',
    seconds: 5,
    tags: { title: 'Sunday Riff', artist: 'The Test Tones', album: 'Garage Tapes', picture: embedded },
  },
  { file: 'Home Recordings/Zzyzx Road Sketch - Made Up Band Nobody Knows.mp3', seconds: 5 },
  { file: 'Untitled recording.mp3', seconds: 4 },
  ...albums(),
];

// Made-up albums for the albums page: album artists, years and track numbers,
// some with covers, a compilation, a collaboration, two albums that share a
// name, one on two discs, and one laid out as "Artist - Album/01 - Artist - Title".
function albums() {
  const polar = png(360, 360, rings(180, 120, [96, 205, 255], [12, 30, 60]));
  const crossing = png(360, 360, rings(60, 300, [255, 143, 163], [40, 16, 30]));
  const album = (folder, info, tracks) =>
    tracks.map(([title, extra = {}], i) => ({
      file: `Collection/${folder}/${title}.mp3`,
      seconds: 4 + ((i * 3) % 5),
      tags: { title, album: info.album, albumArtist: info.albumArtist, artist: info.artist ?? info.albumArtist, year: info.year, picture: info.picture, track: i + 1, ...extra },
    }));
  return [
    // File names deliberately out of track order: the album page must follow the numbers.
    ...album('Polar Nights', { album: 'Polar Nights', albumArtist: 'Northern Lights', year: 2019, picture: polar }, [
      ['Zero Hour'],
      ['Aurora'],
      ['Midnight Sun'],
    ]),
    ...album('Low Tide', { album: 'Low Tide', albumArtist: 'Harbour Sound', year: 2015 }, [['Breakwater'], ['Salt Air']]),
    ...album('First Light', { album: 'First Light', albumArtist: 'Maple Avenue', year: 2021 }, [['Porch Song'], ['Early Bus']]),
    ...album('Summer Hits 2020', { album: 'Summer Hits 2020', albumArtist: 'Various Artists', year: 2020 }, [
      ['Heatwave', { artist: 'Harbour Sound' }],
      ['Lemonade', { artist: 'Iris Vale' }],
      ['Long Drive', { artist: 'Maple Avenue' }],
    ]),
    // Same album name, different artists, no album artist: two albums.
    ...album('Harbour Sound Greatest Hits', { album: 'Greatest Hits', artist: 'Harbour Sound', year: 2022 }, [['Lighthouse'], ['Undertow']]),
    ...album('Maple Avenue Greatest Hits', { album: 'Greatest Hits', artist: 'Maple Avenue' }, [['Streetlights'], ['Corner Shop']]),
    ...album('Crossings', { album: 'Crossings', albumArtist: 'Northern Lights', year: 2023, picture: crossing }, [
      ['Crossing', { artist: 'Northern Lights & Maple Avenue' }],
      ['Paper Moon', { artist: 'Northern Lights feat. Iris Vale' }],
    ]),
    ...album('Deluxe', { album: 'Night Garden (Deluxe)', albumArtist: 'Iris Vale', year: 2017 }, [
      ['Moth', { disc: 2, track: 2 }],
      ['Fern', { disc: 1, track: 2 }],
      ['Dew', { disc: 2, track: 1 }],
      ['Bloom', { disc: 1, track: 1 }],
    ]),
    // No tags at all, as many downloaded files are: the folder names the album.
    { file: 'Collection/Iris Vale - Paper Boats/01 - Iris Vale - Paper Boats.mp3', seconds: 5 },
    { file: 'Collection/Iris Vale - Paper Boats/02 - Iris Vale - Origami.mp3', seconds: 6 },
  ];
}

fs.rmSync(outDir, { recursive: true, force: true });
for (const song of songs) {
  const target = path.join(outDir, song.file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.concat([id3(song.tags), silentMp3(song.seconds)]));
}
// A cover kept beside the songs rather than inside them.
fs.writeFileSync(path.join(outDir, 'Collection/Low Tide/cover.png'), png(300, 300, rings(150, 200, [108, 203, 95], [10, 34, 40])));
// Not music: the scanner must ignore these.
fs.writeFileSync(path.join(outDir, 'notes.txt'), 'not a song');

// Pictures for trying the crop step: larger than the targets, exactly the
// size of one, and (for profile pictures, which are never enlarged) too small.
const pictures = path.join(outDir, '_pictures');
fs.mkdirSync(pictures, { recursive: true });
fs.writeFileSync(path.join(pictures, 'large-photo.png'), png(1600, 1200, rings(500, 400, [96, 205, 255], [20, 24, 60])));
fs.writeFileSync(path.join(pictures, 'wide-photo.png'), png(3200, 1400, rings(2100, 500, [255, 143, 163], [30, 20, 40])));
fs.writeFileSync(path.join(pictures, 'exact-square.png'), png(640, 640, rings(320, 320, [108, 203, 95], [16, 40, 30])));
fs.writeFileSync(path.join(pictures, 'exact-avatar.png'), png(320, 320, rings(160, 160, [180, 160, 255], [30, 22, 60])));
fs.writeFileSync(path.join(pictures, 'small-photo.png'), png(300, 240, rings(150, 120, [255, 180, 84], [50, 30, 20])));
fs.writeFileSync(path.join(pictures, 'tall-strip.png'), png(320, 900, rings(160, 300, [79, 216, 196], [14, 40, 44])));

console.log(`Wrote ${songs.length} songs and 6 pictures to ${outDir}`);
