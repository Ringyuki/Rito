import { useCallback, useEffect, useState } from 'react';

const MOBILE_BREAKPOINT = 640;
const TAP_SLOP = 10;

/**
 * Manages mobile overlay visibility with tap-to-toggle.
 * Tapping the center third of the viewport toggles the overlay.
 * Drags, interactive element taps, and desktop viewports are ignored.
 */
export function useMobileOverlay(): {
  visible: boolean;
  hide: () => void;
  toggle: () => void;
} {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let downX = 0;
    let downY = 0;

    const onDown = (e: PointerEvent): void => {
      downX = e.clientX;
      downY = e.clientY;
    };

    const onUp = (e: PointerEvent): void => {
      if (window.innerWidth >= MOBILE_BREAKPOINT) return;
      if (Math.abs(e.clientX - downX) > TAP_SLOP || Math.abs(e.clientY - downY) > TAP_SLOP) return;

      const target = e.target as HTMLElement;
      if (target.closest('button, a, input, textarea, [role="button"], [data-slot]')) return;

      setVisible((v) => !v);
    };

    document.addEventListener('pointerdown', onDown);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('pointerup', onUp);
    };
  }, []);

  return {
    visible,
    hide: useCallback(() => {
      setVisible(false);
    }, []),
    toggle: useCallback(() => {
      setVisible((v) => !v);
    }, []),
  };
}
