// Browsing by album and by artist against the real app:  npm run test:library
//
// Uses a copy of the practice library (so songs can be deleted mid-test) and
// a profile that has already finished setup. Covers the "All albums" and
// "Artists" rows in the sidebar, both grids, search and sort, an album's
// page, an artist's page and its tabs, going back, cover art that arrives
// late, and artist pictures. Screenshots in both themes at three window sizes
// land in tests/e2e/output/library.
//
// No request leaves this computer: the app's Deezer and iTunes requests are
// sent to a small stand-in server started here.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { library, pictures, ensureTestLibrary, tempDir, removeDir, outputDir, launch, t, text, eventually, playLabelBecomes, reporter } from './harness.mjs';

ensureTestLibrary();
const outDir = outputDir('library');
const dataDir = tempDir('localfm-library-');
const music = tempDir('localfm-library-music-');
const { check, crash, finish } = reporter();
const shot = (page, name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });
const PROFILE = 'e'.repeat(16);
const ALBUM_COUNT = 11;
const SIZES = [
  [940, 620],
  [1280, 820],
  [1900, 1030],
];

// ---- a stand-in for Deezer and iTunes --------------------------------------

const artistSearches = []; // the names the app searched for, in order
const otherRequests = [];
let base = '';
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const json = (body) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
  };
  if (url.pathname === '/search/artist') {
    const q = url.searchParams.get('q') ?? '';
    artistSearches.push(q);
    const answers = {
      // A near match comes first: only the exact name may be taken.
      'Northern Lights': [
        { name: 'Northern Light', picture_big: `${base}/pic/wrong.png` },
        { name: 'Northern Lights', picture_big: `${base}/pic/northern.png` },
      ],
      // Larger than the 600px the cache keeps.
      'Harbour Sound': [{ name: 'Harbour Sound', picture_big: `${base}/pic/large.png` }],
      // Deezer's grey silhouette for an artist it has no picture of.
      'Iris Vale': [{ name: 'Iris Vale', picture_big: `${base}/images/artist//500x500-000000-80-0-0.jpg` }],
      'Maple Avenue': [{ name: 'Maple Avenue Band', picture_big: `${base}/pic/wrong.png` }],
    };
    return json({ data: answers[q] ?? [], total: (answers[q] ?? []).length });
  }
  otherRequests.push(url.pathname);
  if (url.pathname.startsWith('/pic/')) {
    const file = url.pathname === '/pic/large.png' ? 'large-photo.png' : 'exact-avatar.png';
    response.writeHead(200, { 'Content-Type': 'image/png' });
    return response.end(fs.readFileSync(path.join(pictures, file)));
  }
  // Cover searches (Deezer's and iTunes') find nothing.
  return json({ data: [], results: [] });
});

// Sends the app's Deezer and iTunes requests to the stand-in.
const redirectLookups = (app) =>
  app.evaluate(({ net }, target) => {
    globalThis.__realFetch ??= net.fetch.bind(net);
    net.fetch = (input, init) =>
      globalThis.__realFetch(String(input).replace('https://api.deezer.com', target).replace('https://itunes.apple.com', target), init);
  }, base);

function seed() {
  fs.cpSync(library, music, { recursive: true, filter: (src) => !src.includes('_pictures') });
  fs.writeFileSync(
    path.join(dataDir, 'data.json'),
    JSON.stringify({
      version: 1,
      activeProfileId: PROFILE,
      settings: { onlineArt: false },
      profiles: [
        {
          id: PROFILE,
          name: 'Robin',
          color: '#6ccb5f',
          picture: null,
          setupComplete: true,
          folders: [music],
          playlists: [],
          player: { volume: 0.8, shuffle: false, repeat: 'off' },
          createdAt: 1,
        },
      ],
    }),
  );
}

const setSize = (app, width, height) =>
  app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [width, height]);
const setTheme = (page, theme) =>
  page.evaluate((value) => {
    if (value === 'light') document.documentElement.dataset.theme = 'light';
    else delete document.documentElement.dataset.theme;
  }, theme);
const tile = (page, name) => page.locator('.album-tile', { has: page.locator('.album-title', { hasText: new RegExp(`^${name.replace(/[()]/g, '\\$&')}$`) }) });
const tileNames = (page) => page.locator('.album-title').allInnerTexts();
const rowTitles = (page) => page.locator('.song-row .song-title').allInnerTexts();
const numbers = (page) => page.locator(t('track-number')).allInnerTexts();
const playing = (page) => text(page, '.pb-title');
const heading = (page) => page.locator('.view h1').first().innerText();

