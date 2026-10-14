import { useEffect } from 'react';
import type { ReaderController } from '@ritojs/kit';
import { useControllerEvent } from '@ritojs/react';
import { buildDebugReport, noteDebug, watchPage } from '@/lib/debug-log';

watchPage();
// Headless verification and a console both read the report this way.
(window as unknown as { __ritoDebugReport?: () => string }).__ritoDebugReport = buildDebugReport;

/** Notes what the controller reports and what the reader is set to, for a debug report. */
export function useDebugLog(
  controller: ReaderController | null,
  settings: Readonly<Record<string, unknown>>,
): void {
  const described = JSON.stringify(settings);
  useEffect(() => {
    noteDebug('settings', described);
  }, [described]);
  useEffect(() => {
    noteDebug(controller ? 'controller-ready' : 'controller-gone');
  }, [controller]);

  useControllerEvent(controller, 'spreadChange', ({ spreadIndex, spread }) => {
    noteDebug('spreadChange', { spreadIndex, pages: spread.pageIndexes });
  });
  useControllerEvent(controller, 'layoutChange', ({ totalSpreads }) => {
    noteDebug('layoutChange', { totalSpreads });
  });
  useControllerEvent(controller, 'transitionStart', ({ direction }) => {
    noteDebug('transitionStart', direction);
  });
  useControllerEvent(controller, 'transitionEnd', ({ direction, outcome }) => {
    noteDebug('transitionEnd', `${direction} ${outcome}`);
  });
  useControllerEvent(controller, 'positionChange', ({ position }) => {
    noteDebug('positionChange', position);
  });
  useControllerEvent(controller, 'error', ({ message, source }) => {
    noteDebug('controller-error', `${source}: ${message}`);
  });
  useControllerEvent(controller, 'linkClick', ({ href, type }) => {
    noteDebug('linkClick', `${type} ${href}`);
  });
  useControllerEvent(controller, 'footnoteClick', ({ id, href }) => {
    noteDebug('footnoteClick', `${id} ${href}`);
  });
  useControllerEvent(controller, 'imageClick', ({ src }) => {
    noteDebug('imageClick', src);
  });
  useControllerEvent(controller, 'selectionChange', (selection) => {
    noteDebug('selectionChange', { active: selection.hasSelection, chars: selection.text.length });
  });
  useControllerEvent(controller, 'searchResults', ({ results, activeIndex }) => {
    noteDebug('searchResults', { count: results.length, activeIndex });
  });
  useControllerEvent(controller, 'annotationsChange', ({ annotations }) => {
    noteDebug('annotationsChange', { count: annotations.length });
  });
}
