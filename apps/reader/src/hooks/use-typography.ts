import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReaderOptions } from '@ritojs/core';
import type { ReaderController } from '@ritojs/kit';

export interface Typography {
  /** Root font size in CSS px; the browser default is 16. */
  readonly fontSize: number;
  /** Unitless line-height scale the slider shows. */
  readonly lineHeight: number;
  /** Whether the line height overrides the book's at all. */
  readonly lineHeightActive: boolean;
  /** Override every element's line height, not only those without their own. */
  readonly lineHeightForce: boolean;
  /** A CSS font-family list; null keeps the book's own families. */
  readonly fontFamily: string | null;
  /** Override every element's font family, not only those without their own. */
  readonly fontFamilyForce: boolean;
}

export const DEFAULT_TYPOGRAPHY: Typography = {
  fontSize: 16,
  lineHeight: 1.4,
  lineHeightActive: false,
  lineHeightForce: false,
  fontFamily: null,
  fontFamilyForce: true,
};

/** The typography a reader opens with, so a book lays out once, already styled. */
export function typographyReaderOptions(
  typography: Typography,
): Pick<
  ReaderOptions,
  'fontSize' | 'lineHeight' | 'lineHeightForce' | 'fontFamily' | 'fontFamilyForce'
> {
  return {
    fontSize: typography.fontSize,
    ...(typography.lineHeightActive
      ? { lineHeight: typography.lineHeight, lineHeightForce: typography.lineHeightForce }
      : {}),
    ...(typography.fontFamily !== null
      ? { fontFamily: typography.fontFamily, fontFamilyForce: typography.fontFamilyForce }
      : {}),
  };
}

/**
 * The reader's typography: state the settings panel edits. The book being
 * opened takes the values of the moment it starts opening (call
 * `markOpening`); {@link useApplyTypography} applies later changes.
 */
export function useTypography() {
  const [typography, setTypography] = useState(DEFAULT_TYPOGRAPHY);
  const latest = useRef(typography);
  latest.current = typography;
  const openedWith = useRef(DEFAULT_TYPOGRAPHY);

  const update = useCallback((patch: Partial<Typography>) => {
    setTypography((current) => ({ ...current, ...patch }));
  }, []);

  return {
    typography,
    openedWith,
    markOpening: useCallback(() => {
      openedWith.current = latest.current;
    }, []),
    setFontSize: useCallback(
      (fontSize: number) => {
        update({ fontSize });
      },
      [update],
    ),
    // Moving the slider is what turns the override on.
    setLineHeight: useCallback(
      (lineHeight: number) => {
        update({ lineHeight, lineHeightActive: true });
      },
      [update],
    ),
    setLineHeightForce: useCallback(
      (lineHeightForce: boolean) => {
        update({ lineHeightForce, lineHeightActive: true });
      },
      [update],
    ),
    useBookLineHeight: useCallback(() => {
      update({
        lineHeight: DEFAULT_TYPOGRAPHY.lineHeight,
        lineHeightActive: false,
        lineHeightForce: false,
      });
    }, [update]),
    setFontFamily: useCallback(
      (fontFamily: string | null) => {
        update({ fontFamily });
      },
      [update],
    ),
    setFontFamilyForce: useCallback(
      (fontFamilyForce: boolean) => {
        update({ fontFamilyForce });
      },
      [update],
    ),
    reset: useCallback(() => {
      setTypography(DEFAULT_TYPOGRAPHY);
    }, []),
  };
}

/** Applies typography changes to the open book; the values it opened with apply once only. */
export function useApplyTypography(
  controller: ReaderController | null,
  state: Pick<ReturnType<typeof useTypography>, 'typography' | 'openedWith'>,
): void {
  const { typography, openedWith } = state;
  const applied = useRef<{ controller: ReaderController | null; typography: Typography }>({
    controller: null,
    typography: DEFAULT_TYPOGRAPHY,
  });
  useEffect(() => {
    if (!controller) return;
    if (applied.current.controller !== controller) {
      applied.current = { controller, typography: openedWith.current };
    }
    if (applied.current.typography === typography) return;
    applied.current = { controller, typography };
    controller.setTypography({
      fontSize: typography.fontSize,
      lineHeight: typography.lineHeightActive ? typography.lineHeight : null,
      lineHeightForce: typography.lineHeightActive && typography.lineHeightForce,
      fontFamily: typography.fontFamily,
      fontFamilyForce: typography.fontFamilyForce,
    });
  }, [controller, typography, openedWith]);
}
