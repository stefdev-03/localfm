import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFileName, resolveNames } from '../../src/main/trackname.js';
import { isSameSong, normalize, primaryArtist, lookupKey } from '../../src/main/match.js';

test('splits "Artist - Title"', () => {
  assert.deepEqual(parseFileName('Daft Punk - Get Lucky.mp3'), { artist: 'Daft Punk', title: 'Get Lucky' });
});

test('keeps hyphens that are part of a name', () => {
  assert.deepEqual(parseFileName('Jay-Z - 99 Problems.mp3'), { artist: 'Jay-Z', title: '99 Problems' });
  assert.deepEqual(parseFileName('a-ha - Take On Me.mp3'), { artist: 'a-ha', title: 'Take On Me' });
});

test('drops upload noise but keeps meaningful brackets', () => {
  assert.deepEqual(parseFileName('Queen - Bohemian Rhapsody (Official Video).mp3'), {
    artist: 'Queen',
    title: 'Bohemian Rhapsody',
  });
  assert.deepEqual(parseFileName('Nirvana - Smells Like Teen Spirit [Official Music Video] [HD].mp3'), {
    artist: 'Nirvana',
    title: 'Smells Like Teen Spirit',
  });
  assert.deepEqual(parseFileName('Artist - Song (Remix) (feat. Guest).mp3'), {
    artist: 'Artist',
    title: 'Song (Remix) (feat. Guest)',
  });
});

test('drops a trailing video id', () => {
  assert.deepEqual(parseFileName('a-ha - Take On Me (Official Video) [djV11Xbc914].mp3'), {
    artist: 'a-ha',
    title: 'Take On Me',
  });
});

test('handles underscores and long dashes', () => {
  assert.deepEqual(parseFileName('Toto_-_Africa.mp3'), { artist: 'Toto', title: 'Africa' });
  assert.deepEqual(parseFileName('Fleetwood Mac – Dreams.mp3'), { artist: 'Fleetwood Mac', title: 'Dreams' });
});

test('removes track numbers without eating numeric artists', () => {
  assert.deepEqual(parseFileName('01 - The Beatles - Come Together.mp3'), { artist: 'The Beatles', title: 'Come Together' });
  assert.deepEqual(parseFileName('02. Radiohead - Karma Police.mp3'), { artist: 'Radiohead', title: 'Karma Police' });
  assert.deepEqual(parseFileName('07 - Interlude.mp3'), { artist: '', title: 'Interlude' });
  assert.deepEqual(parseFileName('50 Cent - In Da Club.mp3'), { artist: '50 Cent', title: 'In Da Club' });
  assert.deepEqual(parseFileName('311 - Amber.mp3'), { artist: '311', title: 'Amber' });
});

test('keeps extra separators in the title', () => {
  assert.deepEqual(parseFileName('Artist - Part One - Part Two.mp3'), { artist: 'Artist', title: 'Part One - Part Two' });
});

test('falls back to the whole name when there is no artist', () => {
  assert.deepEqual(parseFileName('Untitled recording.mp3'), { artist: '', title: 'Untitled recording' });
  assert.deepEqual(parseFileName('(Official Video).mp3'), { artist: '', title: '(Official Video)' });
});

test('tags win over the file name, and fill in separately', () => {
  assert.deepEqual(resolveNames('track07.mp3', { title: 'Hallelujah', artist: 'Jeff Buckley' }), {
    title: 'Hallelujah',
    artist: 'Jeff Buckley',
  });
  assert.deepEqual(resolveNames('Queen - Under Pressure.mp3', { title: '  ' }), { title: 'Under Pressure', artist: 'Queen' });
  assert.deepEqual(resolveNames('Queen - Under Pressure.mp3', { artist: 'Queen & David Bowie' }), {
    title: 'Under Pressure',
    artist: 'Queen & David Bowie',
  });
});

test('normalize ignores case, accents, punctuation and brackets', () => {
  assert.equal(normalize('Beyoncé'), 'beyonce');
  assert.equal(normalize("Don't Stop Me Now (Remastered 2011)"), 'don t stop me now');
  assert.equal(normalize('Song feat. Somebody'), 'song');
  assert.equal(normalize('Ђурђевдан'), 'ђурђевдан');
});

test('primaryArtist takes the first credited artist', () => {
  assert.equal(primaryArtist('Calvin Harris, Dua Lipa'), 'Calvin Harris');
  assert.equal(primaryArtist('Daft Punk feat. Pharrell Williams'), 'Daft Punk');
  assert.equal(primaryArtist('Queen'), 'Queen');
});

test('isSameSong accepts the same song and rejects look-alikes', () => {
  const local = { artist: 'Daft Punk', title: 'Get Lucky' };
  assert.ok(isSameSong(local, { artist: 'Daft Punk', title: 'Get Lucky (feat. Pharrell Williams)' }));
  assert.ok(isSameSong(local, { artist: 'Daft Punk', title: 'Get Lucky (Radio Edit)' }));
  assert.ok(isSameSong({ artist: 'Queen & David Bowie', title: 'Under Pressure' }, { artist: 'Queen', title: 'Under Pressure' }));
  assert.ok(!isSameSong(local, { artist: 'Some Tribute Band', title: 'Get Lucky' }));
  assert.ok(!isSameSong(local, { artist: 'Daft Punk', title: 'One More Time' }));
  assert.ok(!isSameSong({ artist: '', title: 'Get Lucky' }, { artist: 'Daft Punk', title: 'Get Lucky' }));
});

test('lookupKey is stable across spelling variants', () => {
  assert.equal(lookupKey('Daft Punk feat. Pharrell', 'Get Lucky (Official Audio)'), lookupKey('daft punk', 'GET LUCKY'));
});
