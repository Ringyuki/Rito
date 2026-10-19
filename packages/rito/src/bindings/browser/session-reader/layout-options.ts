import { createLayoutConfig, type LayoutConfig, type ReaderOptions } from '../../../reader';
import type { BrowserReaderArtifact, BrowserReaderLayout } from '../reader-session';
import type { SessionReaderTypography } from './state';

/** The geometry a reader's options and typography overrides ask for. */
export function sessionReaderLayoutConfig(
  options: ReaderOptions,
  typography: SessionReaderTypography,
): LayoutConfig {
  return createLayoutConfig({
    width: options.width,
    height: options.height,
    margin: options.margin ?? 40,
    spread: options.spread ?? 'single',
    spreadGap: options.spreadGap ?? 20,
    ...(typography.fontSize === undefined ? {} : { rootFontSize: typography.fontSize }),
    ...(typography.lineHeight === undefined ? {} : { lineHeightOverride: typography.lineHeight }),
    lineHeightForce: typography.lineHeightForce,
    ...(typography.fontFamily === undefined ? {} : { fontFamilyOverride: typography.fontFamily }),
    fontFamilyForce: typography.fontFamilyForce,
  });
}

/**
 * `config` with its pages where the engine laid them out: a spread's pages
 * sit on the device grid, so at an odd width a page is narrower than an
 * even split of the viewport and the gap between them wider.
 */
export function sessionReaderLaidOutGeometry(
  config: LayoutConfig,
  artifact: BrowserReaderArtifact,
): LayoutConfig {
  const page = artifact.pages[0];
  if (config.spreadMode !== 'double' || page === undefined) return config;
  return { ...config, pageWidth: page.width, spreadGap: config.viewportWidth - 2 * page.width };
}

/** The same geometry as the session lays it out, painted at `renderRatio`. */
export function sessionReaderSessionLayout(
  config: LayoutConfig,
  renderRatio: number,
): BrowserReaderLayout {
  return {
    viewportWidth: config.viewportWidth,
    viewportHeight: config.viewportHeight,
    marginTop: config.marginTop,
    marginRight: config.marginRight,
    marginBottom: config.marginBottom,
    marginLeft: config.marginLeft,
    spreadMode: config.spreadMode,
    firstPageAlone: config.firstPageAlone,
    spreadGap: config.spreadGap,
    rootFontSize: config.rootFontSize,
    ...(config.lineHeightOverride === undefined
      ? {}
      : { lineHeightOverride: config.lineHeightOverride }),
    ...(config.fontFamilyOverride === undefined
      ? {}
      : { fontFamilyOverride: config.fontFamilyOverride }),
    lineHeightForce: config.lineHeightForce ?? false,
    fontFamilyForce: config.fontFamilyForce ?? false,
    renderRatio,
  };
}

export function sameSessionReaderLayoutConfig(first: LayoutConfig, second: LayoutConfig): boolean {
  const keys = new Set([...Object.keys(first), ...Object.keys(second)]) as Set<keyof LayoutConfig>;
  for (const key of keys) if (first[key] !== second[key]) return false;
  return true;
}
