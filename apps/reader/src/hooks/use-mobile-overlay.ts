import { useCallback, useEffect, useRef, useState } from 'react';

const MOBILE_BREAKPOINT = 640;
const TAP_SLOP = 10;

/**
 * Manages mobile overlay visibility with tap-to-toggle.
 * Tapping the center third of the viewport toggles the overlay.
 * Drags, interactive element taps, and desktop viewports are ignored.
 *
 * Call `suppress()` from content-interaction handlers (e.g. image/link/
 * footnote/annotation click) to prevent the next tap from toggling.
 */
export function useMobileOverlay(): {
  visible: boolean;
  hide: () => void;
  toggle: () => void;
  suppress: () => void;
} {
  const [visible, setVisible] = useState(false);
  const suppressRef = useRef(false);

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
      if (
        target.closest('button, a, input, textarea, [role="button"], [role="dialog"], [data-slot]')
      )
        return;

      // Defer to next macrotask: on mobile, pointerup fires before touchend,
      // but the kit gesture handler dispatches content-interaction events
      // (image/link/footnote/annotation) on touchend. The setTimeout lets
      // those handlers set the suppress flag before we check it.
      setTimeout(() => {
        if (suppressRef.current) {
          suppressRef.current = false;
          return;
        }
        setVisible((v) => !v);
      }, 0);
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
    suppress: useCallback(() => {
      suppressRef.current = true;
    }, []),
  };
}
