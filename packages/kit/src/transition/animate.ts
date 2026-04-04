import type { TransitionOptions, TransitionPreset } from './types';

/**
 * Apply the exit animation to the snapshot canvas.
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

    // Force reflow so the transition triggers from the current state
    void snapshotCanvas.offsetHeight;

    snapshotCanvas.style.transform = transform;
    snapshotCanvas.style.opacity = opacity;

    const onEnd = (): void => {
      snapshotCanvas.removeEventListener('transitionend', onEnd);
      resolve();
    };
    snapshotCanvas.addEventListener('transitionend', onEnd, { once: true });

    // Safety timeout in case transitionend doesn't fire
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
      return { transform: `translateX(${tx})`, opacity: '0' };
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
