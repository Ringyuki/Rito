// A scrolled reading page beside the reader app: one book, its windows end
// to end, moved by the kit's scroll controller. It is what scrolled reading
// is checked on until the app reads that way itself.
import { createReader, type Reader } from '@ritojs/core';
import { createScrollController, type ScrollController } from '@ritojs/kit';
import { readerViewportMargin } from './hooks/use-reader';
import { loadProductionPinnedFontPolicy } from './lib/production-pinned-font-policy';

interface Opened {
  readonly reader: Reader;
  readonly controller: ScrollController;
}

const view = document.querySelector<HTMLElement>('#view');
const input = document.querySelector<HTMLInputElement>('#open');
const progress = document.querySelector<HTMLElement>('#progress');
let opened: Opened | undefined;

async function open(file: File): Promise<void> {
  if (!view) return;
  if (opened) {
    opened.controller.dispose();
    await opened.reader.dispose();
  }
  const canvas = document.createElement('canvas');
  const reader = await createReader(await file.arrayBuffer(), canvas, {
    width: view.clientWidth,
    height: view.clientHeight,
    margin: readerViewportMargin(view.clientWidth),
    spread: 'scrolled',
    devicePixelRatio: window.devicePixelRatio,
    pinnedFontPolicy: await loadProductionPinnedFontPolicy(),
  });
  const controller = createScrollController(reader, canvas);
  // A link into the book goes to where it points; the rest is left alone.
  controller.on('tap', ({ target }) => {
    if (target?.targetLocator) void controller.scrollToLocator(target.targetLocator);
  });
  controller.on('scroll', ({ offset, extent }) => {
    const max = extent - (controller.axis === 'left' ? view.clientWidth : view.clientHeight);
    if (progress) progress.textContent = `${((100 * offset) / Math.max(1, max)).toFixed(1)}%`;
  });
  controller.mount(view);
  opened = { reader, controller };
  // Headless checks drive and read the view directly.
  Object.assign(window, { __ritoScroll: opened });
  view.dataset['loaded'] = 'true';
}

input?.addEventListener('change', () => {
  const file = input.files?.[0];
  if (file) void open(file);
});
window.addEventListener('resize', () => {
  if (opened && view) opened.reader.resize(view.clientWidth, view.clientHeight);
});
