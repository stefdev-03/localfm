// Modals, confirm dialogs, popup menus and toasts.

import { h, icon, iconButton, button } from '../dom.js';

const modalRoot = document.getElementById('modal-root');
const menuRoot = document.getElementById('menu-root');
const toastRoot = document.getElementById('toast-root');
const openModals = [];

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (closeTopMenu()) return;
  const top = openModals.at(-1);
  if (top?.dismissible) top.close();
});

// Keeps Tab inside the top-most dialog.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab') return;
  const top = openModals.at(-1);
  if (!top) return;
  const focusable = [...top.dialog.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
    (el) => !el.disabled && el.offsetParent !== null,
  );
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!top.dialog.contains(document.activeElement)) {
    event.preventDefault();
    first.focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

export function openModal({ title, content, size = 'md', dismissible = true, onClose } = {}) {
  const previousFocus = document.activeElement;
  let closed = false;
  const entry = { dismissible, close, dialog: null };

  function close(result) {
    if (closed) return;
    closed = true;
    openModals.splice(openModals.indexOf(entry), 1);
    overlay.remove();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    onClose?.(result);
  }

  const closeButton = iconButton('close', 'Close', { hidden: !dismissible, onclick: () => close() });
  const dialog = h(
    'div',
    { class: `modal modal-${size}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' }, h('h2', null, title), closeButton),
    h('div', { class: 'modal-body' }, content),
  );
  const overlay = h('div', { class: 'modal-overlay' }, dialog);
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay && entry.dismissible) close();
  });
  entry.dialog = dialog;
  openModals.push(entry);
  modalRoot.append(overlay);
  requestAnimationFrame(() => {
    if (!dialog.contains(document.activeElement)) {
      (dialog.querySelector('[autofocus]') ?? dialog.querySelector('.modal-body button, .modal-body input') ?? dialog.querySelector('button'))?.focus();
    }
  });
  // Locks or unlocks the ways of closing the dialog without an answer: Esc,
  // the close button and a click outside.
  const setDismissible = (value) => {
    entry.dismissible = value;
    closeButton.hidden = !value;
  };
  return { dialog, close, setDismissible };
}

export function confirmDialog({ title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const modal = openModal({
      title,
      size: 'sm',
      onClose: (result) => resolve(result === true),
      content: [
        h('p', { class: 'modal-text' }, message),
        h(
          'div',
          { class: 'modal-actions' },
          button(cancelLabel, { onclick: () => modal.close(false) }),
          button(confirmLabel, { class: danger ? 'btn-danger' : 'btn-accent', autofocus: true, onclick: () => modal.close(true) }),
        ),
      ],
    });
  });
}

// --- popup menu ---------------------------------------------------------

// Open menus, outermost first. Usually one; a right-click menu opened from an
// item of another menu (submenu: true) sits on top of it.
const menuStack = [];

function dropMenu(entry) {
  const hadFocus = entry.menu.contains(document.activeElement);
  entry.menu.remove();
  entry.onClose?.({ hadFocus });
}

// Closes every open menu. Returns whether there was one to close.
export function closeMenu() {
  if (!menuStack.length) return false;
  while (menuStack.length) dropMenu(menuStack.pop());
  return true;
}

// Closes only the top-most menu and hands focus back to the one beneath it.
function closeTopMenu() {
  if (!menuStack.length) return false;
  dropMenu(menuStack.pop());
  const below = menuStack.at(-1);
  if (below) (below.returnFocus?.isConnected ? below.returnFocus : below.menu.querySelector('.menu-item'))?.focus();
  return true;
}

document.addEventListener('mousedown', (event) => {
  // A press inside a menu keeps it (and its parents) and closes anything above.
  const keep = menuStack.findLastIndex((entry) => entry.menu.contains(event.target));
  while (menuStack.length > keep + 1) dropMenu(menuStack.pop());
});
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);

document.addEventListener('keydown', (event) => {
  const top = menuStack.at(-1);
  if (!top || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
  const items = [...top.menu.querySelectorAll('.menu-item')];
  if (!items.length) return;
  event.preventDefault();
  const index = items.indexOf(document.activeElement);
  const step = event.key === 'ArrowDown' ? 1 : -1;
  items[(index + step + items.length) % items.length].focus();
});

// items: [{ label, icon?, leading?, onClick, onContext?, danger?, checked?, title?, test? }
//         | { separator: true } | { heading }]
// onContext({ x, y }) is called when the item is right-clicked.
//
// options:
//   placement  'below' (default) | 'above' | 'right'
//   align      'start' (default) lines up left edges; 'end' lines up right edges
//   dropdown   true unrolls the menu downwards as it opens
//   submenu    true keeps the menus that are already open
//   onClose    called once the menu has gone
export function openMenu(anchor, items, { placement = 'below', align = 'start', dropdown = false, submenu = false, onClose } = {}) {
  if (!submenu) closeMenu();
  const menu = h('div', { class: `menu ${dropdown ? 'is-dropdown' : ''}`, role: 'menu' });
  const entry = { menu, onClose, returnFocus: null };
  for (const item of items) {
    if (item.separator) menu.append(h('div', { class: 'menu-sep' }));
    else if (item.heading) menu.append(h('div', { class: 'menu-heading' }, item.heading));
    else {
      menu.append(
        h(
          'button',
          {
            type: 'button',
            role: 'menuitem',
            class: `menu-item ${item.danger ? 'is-danger' : ''}`,
            title: item.title ?? null,
            'aria-haspopup': item.onContext ? 'menu' : null,
            dataset: item.test ? { test: item.test } : null,
            onclick: () => {
              closeMenu();
              item.onClick?.();
            },
            oncontextmenu: (event) => {
              event.preventDefault();
              if (!item.onContext) return;
              entry.returnFocus = event.currentTarget;
              // The menu key reports no pointer position: use the item itself.
              const box = event.currentTarget.getBoundingClientRect();
              const fromKeyboard = event.clientX === 0 && event.clientY === 0;
              item.onContext(fromKeyboard ? { x: box.left + 24, y: box.bottom - 4 } : { x: event.clientX, y: event.clientY });
            },
          },
          item.leading ?? (item.icon ? icon(item.icon, 16) : h('span', { class: 'menu-gap' })),
          h('span', { class: 'menu-label' }, item.label),
          item.checked && icon('check', 16),
        ),
      );
    }
  }
  menuRoot.append(menu);
  // The anchor is an element, or a { x, y } point for right-click menus.
  const rect =
    anchor instanceof Element
      ? anchor.getBoundingClientRect()
      : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  const { offsetWidth: width, offsetHeight: height } = menu;
  let left = placement === 'right' ? rect.right + 6 : align === 'end' ? rect.right - width : rect.left;
  let top = placement === 'above' ? rect.top - height - 6 : placement === 'right' ? rect.top : rect.bottom + 6;
  if (placement === 'below' && top + height > window.innerHeight - 8) top = rect.top - height - 6;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  top = Math.max(8, Math.min(top, window.innerHeight - height - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menuStack.push(entry);
  menu.querySelector('.menu-item')?.focus();
  return menu;
}

// --- toasts -------------------------------------------------------------

export function toast(message, { action, timeout = 4000 } = {}) {
  const el = h('div', { class: 'toast' }, h('span', null, message));
  const dismiss = () => el.remove();
  if (action) {
    el.append(
      h(
        'button',
        {
          type: 'button',
          class: 'toast-action',
          onclick: () => {
            dismiss();
            action.onClick();
          },
        },
        action.label,
      ),
    );
  }
  toastRoot.append(el);
  while (toastRoot.children.length > 3) toastRoot.firstElementChild.remove();
  setTimeout(dismiss, timeout);
}
