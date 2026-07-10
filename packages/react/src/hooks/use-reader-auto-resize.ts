import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import type { ReaderController } from '@ritojs/kit';
import type { ContainerSize } from './use-container-size';

export interface ReaderAutoResizeOptions {
  readonly enabled?: boolean | undefined;
  readonly zoomScale?: number | undefined;
  readonly margin?: number | ((size: ContainerSize) => number) | undefined;
}

interface AutoResizeState {
  node: HTMLElement | null;
  observer: ResizeObserver | null;
  removeViewportListener: (() => void) | null;
  rafId: number | null;
  pending: ContainerSize | null;
  lastAppliedKey: string;
}

interface AutoResizeRefs {
  readonly stateRef: RefObject<AutoResizeState>;
  readonly controllerRef: RefObject<ReaderController | null>;
  readonly optionsRef: RefObject<ReaderAutoResizeOptions>;
}

export function useReaderAutoResize(
  controller: ReaderController | null,
  options: ReaderAutoResizeOptions = {},
): (node: HTMLElement | null) => void {
  const stateRef = useRef(createAutoResizeState());
  const controllerRef = useRef(controller);
  const optionsRef = useRef(options);
  const refs = useMemo(() => ({ stateRef, controllerRef, optionsRef }), []);
  controllerRef.current = controller;
  optionsRef.current = options;

  const flushResize = useCallback(() => {
    flushPendingResize(refs);
  }, [refs]);

  const scheduleResize = useCallback(
    (size: ContainerSize) => {
      schedulePendingResize(stateRef.current, size, flushResize);
    },
    [flushResize],
  );

  const ref = useCallback(
    (node: HTMLElement | null) => {
      attachAutoResizeNode(refs, scheduleResize, node);
    },
    [refs, scheduleResize],
  );

  useEffect(() => {
    const node = stateRef.current.node;
    if (node) scheduleResize(readNodeSize(node));
  }, [controller, options.enabled, options.margin, options.zoomScale, scheduleResize]);

  useEffect(() => {
    return () => {
      resetObserver(stateRef.current);
    };
  }, []);

  return ref;
}

function createAutoResizeState(): AutoResizeState {
  return {
    node: null,
    observer: null,
    removeViewportListener: null,
    rafId: null,
    pending: null,
    lastAppliedKey: '',
  };
}

function flushPendingResize(refs: AutoResizeRefs): void {
  const state = refs.stateRef.current;
  state.rafId = null;
  const pending = state.pending;
  state.pending = null;
  if (!pending) return;
  applyReaderResize(state, refs.controllerRef.current, pending, refs.optionsRef.current);
}

function schedulePendingResize(
  state: AutoResizeState,
  size: ContainerSize,
  flushResize: FrameRequestCallback,
): void {
  state.pending = size;
  if (state.rafId !== null) return;
  state.rafId = requestAnimationFrame(flushResize);
}

function attachAutoResizeNode(
  refs: AutoResizeRefs,
  scheduleResize: (size: ContainerSize) => void,
  node: HTMLElement | null,
): void {
  resetObserver(refs.stateRef.current);
  refs.stateRef.current.node = node;
  if (!node) return;
  refs.stateRef.current.removeViewportListener = attachViewportResizeListener(() => {
    scheduleResize(readNodeSize(node));
  });
  attachResizeObserver(refs.stateRef.current, scheduleResize, node);
  scheduleResize(readNodeSize(node));
}

function attachResizeObserver(
  state: AutoResizeState,
  scheduleResize: (size: ContainerSize) => void,
  node: HTMLElement,
): void {
  if (typeof ResizeObserver === 'undefined') return;
  const observer = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (entry) scheduleResize({ width: entry.contentRect.width, height: entry.contentRect.height });
  });
  observer.observe(node);
  state.observer = observer;
}

function applyReaderResize(
  state: AutoResizeState,
  controller: ReaderController | null,
  size: ContainerSize,
  options: ReaderAutoResizeOptions,
): void {
  if (!controller || options.enabled === false || size.width <= 0 || size.height <= 0) return;
  const zoomScale = options.zoomScale ?? 1;
  const logicalWidth = Math.round(size.width / zoomScale);
  const logicalHeight = Math.round(size.height / zoomScale);
  const margin = typeof options.margin === 'function' ? options.margin(size) : options.margin;
  const key = resizeKey(logicalWidth, logicalHeight, zoomScale, margin);
  if (state.lastAppliedKey === key) return;
  state.lastAppliedKey = key;
  controller.setRenderScale(zoomScale);
  controller.resize(logicalWidth, logicalHeight, margin);
}

function resetObserver(state: AutoResizeState): void {
  state.observer?.disconnect();
  state.observer = null;
  state.removeViewportListener?.();
  state.removeViewportListener = null;
  if (state.rafId !== null) {
    cancelAnimationFrame(state.rafId);
    state.rafId = null;
  }
  state.pending = null;
}

function readNodeSize(node: HTMLElement): ContainerSize {
  const { width, height } = node.getBoundingClientRect();
  return { width, height };
}

function resizeKey(
  width: number,
  height: number,
  zoomScale: number,
  margin: number | undefined,
): string {
  return `${String(width)}:${String(height)}:${String(zoomScale)}:${String(margin ?? '')}`;
}

function attachViewportResizeListener(onResize: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener('resize', onResize, { passive: true });
  window.visualViewport?.addEventListener('resize', onResize, { passive: true });
  return () => {
    window.removeEventListener('resize', onResize);
    window.visualViewport?.removeEventListener('resize', onResize);
  };
}
