import type { TransitionOptions, TransitionPreset } from './types';

/**
 * Animate the snapshot canvas from its CURRENT position to the given target.
 * Reads the current computed transform to ensure visual continuity after a gesture.
 */
export function animateSnapshotTo(
  snapshotCanvas: HTMLCanvasElement,
  targetTransform: string,
  targetOpacity: string,
  duration: number,
  easing: string,
): Promise<void> {
  if (duration <= 0) {
    snapshotCanvas.style.transform = targetTransform;
    snapshotCanvas.style.opacity = targetOpacity;
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    // Pin current position to avoid a jump
    snapshotCanvas.style.transition = 'none';
    const computed = getComputedStyle(snapshotCanvas);
    snapshotCanvas.style.transform =
      computed.transform === 'none' ? 'translateX(0)' : computed.transform;
    snapshotCanvas.style.opacity = computed.opacity;

    // Force reflow so the browser registers the pinned state
    void snapshotCanvas.offsetHeight;

    // Apply transition and target
    snapshotCanvas.style.transition = `transform ${String(duration)}ms ${easing}, opacity ${String(duration)}ms ${easing}`;
    snapshotCanvas.style.transform = targetTransform;
    snapshotCanvas.style.opacity = targetOpacity;

    const onEnd = (): void => {
      snapshotCanvas.removeEventListener('transitionend', onEnd);
      resolve();
    };
    snapshotCanvas.addEventListener('transitionend', onEnd, { once: true });
    setTimeout(onEnd, duration + 50);
  });
}

// ---------------------------------------------------------------------------
// Direction-specific wrappers for gesture commit/cancel
// ---------------------------------------------------------------------------

/** After a committed forward swipe, slide snapshot off to the left. */
export function animateSlideCommitForward(
  canvas: HTMLCanvasElement,
  options: TransitionOptions,
): Promise<void> {
  return animateSnapshotTo(canvas, 'translateX(-100%)', '1', options.duration, options.easing);
}

/** After a committed backward swipe, slide snapshot (prev page) to translateX(0). */
export function animateSlideCommitBackward(
  canvas: HTMLCanvasElement,
  options: TransitionOptions,
): Promise<void> {
  return animateSnapshotTo(canvas, 'translateX(0)', '1', options.duration, options.easing);
}

/** After a cancelled forward swipe, bounce snapshot back to origin. */
export function animateBounceForward(canvas: HTMLCanvasElement, duration: number): Promise<void> {
  return animateSnapshotTo(
    canvas,
    'translateX(0)',
    '1',
    duration,
    'cubic-bezier(0.34, 1.56, 0.64, 1)',
  );
}

/** After a cancelled backward swipe, bounce snapshot back off-screen left. */
export function animateBounceBackward(canvas: HTMLCanvasElement, duration: number): Promise<void> {
  return animateSnapshotTo(
    canvas,
    'translateX(-100%)',
    '0',
    duration,
    'cubic-bezier(0.34, 1.56, 0.64, 1)',
  );
}

// ---------------------------------------------------------------------------
// Programmatic transition (keyboard / ToC navigation) — kept for compat
// ---------------------------------------------------------------------------

/**
 * Apply the exit animation to the snapshot canvas (programmatic navigation).
 * Returns a promise that resolves when the transition completes.
 */
export function animateSnapshotExit(
  snapshotCanvas: HTMLCanvasElement,
  direction: 'forward' | 'backward',
  options: TransitionOptions,
): Promise<void> {
  if (options.preset === 'none') {
    snapshotCanvas.style.display = 'none';
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const { transform, opacity } = getExitValues(direction, options.preset);

    snapshotCanvas.style.transition = `transform ${String(options.duration)}ms ${options.easing}, opacity ${String(options.duration)}ms ${options.easing}`;
    void snapshotCanvas.offsetHeight;
    snapshotCanvas.style.transform = transform;
    snapshotCanvas.style.opacity = opacity;

    const onEnd = (): void => {
      snapshotCanvas.removeEventListener('transitionend', onEnd);
      resolve();
    };
    snapshotCanvas.addEventListener('transitionend', onEnd, { once: true });
    setTimeout(onEnd, options.duration + 50);
  });
}

function getExitValues(
  direction: 'forward' | 'backward',
  preset: TransitionPreset,
): { transform: string; opacity: string } {
  switch (preset) {
    case 'slide': {
      const tx = direction === 'forward' ? '-100%' : '100%';
      return { transform: `translateX(${tx})`, opacity: '1' };
    }
    case 'fade':
      return { transform: 'translateX(0)', opacity: '0' };
    case 'none':
      return { transform: 'translateX(0)', opacity: '1' };
  }
}

/** Animate the snapshot back to its original position (bounce-back on cancelled swipe). */
export function animateBounceBack(
  snapshotCanvas: HTMLCanvasElement,
  duration: number,
): Promise<void> {
  return new Promise<void>((resolve) => {
    snapshotCanvas.style.transition = `transform ${String(duration)}ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity ${String(duration)}ms ease-out`;
    void snapshotCanvas.offsetHeight;
    snapshotCanvas.style.transform = 'translateX(0)';
    snapshotCanvas.style.opacity = '1';

    const onEnd = (): void => {
      snapshotCanvas.removeEventListener('transitionend', onEnd);
      resolve();
    };
    snapshotCanvas.addEventListener('transitionend', onEnd, { once: true });
    setTimeout(onEnd, duration + 50);
  });
}
