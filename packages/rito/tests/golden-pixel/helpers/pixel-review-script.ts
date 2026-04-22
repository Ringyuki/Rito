export function pixelReviewScript(): string {
  return `
function selectBook(bookId) {
  const panels = document.querySelectorAll('[data-book-panel]');
  const buttons = document.querySelectorAll('.book-link[data-book-target]');
  for (const panel of panels) {
    if (!(panel instanceof HTMLElement)) continue;
    panel.classList.toggle('is-active', panel.dataset.bookPanel === bookId);
  }
  for (const button of buttons) {
    if (!(button instanceof HTMLElement)) continue;
    button.classList.toggle('is-active', button.dataset.bookTarget === bookId);
  }
  const activePanel = document.querySelector('[data-book-panel].is-active');
  const firstRun = activePanel?.querySelector('[data-run-panel]');
  if (firstRun instanceof HTMLElement && firstRun.dataset.runPanel) {
    selectRun(firstRun.dataset.runPanel);
  }
}
function selectRun(runId) {
  const panels = document.querySelectorAll('[data-run-panel]');
  const buttons = document.querySelectorAll('.run-link[data-run-target]');
  for (const panel of panels) {
    if (!(panel instanceof HTMLElement)) continue;
    panel.classList.toggle('is-active', panel.dataset.runPanel === runId);
  }
  for (const button of buttons) {
    if (!(button instanceof HTMLElement)) continue;
    button.classList.toggle('is-active', button.dataset.runTarget === runId);
  }
}
function showHashTarget(scrollTarget) {
  const id = decodeURIComponent(window.location.hash.slice(1));
  if (!id) return;
  const target = document.getElementById(id);
  if (!target) return;
  const panel = target.closest('[data-book-panel]');
  if (panel instanceof HTMLElement && panel.dataset.bookPanel) {
    selectBook(panel.dataset.bookPanel);
  }
  const run = target.closest('[data-run-panel]');
  if (run instanceof HTMLElement && run.dataset.runPanel) {
    selectRun(run.dataset.runPanel);
  }
  if (scrollTarget) requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
}
for (const overlay of document.querySelectorAll('[data-overlay]')) {
  const slider = overlay.querySelector('[data-overlay-slider]');
  const actual = overlay.querySelector('[data-overlay-actual]');
  if (!(slider instanceof HTMLInputElement) || !(actual instanceof HTMLElement)) continue;
  slider.addEventListener('input', () => {
    actual.style.width = slider.value + '%';
  });
}
document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const topButton = target.closest('[data-scroll-top]');
  if (topButton) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  const bookControl = target.closest('[data-book-target]');
  if (bookControl instanceof HTMLElement && bookControl.dataset.bookTarget) {
    selectBook(bookControl.dataset.bookTarget);
  }
  const runControl = target.closest('[data-run-target]');
  if (runControl instanceof HTMLElement && runControl.dataset.runTarget) {
    selectRun(runControl.dataset.runTarget);
  }
  const link = target.closest('a[href^="#"]');
  if (!(link instanceof HTMLAnchorElement)) return;
  event.preventDefault();
  const id = decodeURIComponent(link.hash.slice(1));
  window.location.hash = id;
  showHashTarget(true);
});
window.addEventListener('hashchange', () => showHashTarget(true));
showHashTarget(false);
`;
}
