import test from 'node:test';
import assert from 'node:assert/strict';
import { moveInPlaylist } from '../../src/renderer/js/reorder.js';

const ids = (text) => text.split('');

test('moves a song up and down when every song is present', () => {
  const all = ids('abcdef');
  assert.deepEqual(moveInPlaylist(all, all, 4, 1), ids('aebcdf'));
  assert.deepEqual(moveInPlaylist(all, all, 1, 4), ids('acdebf'));
  assert.deepEqual(moveInPlaylist(all, all, 0, 5), ids('bcdefa'));
  assert.deepEqual(moveInPlaylist(all, all, 5, 0), ids('fabcde'));
});

test('a move to the same place, or out of range, changes nothing', () => {
  const all = ids('abc');
  assert.deepEqual(moveInPlaylist(all, all, 1, 1), all);
  assert.deepEqual(moveInPlaylist(all, all, 7, 0), all);
  assert.deepEqual(moveInPlaylist(all, all, 0, 99), ids('bca'), 'a target past the end means last');
});

test('a missing song keeps its place between its neighbours', () => {
  // "x" is missing: the page shows a b c d.
  const all = ids('abxcd');
  const visible = ids('abcd');
  assert.deepEqual(moveInPlaylist(all, visible, 3, 0), ids('dabxc'), 'd to the top');
  assert.deepEqual(moveInPlaylist(all, visible, 0, 3), ids('bxcda'), 'a to the bottom');
  assert.deepEqual(moveInPlaylist(all, visible, 3, 2), ids('abxdc'), 'd lands before c, after x');
  assert.deepEqual(moveInPlaylist(all, visible, 1, 2), ids('axcbd'), 'b moves past x and c');
});

test('the original list is not changed', () => {
  const all = ids('abc');
  moveInPlaylist(all, all, 0, 2);
  assert.deepEqual(all, ids('abc'));
});
