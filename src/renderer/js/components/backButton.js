// The button above a detail page's heading that returns to where it was
// opened from. Alt+Left and the mouse's back button do the same (app.js).

import { h, icon } from '../dom.js';
import { goBack } from '../state.js';

// The name of the page Back returns to.
export function backLabel(view) {
  if (view?.type === 'albums') return 'All albums';
  if (view?.type === 'artists') return 'Artists';
  return view?.name ?? 'Back';
}

export function backButton(from) {
  return h(
    'button',
    { type: 'button', class: 'back-btn', dataset: { test: 'back' }, title: 'Back (Alt+Left)', onclick: () => goBack() },
    icon('arrowLeft', 16),
    h('span', null, backLabel(from)),
  );
}
