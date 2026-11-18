// Renders only the rows that are on screen, so a library with thousands of
// songs scrolls as smoothly as one with twenty. Rows have a fixed height.

export class VirtualList {
  // decorateRow(el, index): called on every row as it is drawn, so a state
  // such as a drag in progress survives rows being redrawn.
  constructor({ scroller, container, rowHeight, renderRow, decorateRow = null, overscan = 8 }) {
    this.scroller = scroller;
    this.container = container;
    this.rowHeight = rowHeight;
    this.renderRow = renderRow;
    this.decorateRow = decorateRow;
    this.overscan = overscan;
    this.count = 0;
    this.rows = new Map();
    this.frame = 0;
    this.onScroll = () => this.update();
    scroller.addEventListener('scroll', this.onScroll, { passive: true });
    this.observer = new ResizeObserver(() => this.update());
    this.observer.observe(scroller);
    container.classList.add('vlist');
  }

  setCount(count) {
    this.count = count;
    this.container.style.height = `${count * this.rowHeight}px`;
    this.refresh();
  }

  // Re-renders every visible row (after the data behind them changed).
  refresh() {
    for (const el of this.rows.values()) el.remove();
    this.rows.clear();
    this.update();
  }

  // Coalesces bursts of changes (cover art arriving, for example) into one repaint.
  refreshSoon() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.refresh();
    });
  }

  update() {
    if (!this.container.isConnected) return;
    const offset =
      this.container.getBoundingClientRect().top - this.scroller.getBoundingClientRect().top + this.scroller.scrollTop;
    const top = this.scroller.scrollTop - offset;
    const start = Math.max(0, Math.floor(top / this.rowHeight) - this.overscan);
    const end = Math.min(this.count, Math.ceil((top + this.scroller.clientHeight) / this.rowHeight) + this.overscan);

    for (const [index, el] of this.rows) {
      if (index < start || index >= end) {
        el.remove();
        this.rows.delete(index);
      }
    }
    for (let index = start; index < end; index++) {
      if (this.rows.has(index)) continue;
      const el = this.renderRow(index);
      el.style.top = `${index * this.rowHeight}px`;
      el.style.height = `${this.rowHeight}px`;
      this.decorateRow?.(el, index);
      this.rows.set(index, el);
      this.container.append(el);
    }
  }

  // Calls fn(el, index) for each row on screen.
  forEachRow(fn) {
    for (const [index, el] of this.rows) fn(el, index);
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.scroller.removeEventListener('scroll', this.onScroll);
    this.observer.disconnect();
    this.rows.clear();
  }
}
