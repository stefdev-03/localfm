// Loaded in the page's <head>, ahead of everything else, so the window is
// already in the right theme the first time it is drawn. The main process puts
// the saved theme in the address; Settings changes it later through app.js.
if (new URLSearchParams(location.search).get('theme') === 'light') {
  document.documentElement.dataset.theme = 'light';
}