// Rows in the grid: the distinct top edges of the tiles, and how many per row.
const gridRows = (page) =>
  page.evaluate(() => {
    const rows = new Map();
    for (const el of document.querySelectorAll('.album-tile')) {
      const top = Math.round(el.getBoundingClientRect().top);
      rows.set(top, (rows.get(top) ?? 0) + 1);
    }
    return [...rows.values()];
  });

async function openAlbum(page, name) {
  await tile(page, name).locator(t('album-tile')).click();
  await page.waitForSelector('.detail-hero');
}

async function run() {
  seed();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const { app, page, errors } = await launch(dataDir, music);
  await redirectLookups(app);
  await page.waitForSelector(t('nav-albums'));
  await eventually(page, () => !document.querySelector('.scan-status'), null, 20000);
  await setSize(app, 1280, 820);

  console.log('Sidebar');
  const navOrder = await page.locator('.sidebar-nav > .nav-item').allInnerTexts();
  check('the top of the sidebar reads All songs, All albums, Artists', navOrder.slice(0, 3).join('|') === 'All songs|All albums|Artists', navOrder.join('|'));
  check('it has the disc icon', (await page.locator(`${t('nav-albums')} svg`).count()) === 1);
  check('the top rows keep their 36px height', Math.round((await page.locator(t('nav-albums')).boundingBox()).height) === 36);

  console.log('The grid');
  await page.click(t('nav-albums'));
  await page.waitForSelector('.album-grid');
  check('"All albums" is marked as the current page', (await page.getAttribute(t('nav-albums'), 'aria-current')) === 'page');
  check('the heading reads "All albums"', (await heading(page)) === 'All albums');
  check('the facts line counts the albums', (await text(page, t('albums-count'))) === `${ALBUM_COUNT} albums`, await text(page, t('albums-count')));
  check('there is no "Play all" on the grid', (await page.locator('.view .btn-accent').count()) === 0);

  console.log('Grouping');
  const names = await tileNames(page);
  check(`every album has one tile (${ALBUM_COUNT})`, names.length === ALBUM_COUNT, names.join(', '));
  check('loose songs without an album are not albums', !names.includes('') && !names.some((name) => /Get Lucky|Bohemian/.test(name)));
  check('two albums called "Greatest Hits" stay apart', names.filter((name) => name === 'Greatest Hits').length === 2);
  check('the album in a download folder is found from the folder name', names.includes('Paper Boats'));
  check('titles are sorted A to Z', names.join('|') === [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })).join('|'), names.join('|'));
  const detail = async (name) => (await tile(page, name).locator('.album-detail').first().innerText()).trim();
  check('the second line is "Artist · Year"', (await detail('Polar Nights')) === 'Northern Lights · 2019', await detail('Polar Nights'));
  check('a compilation reads "Various artists"', (await detail('Summer Hits 2020')) === 'Various artists · 2020', await detail('Summer Hits 2020'));
  check('no dot when an album has no year', (await tile(page, 'Greatest Hits').locator('.album-detail').allInnerTexts()).includes('Maple Avenue'));
  check('the download-folder album is credited to its artist', (await detail('Paper Boats')) === 'Iris Vale');
  check(
    'each tile is one button named "Album by Artist"',
    (await tile(page, 'Polar Nights').locator(t('album-tile')).getAttribute('aria-label')) === 'Polar Nights by Northern Lights',
  );
  check('a cover inside the files is shown', (await tile(page, 'Polar Nights').locator('.album-cover img').count()) === 1);
  check('a cover beside the files is shown', (await tile(page, 'Low Tide').locator('.album-cover img').count()) === 1);
  check('an album without art gets a tinted tile with a disc', (await tile(page, 'First Light').locator('.album-cover.is-tinted svg').count()) === 1);
  check('pictures load lazily', (await page.locator('.album-cover img').first().getAttribute('loading')) === 'lazy');

  console.log('Tile look');
  const firstTile = tile(page, 'Polar Nights');
  const coverBox = await firstTile.locator('.album-cover').boundingBox();
  check('covers are square', Math.abs(coverBox.width - coverBox.height) < 1, `${coverBox.width}×${coverBox.height}`);
  check('covers have a 6px radius', (await firstTile.locator('.album-cover').evaluate((el) => getComputedStyle(el).borderRadius)) === '6px');
  check('covers have a 1px inner line', (await firstTile.locator('.album-cover').evaluate((el) => getComputedStyle(el, '::after').boxShadow)).includes('inset'));
  check('the name is 14px / 600, the detail 13px', (await firstTile.locator('.album-title').evaluate((el) => `${getComputedStyle(el).fontSize}/${getComputedStyle(el).fontWeight}`)) === '14px/600' && (await firstTile.locator('.album-detail').evaluate((el) => getComputedStyle(el).fontSize)) === '13px');
  const playButton = firstTile.locator(t('album-play'));
  check('the play button is hidden until hover', (await playButton.evaluate((el) => getComputedStyle(el).opacity)) === '0');
  await firstTile.hover();
  check('hovering shows it', await eventually(page, () => [...document.querySelectorAll('[data-test="album-play"]')].some((el) => getComputedStyle(el).opacity === '1')));
  const playBox = await playButton.boundingBox();
  check('it is a 36px circle at the bottom right of the cover', Math.round(playBox.width) === 36 && Math.abs(playBox.x + playBox.width - (coverBox.x + coverBox.width - 8)) <= 1 && Math.abs(playBox.y + playBox.height - (coverBox.y + coverBox.height - 8)) <= 1, JSON.stringify({ playBox, coverBox }));
  check('the cover does not move on hover', JSON.stringify(await firstTile.locator('.album-cover').boundingBox()) === JSON.stringify(coverBox));
  await shot(page, 'grid-hover-dark');
  await page.mouse.move(5, 500);

  console.log('Grid at three window sizes, both themes');
  for (const [width, height] of SIZES) {
    await setSize(app, width, height);
    await page.waitForTimeout(250);
    const rows = await gridRows(page);
    check(`at ${width}×${height} the grid is five across`, rows[0] === 5 && rows[1] === 5 && rows[2] === 1, rows.join(','));
    const gridWidth = await page.locator('.album-grid').evaluate((el) => el.getBoundingClientRect().width);
    check(`at ${width}×${height} the grid is at most 1500px plus its padding`, gridWidth <= 1556.5, `${gridWidth}px`);
    const sortRight = (await page.locator(t('albums-sort')).boundingBox()).x + (await page.locator(t('albums-sort')).boundingBox()).width;
    const lastInRow = await page.locator('.album-tile').nth(4).boundingBox();
    check(`at ${width}×${height} the sort box lines up with the grid's right edge`, Math.abs(sortRight - (lastInRow.x + lastInRow.width)) <= 1, `${sortRight} vs ${lastInRow.x + lastInRow.width}`);
    const overflow = await page.locator('.view-scroller').evaluate((el) => el.scrollWidth > el.clientWidth);
    check(`at ${width}×${height} nothing scrolls sideways`, !overflow);
    for (const theme of ['dark', 'light']) {
      await setTheme(page, theme);
      await page.waitForTimeout(150);
      await shot(page, `albums-${width}x${height}-${theme}`);
    }
    await setTheme(page, 'dark');
  }
  await setSize(app, 1280, 820);

  console.log('Search and sort');
  await page.keyboard.press('Control+f');
  check('Ctrl+F focuses the album search', await page.evaluate(() => document.activeElement?.dataset.test === 'albums-search'));
  await page.keyboard.type('maple');
  check('search matches album names and artists', await eventually(page, () => document.querySelectorAll('.album-tile').length === 2));
  check('the count reads "2 of 11 albums"', (await text(page, t('albums-count'))) === `2 of ${ALBUM_COUNT} albums`, await text(page, t('albums-count')));
  await page.fill(t('albums-search'), 'paper');
  check('search matches album names', (await tileNames(page)).join('|') === 'Paper Boats');
  await page.fill(t('albums-search'), 'zzzz');
  check('no match says so', await eventually(page, () => document.querySelector('.empty h2')?.textContent === 'No matches'));
  await page.fill(t('albums-search'), '');
  await page.selectOption(t('albums-sort'), 'year');
  const byYear = await tileNames(page);
  check('Year sorts newest first', byYear[0] === 'Crossings' && byYear[1] === 'Greatest Hits', byYear.slice(0, 3).join('|'));
  check('albums without a year go last', ['Garage Tapes', 'Grace', 'Paper Boats'].every((name) => byYear.indexOf(name) >= ALBUM_COUNT - 4), byYear.join('|'));
  await page.selectOption(t('albums-sort'), 'artist');
  const byArtist = await page.locator('.album-detail').allInnerTexts();
  check('Artist sorts by artist', byArtist[0].startsWith('Harbour Sound') && byArtist.at(-1).startsWith('Various artists'), byArtist.join('|'));
  await page.selectOption(t('albums-sort'), 'recent');
  check('Recently added is offered', (await page.locator('.album-tile').count()) === ALBUM_COUNT);
  await page.selectOption(t('albums-sort'), 'title');

  console.log('An album page');
  await openAlbum(page, 'Polar Nights');
  check('the heading is the album name', (await heading(page)) === 'Polar Nights');
  check('the small label says "Album"', (await text(page, '.detail-hero .eyebrow')) === 'Album');
  check('the facts are artist, year, songs and length', /^Northern Lights · 2019 · 3 songs · /.test(await text(page, t('album-facts'))), await text(page, t('album-facts')));
  check('"All albums" stays marked in the sidebar', (await page.getAttribute(t('nav-albums'), 'aria-current')) === 'page');
  check('the back button names the page it returns to', (await text(page, t('back'))) === 'All albums');
  const pageCover = await page.locator('.detail-cover').boundingBox();
  check('the cover is 200px', Math.round(pageCover.width) === 200 && Math.round(pageCover.height) === 200);
  check('songs follow the track numbers, not the file names', (await rowTitles(page)).join('|') === 'Zero Hour|Aurora|Midnight Sun', (await rowTitles(page)).join('|'));
  check('each row shows its track number instead of a cover', (await numbers(page)).join(',') === '1,2,3' && (await page.locator('.song-row .cover').count()) === 0);
  check('there is no Album column', (await page.locator('.song-row .song-album').count()) === 0 && !(await page.locator('.list-head').innerText()).includes('Album'));
  check('each row keeps its +', (await page.locator(`.song-row ${t('song-action')}`).count()) === 3);
  await page.locator('.song-row').first().hover();
  check('hovering a row shows play in place of the number', await eventually(page, () => getComputedStyle(document.querySelector('.song-number')).opacity === '0' && getComputedStyle(document.querySelector('.song-play-icon')).opacity === '1'));

  await page.mouse.move(5, 500);
  await page.keyboard.press('Space');
  check('Space with nothing playing starts the album', await eventually(page, () => document.querySelector('.pb-title')?.textContent === 'Zero Hour'), await playing(page));
  await page.click(t('next'));
  check('it plays in album order', await eventually(page, () => document.querySelector('.pb-title')?.textContent === 'Aurora'), await playing(page));
  check('the playing song is marked', (await page.locator('.song-row.is-current .song-title').innerText()) === 'Aurora');
  await page.locator('.song-row').nth(2).click({ button: 'right' });
  const menu = await page.locator('.menu').innerText();
  check('right-click offers the usual menu', menu.includes('Play') && menu.includes('Show in folder') && menu.includes('Add to playlist'), menu);
  await page.keyboard.press('Escape');
  for (const theme of ['dark', 'light']) {
    await setTheme(page, theme);
    await page.waitForTimeout(150);
    await shot(page, `album-page-${theme}`);
  }
  await setTheme(page, 'dark');
  await page.click(t('play-pause'));
  await page.click(t('album-page-play'));
  check('Play starts from the first song', await eventually(page, () => document.querySelector('.pb-title')?.textContent === 'Zero Hour'));
  await page.click(t('play-pause'));
  await playLabelBecomes(page, 'Play');

  console.log('Back');
  await page.click(t('back'));
  await page.waitForSelector('.album-grid');
  check('the back button returns to the grid', (await heading(page)) === 'All albums');
  await setSize(app, 940, 620);
  await page.waitForTimeout(200);
  await page.locator('.view-scroller').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.waitForTimeout(150);
  const scrolled = await page.locator('.view-scroller').evaluate((el) => el.scrollTop);
  check('the grid scrolls at 940×620', scrolled > 0);
  await page.fill(t('albums-search'), 'i');
  const filteredCount = await page.locator('.album-tile').count();
  await page.fill(t('albums-search'), '');
  await page.locator('.view-scroller').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.waitForTimeout(150);
  const before = await page.locator('.view-scroller').evaluate((el) => el.scrollTop);
  await openAlbum(page, 'Polar Nights');
  await page.keyboard.press('Alt+ArrowLeft');
  await page.waitForSelector('.album-grid');
  check('Alt+Left goes back', (await heading(page)) === 'All albums');
  check('and lands at the same scroll position', Math.abs((await page.locator('.view-scroller').evaluate((el) => el.scrollTop)) - before) <= 1, `${before}`);
  await page.fill(t('albums-search'), 'i');
  await openAlbum(page, (await tileNames(page))[0]);
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { button: 3, bubbles: true })));
  check('the mouse back button goes back', await eventually(page, () => document.querySelector('.view h1')?.textContent === 'All albums'));
  check('the search text is remembered', (await page.inputValue(t('albums-search'))) === 'i' && (await page.locator('.album-tile').count()) === filteredCount);
  await page.fill(t('albums-search'), '');
  await page.click(t('nav-songs'));
  await page.click(t('nav-albums'));
  check('leaving and coming back keeps the sort', (await page.inputValue(t('albums-sort'))) === 'title');
  await page.locator('.view-scroller').evaluate((el) => (el.scrollTop = 0));
  await setSize(app, 1280, 820);

  console.log('Other albums');
  await openAlbum(page, 'Night Garden (Deluxe)');
  check('a two-disc album plays disc 1, then disc 2', (await rowTitles(page)).join('|') === 'Bloom|Fern|Dew|Moth', (await rowTitles(page)).join('|'));
  await page.keyboard.press('Alt+ArrowLeft');
  await page.waitForSelector('.album-grid');
  await openAlbum(page, 'Paper Boats');
  check('the download-folder album numbers its songs from the file names', (await numbers(page)).join(',') === '1,2' && (await rowTitles(page)).join('|') === 'Paper Boats|Origami', (await rowTitles(page)).join('|'));
  await page.keyboard.press('Alt+ArrowLeft');
  await page.waitForSelector('.album-grid');
  await openAlbum(page, 'Summer Hits 2020');
  check('a compilation lists each song’s own artist', (await page.locator('.song-row .song-artist').allInnerTexts()).join('|') === 'Harbour Sound|Iris Vale|Maple Avenue');
  await page.keyboard.press('Alt+ArrowLeft');
  await page.waitForSelector('.album-grid');

  console.log('Playing from a tile');
  await tile(page, 'Low Tide').hover();
  await tile(page, 'Low Tide').locator(t('album-play')).click();
  check('the tile’s play button plays the album without opening it', await eventually(page, () => document.querySelector('.pb-title')?.textContent === 'Breakwater') && (await heading(page)) === 'All albums');
  await page.click(t('play-pause'));

  // ---- artists ---------------------------------------------------------------
  const artistTile = (name) => page.locator('.artist-tile', { has: page.locator('.artist-name', { hasText: new RegExp(`^${name}$`) }) });
  const artistNames = () => page.locator('.artist-name').allInnerTexts();
  const openArtist = async (name) => {
    await artistTile(name).locator(t('artist-tile')).click();
    await page.waitForSelector('.detail-hero .detail-artist-pic');
  };
  const selectedTab = () => page.locator('[role="tab"][aria-selected="true"]').innerText();

  console.log('Artists grid');
  await page.click(t('nav-artists'));
  await page.waitForSelector('.artist-grid');
  check('"Artists" is marked as the current page', (await page.getAttribute(t('nav-artists'), 'aria-current')) === 'page');
  check('it has the microphone icon', (await page.locator(`${t('nav-artists')} svg`).count()) === 1);
  check('the heading reads "Artists"', (await heading(page)) === 'Artists');
  const ARTIST_COUNT = 17;
  check('the facts line counts the artists', (await text(page, t('artists-count'))) === `${ARTIST_COUNT} artists`, await text(page, t('artists-count')));
  const allArtists = await artistNames();
  check('a collaboration lists each artist, not the pair', allArtists.includes('Northern Lights') && allArtists.includes('Maple Avenue') && !allArtists.some((name) => name.includes('&')), allArtists.join('|'));
  check('a "feat." credit is not an artist of its own', !allArtists.some((name) => /feat/i.test(name)));
  check('"Various artists" is not an artist', !allArtists.includes('Various artists'));
  const countOf = async (name) => (await artistTile(name).locator('.artist-count').innerText()).trim();
  check('a collaboration counts for both artists', (await countOf('Northern Lights')) === '5 songs' && (await countOf('Maple Avenue')) === '6 songs', `${await countOf('Northern Lights')} / ${await countOf('Maple Avenue')}`);
  check('a guest credited with "feat." gets the song too', (await countOf('Iris Vale')) === '8 songs', await countOf('Iris Vale'));
  check('names are sorted A to Z', allArtists[0] === '50 Cent' && allArtists.at(-1) === 'Zzyzx Road Sketch', allArtists.join('|'));
  const picBox = await artistTile('Northern Lights').locator('.artist-pic').boundingBox();
  check('pictures are circles', Math.abs(picBox.width - picBox.height) < 1 && (await artistTile('Northern Lights').locator('.artist-pic').evaluate((el) => getComputedStyle(el).borderRadius)) === '50%');
  check('without a picture, the initial shows', (await artistTile('Northern Lights').locator('.artist-initial').innerText()) === 'N');
  const initialSize = await artistTile('Northern Lights').locator('.artist-initial').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  check('the initial is sized to the circle', Math.abs(initialSize - picBox.width * 0.38) < 1.5, `${initialSize}px for ${picBox.width}px`);
  check('the name is centred under the circle', (await artistTile('Northern Lights').locator('.artist-open').evaluate((el) => getComputedStyle(el).textAlign)) === 'center');
  check('the name is 14px / 600, the count 13px', (await artistTile('Iris Vale').locator('.artist-name').evaluate((el) => `${getComputedStyle(el).fontSize}/${getComputedStyle(el).fontWeight}`)) === '14px/600' && (await artistTile('Iris Vale').locator('.artist-count').evaluate((el) => getComputedStyle(el).fontSize)) === '13px');
  await page.waitForTimeout(800);
  check('with cover art lookups off, no request is made', artistSearches.length === 0 && otherRequests.length === 0, `${artistSearches.join(',')} ${otherRequests.join(',')}`);

  await artistTile('Harbour Sound').hover();
  check('hovering shows a play button', await eventually(page, () => [...document.querySelectorAll('[data-test="artist-play"]')].some((el) => getComputedStyle(el).opacity === '1')));
  const artistPlay = await artistTile('Harbour Sound').locator(t('artist-play')).boundingBox();
  const harbourPic = await artistTile('Harbour Sound').locator('.artist-pic').boundingBox();
  check('it sits at the bottom right of the circle’s square', Math.abs(artistPlay.x + artistPlay.width - (harbourPic.x + harbourPic.width - 8)) <= 1 && Math.abs(artistPlay.y + artistPlay.height - (harbourPic.y + harbourPic.height - 8)) <= 1);
  await artistTile('Harbour Sound').locator(t('artist-play')).click();
  check('it plays all the artist’s songs', await eventually(page, () => document.querySelector('.pb-title')?.textContent === 'Breakwater') && (await heading(page)) === 'Artists');
  await page.click(t('play-pause'));
  await page.mouse.move(5, 500);

  for (const [width, height] of SIZES) {
    await setSize(app, width, height);
    await page.waitForTimeout(250);
    const rows = await page.evaluate(() => {
      const tops = new Map();
      for (const el of document.querySelectorAll('.artist-tile')) {
        const top = Math.round(el.getBoundingClientRect().top);
        tops.set(top, (tops.get(top) ?? 0) + 1);
      }
      return [...tops.values()];
    });
    check(`at ${width}×${height} the artist grid is five across`, rows[0] === 5 && rows[1] === 5, rows.join(','));
    for (const theme of ['dark', 'light']) {
      await setTheme(page, theme);
      await page.waitForTimeout(150);
      await shot(page, `artists-${width}x${height}-${theme}`);
    }
    await setTheme(page, 'dark');
  }
  await setSize(app, 1280, 820);

  await page.keyboard.press('Control+f');
  check('Ctrl+F focuses the artist search', await page.evaluate(() => document.activeElement?.dataset.test === 'artists-search'));
  await page.keyboard.type('vale');
  check('search finds artists by name', await eventually(page, () => document.querySelectorAll('.artist-tile').length === 1) && (await text(page, t('artists-count'))) === `1 of ${ARTIST_COUNT} artists`);
  await page.fill(t('artists-search'), '');
  await page.selectOption(t('artists-sort'), 'songs');
  const bySongs = await artistNames();
  check('"Most songs" puts the busiest artists first', bySongs.slice(0, 2).join('|') === 'Iris Vale|Maple Avenue', bySongs.slice(0, 3).join('|'));
  await page.selectOption(t('artists-sort'), 'name');

  console.log('An artist page');
  await openArtist('Northern Lights');
  check('the heading is the artist’s name', (await heading(page)) === 'Northern Lights');
  check('the small label says "Artist"', (await text(page, '.detail-hero .eyebrow')) === 'Artist');
  check('the facts count songs and albums', (await text(page, t('artist-facts'))) === '5 songs · 2 albums', await text(page, t('artist-facts')));
  check('the back button says "Artists"', (await text(page, t('back'))) === 'Artists');
  check('"Artists" stays marked in the sidebar', (await page.getAttribute(t('nav-artists'), 'aria-current')) === 'page');
  const bigPic = await page.locator('.detail-artist-pic').boundingBox();
  check('the picture is a 168px circle', Math.round(bigPic.width) === 168 && Math.round(bigPic.height) === 168);
  check('there are two tabs in a tablist', (await page.locator('[role="tablist"] [role="tab"]').allInnerTexts()).join('|') === 'Songs|Albums');
  check('Songs is selected first', (await selectedTab()) === 'Songs');
  check('Songs lists every song credited to the artist, by title', (await rowTitles(page)).join('|') === 'Aurora|Crossing|Midnight Sun|Paper Moon|Zero Hour', (await rowTitles(page)).join('|'));
  check('the song list has the usual columns', (await page.locator('.song-row .cover').count()) === 5 && (await page.locator('.song-row .song-album').count()) === 5 && (await page.locator(`.song-row ${t('song-action')}`).count()) === 5);
  const underline = await page.locator('[role="tab"][aria-selected="true"]').evaluate((el) => getComputedStyle(el, '::after').height);
  check('the selected tab has a 2px underline', underline === '2px', underline);
  for (const theme of ['dark', 'light']) {
    await setTheme(page, theme);
    await page.waitForTimeout(150);
    await shot(page, `artist-songs-${theme}`);
  }
  await setTheme(page, 'dark');
  await page.locator('.song-row').nth(3).dblclick();
  check('double-click plays from that song', await eventually(page, () => document.querySelector('.pb-title')?.textContent === 'Paper Moon'));
  check('the playing song is marked', (await page.locator('.song-row.is-current .song-title').innerText()) === 'Paper Moon');
  await page.click(t('play-pause'));

  await page.locator('[role="tab"][aria-selected="true"]').focus();
  await page.keyboard.press('ArrowRight');
  check('the arrow keys move between tabs', (await selectedTab()) === 'Albums' && (await page.evaluate(() => document.activeElement?.dataset.tab)) === 'albums');
  const artistAlbums = await page.locator(`${t('artist-albums')} .album-title`).allInnerTexts();
  check('Albums shows the artist’s albums, newest first', artistAlbums.join('|') === 'Crossings|Polar Nights', artistAlbums.join('|'));
  check('their second line is the year alone', (await page.locator(`${t('artist-albums')} .album-detail`).allInnerTexts()).join('|') === '2023|2019');
  check('the songs are hidden on this tab', await page.locator(t('artist-songs')).isHidden());
  for (const theme of ['dark', 'light']) {
    await setTheme(page, theme);
    await page.waitForTimeout(150);
    await shot(page, `artist-albums-${theme}`);
  }
  await setTheme(page, 'dark');
  await page.locator(`${t('artist-albums')} ${t('album-tile')}`).nth(1).click();
  await page.waitForSelector('.detail-cover');
  check('an album opens from the Albums tab', (await heading(page)) === 'Polar Nights');
  check('its back button names the artist', (await text(page, t('back'))) === 'Northern Lights');
  await page.click(t('back'));
  await page.waitForSelector('.detail-artist-pic');
  check('back returns to the artist on the Albums tab', (await heading(page)) === 'Northern Lights' && (await selectedTab()) === 'Albums');
  await page.click(t('artist-tab-songs'));
  check('clicking a tab selects it', (await selectedTab()) === 'Songs');
  await page.keyboard.press('Alt+ArrowLeft');
  await page.waitForSelector('.artist-grid');
  check('Alt+Left returns to the artist grid', (await heading(page)) === 'Artists');

  await openArtist('Daft Punk');
  await page.click(t('artist-tab-albums'));
  check('an artist without albums says so', (await text(page, t('artist-albums'))) === 'No albums by this artist in your library.');
  await page.keyboard.press('Alt+ArrowLeft');
  await page.waitForSelector('.artist-grid');

  console.log('From an album to its artist');
  await page.click(t('nav-albums'));
  await page.waitForSelector('.album-grid');
  await openAlbum(page, 'Polar Nights');
  check('the album’s artist is a link', (await page.locator(t('album-artist')).innerText()) === 'Northern Lights');
  await page.click(t('album-artist'));
  await page.waitForSelector('.detail-artist-pic');
  check('it opens the artist', (await heading(page)) === 'Northern Lights' && (await text(page, t('back'))) === 'Polar Nights');
  await page.click(t('back'));
  await page.waitForSelector('.detail-cover');
  check('and back returns to the album', (await heading(page)) === 'Polar Nights');
  await page.click(t('back'));
  await page.waitForSelector('.album-grid');
  await openAlbum(page, 'Summer Hits 2020');
  check('"Various artists" is plain text', (await page.locator(t('album-artist')).count()) === 0 && (await text(page, t('album-facts'))).startsWith('Various artists'));
  await page.click(t('back'));
  await page.waitForSelector('.album-grid');

  console.log('Artist pictures');
  await page.evaluate(() => window.api.updateSettings({ onlineArt: true }));
  await page.click(t('nav-artists'));
  await page.waitForSelector('.artist-grid');
  const hasPicture = (name) =>
    eventually(page, (n) => [...document.querySelectorAll('.artist-tile')].some((el) => el.querySelector('.artist-name').textContent === n && el.querySelector('.artist-pic img')), name, 15000);
  check('a picture found online appears without a reload', await hasPicture('Northern Lights'));
  check('a second one too', await hasPicture('Harbour Sound'));
  check('the exact name is taken, not the near match before it', !otherRequests.includes('/pic/wrong.png'));
  // Let every name on the page be looked up before judging the misses.
  for (let waited = 0; artistSearches.length < ARTIST_COUNT && waited < 15000; waited += 100) await page.waitForTimeout(100);
  await page.waitForTimeout(300);
  check('Deezer’s grey silhouette is not saved', (await artistTile('Iris Vale').locator('img').count()) === 0 && (await artistTile('Iris Vale').locator('.artist-initial').count()) === 1);
  check('a near match alone is not accepted', (await artistTile('Maple Avenue').locator('img').count()) === 0);
  check('only names on the page are searched, each once', new Set(artistSearches).size === artistSearches.length && artistSearches.every((name) => allArtists.includes(name)) && artistSearches.length === ARTIST_COUNT, `${artistSearches.length}: ${artistSearches.join('|')}`);
  const saved = fs.readdirSync(path.join(dataDir, 'art')).filter((name) => name.startsWith('a-'));
  check('pictures are saved with their own "a-" names', saved.length === 2, saved.join(','));
  const sides = await app.evaluate(({ nativeImage }, files) => files.map((file) => nativeImage.createFromPath(file).getSize()), saved.map((name) => path.join(dataDir, 'art', name)));
  check('and kept at no more than 600px', sides.every(({ width, height }) => Math.max(width, height) <= 600 && width > 0), JSON.stringify(sides));
  await shot(page, 'artists-pictures-dark');
  const searchesSoFar = artistSearches.length;
  await page.click(t('nav-songs'));
  await page.click(t('nav-artists'));
  await page.waitForSelector('.artist-grid');
  await page.waitForTimeout(800);
  check('opening the page again asks nobody: hits and misses are remembered', artistSearches.length === searchesSoFar, `${artistSearches.length - searchesSoFar} new`);
  check('saved pictures show straight away', (await page.locator('.artist-pic img').count()) === 2);
  await openArtist('Northern Lights');
  check('the artist page shows the picture', (await page.locator('.detail-artist-pic img').count()) === 1);
  await shot(page, 'artist-picture-dark');
  await page.evaluate(() => window.api.updateSettings({ onlineArt: false }));
  await page.click(t('nav-albums'));
  await page.waitForSelector('.album-grid');

  console.log('Cover art that arrives late');
  const firstLightId = await page.evaluate(async () => {
    const tracks = await window.api.getLibrary((await window.api.getState()).activeProfileId);
    return tracks.find((track) => track.title === 'Porch Song').id;
  });
  const art = (await tile(page, 'Polar Nights').locator('.album-cover img').getAttribute('src')).replace('media://art/', '');
  await app.evaluate(({ BrowserWindow }, payload) => BrowserWindow.getAllWindows()[0].webContents.send('track:updated', payload), { id: firstLightId, art });
  check('a cover found later appears on the grid without a reload', await eventually(page, () => [...document.querySelectorAll('.album-tile')].some((el) => el.querySelector('.album-title').textContent === 'First Light' && el.querySelector('.album-cover img'))));

  console.log('An album whose files are removed');
  await openAlbum(page, 'First Light');
  fs.rmSync(path.join(music, 'Collection', 'First Light'), { recursive: true, force: true });
  await page.click(t('nav-settings'));
  await page.locator('.settings-row .btn', { hasText: 'Rescan' }).click();
  await page.keyboard.press('Escape');
  check('the page falls back to the grid', await eventually(page, () => document.querySelector('.view h1')?.textContent === 'All albums', null, 15000));
  check('and the album is gone from it', await eventually(page, (n) => document.querySelectorAll('.album-tile').length === n, ALBUM_COUNT - 1));

  console.log('A library with no albums');
  for (const folder of ['Collection', 'Albums', 'Home Recordings']) fs.rmSync(path.join(music, folder), { recursive: true, force: true });
  await page.click(t('nav-settings'));
  await page.locator('.settings-row .btn', { hasText: 'Rescan' }).click();
  await page.keyboard.press('Escape');
  check('with only loose songs the page says "No albums yet"', await eventually(page, () => document.querySelector('.empty h2')?.textContent === 'No albums yet', null, 15000));
  check('and explains where albums come from', (await text(page, '.empty p')) === 'Albums appear here when your music files have an album name.');
  await shot(page, 'albums-empty-dark');
  check('no errors in the window', errors.length === 0, errors.join(' | '));
  await app.close();
}

run()
  .catch(crash)
  .finally(() => {
    server.close();
    removeDir(dataDir);
    removeDir(music);
    finish();
  });
