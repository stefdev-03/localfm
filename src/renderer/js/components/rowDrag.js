// Drag a row of a VirtualList to a new place. Built on pointer events rather
// than the browser's drag and drop, which gives a translucent ghost and no
// control over scrolling.
//
// Rows are virtual: the list removes rows that scroll away and redraws all of
// them whenever the player changes state. So the row being dragged is a copy
// living in the list's container, the original only has its contents hidden,
// and the gap is re-applied to every row the list draws (decorate).

const START_DISTANCE = 5; // px of movement before a press becomes a drag
const EDGE = 48; // px from the top or bottom that scrolls the list
const MAX_SPEED = 18; // px per frame at the very edge

// rows: the list's container. edgeTop(): where the visible top of the list
// is (below the sticky column headings). onDrop(from, to): positions.
export function enableRowDrag({ list, rows, scroller, rowHeight, count, edgeTop, onDrop }) {
  let press = null;
  let drag = null;

  const indexOf = (row) => Math.round(parseFloat(row.style.top) / rowHeight);

  // Lifts the dragged row's place out and slides the rows in between by one.
  function decorate(el, index) {
    if (!drag) {
      el.classList.remove('is-drag-source');
      el.style.transform = '';
      return;
    }
    const { from, to } = drag;
    el.classList.toggle('is-drag-source', index === from);
    let offset = 0;
    if (from < to && index > from && index <= to) offset = -rowHeight;
    else if (to < from && index >= to && index < from) offset = rowHeight;
    el.style.transform = offset ? `translateY(${offset}px)` : '';
  }

  function place() {
    const n = count();
    const top = rows.getBoundingClientRect().top;
    const y = Math.max(0, Math.min((n - 1) * rowHeight, drag.pointerY - top - drag.grab));
    drag.ghost.style.top = `${y}px`;
    const to = Math.max(0, Math.min(n - 1, Math.round(y / rowHeight)));
    if (to !== drag.to) {
      drag.to = to;
      drag.badge.textContent = String(to + 1);
      list.forEachRow(decorate);
    }
  }

  // Near an edge the list scrolls, faster the closer the pointer is.
  function tick() {
    if (!drag) return;
    const box = scroller.getBoundingClientRect();
    const top = Math.max(box.top, edgeTop());
    const y = drag.pointerY;
    let speed = 0;
    if (y < top + EDGE) speed = -MAX_SPEED * Math.min(1, (top + EDGE - y) / EDGE);
    else if (y > box.bottom - EDGE) speed = MAX_SPEED * Math.min(1, (y - (box.bottom - EDGE)) / EDGE);
    if (speed) {
      scroller.scrollTop += speed;
      place();
    }
    drag.frame = requestAnimationFrame(tick);
  }

  function begin(event) {
    const { row, index, startY, pointerId } = press;
    const top = rows.getBoundingClientRect().top;
    const ghost = row.cloneNode(true);
    ghost.classList.remove('is-drag-source');
    ghost.classList.add('is-lifted');
    ghost.style.transform = '';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.dataset.test = 'drag-ghost';
    const badge = document.createElement('span');
    badge.className = 'drag-pos';
    badge.dataset.test = 'drag-position';
    badge.textContent = String(index + 1);
    ghost.append(badge);
    rows.append(ghost);
    try {
      rows.setPointerCapture(pointerId);
    } catch {
      /* the pointer is already gone; pointerup will end the drag */
    }
    drag = { from: index, to: index, ghost, badge, grab: startY - (top + index * rowHeight), pointerY: event.clientY, frame: 0 };
    rows.classList.add('is-dragging');
    document.body.classList.add('is-row-dragging');
    list.forEachRow(decorate);
    place();
    drag.frame = requestAnimationFrame(tick);
  }

  function end(commit) {
    if (!drag) return;
    const { from, to, ghost, frame } = drag;
    cancelAnimationFrame(frame);
    ghost.remove();
    drag = null;
    rows.classList.remove('is-dragging');
    document.body.classList.remove('is-row-dragging');
    list.forEachRow(decorate);
    // The press that ended the drag must not also click whatever is under it.
    const swallow = (event) => {
      event.stopPropagation();
      event.preventDefault();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    if (commit && from !== to) onDrop(from, to);
  }

  const onPointerDown = (event) => {
    if (event.button !== 0 || drag) return;
    const row = event.target.closest('.song-row');
    // Any part of a row is the handle, except its buttons.
    if (!row || !rows.contains(row) || event.target.closest('button') || count() < 2) return;
    press = { row, index: indexOf(row), startY: event.clientY, pointerId: event.pointerId };
  };
  const onPointerMove = (event) => {
    if (drag) {
      drag.pointerY = event.clientY;
      place();
    } else if (press && event.pointerId === press.pointerId && Math.abs(event.clientY - press.startY) > START_DISTANCE) {
      event.preventDefault();
      begin(event);
    }
  };
  const onPointerUp = () => {
    press = null;
    end(true);
  };
  const onCancel = () => {
    press = null;
    end(false);
  };
  const onKeyDown = (event) => {
    if (drag && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };

  rows.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('blur', onCancel);
  window.addEventListener('keydown', onKeyDown, true);

  return {
    decorate,
    get active() {
      return Boolean(drag);
    },
    destroy() {
      onCancel();
      rows.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onCancel);
      window.removeEventListener('keydown', onKeyDown, true);
    },
  };
}
