// Moving one song within a playlist. Pure, so it can be unit-tested.
//
// A playlist can hold ids whose files are missing; the page shows only the
// songs it finds. The move is made on the full list: the song is taken out,
// then put back just before the visible song that now follows it (or at the
// end when it was dropped last). Missing songs keep their place relative to
// their neighbours.

// visibleIds: the songs on screen, in order. from / to: positions in it.
export function moveInPlaylist(allIds, visibleIds, from, to) {
  if (from === to || from < 0 || from >= visibleIds.length) return allIds.slice();
  const target = Math.max(0, Math.min(visibleIds.length - 1, to));
  const moved = visibleIds[from];
  const visible = visibleIds.filter((id) => id !== moved);
  visible.splice(target, 0, moved);
  const next = visible[target + 1];
  const result = allIds.filter((id) => id !== moved);
  const at = next === undefined ? result.length : result.indexOf(next);
  result.splice(at === -1 ? result.length : at, 0, moved);
  return result;
}
