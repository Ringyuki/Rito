import {
  createLayoutConfig,
  type LayoutConfig,
  type Page,
  type ReaderOptions,
  type Spread,
} from '../../../reader';
import { createRitoCoreWasmReaderPages, createRitoCoreWasmReaderSpreads } from '../core-contracts';
import { hostFontMetricConfig } from '../font-metrics';
import type { CoreLayoutConfig, BrowserReaderState } from './types';

export function makeBrowserReaderLayoutConfig(
  options: ReaderOptions,
  spreadMode: 'single' | 'double',
): LayoutConfig {
  return createLayoutConfig({
    width: options.width,
    height: options.height,
    margin: options.margin ?? 40,
    spread: spreadMode,
    spreadGap: options.spreadGap ?? 20,
    ...(options.paginationPolicy !== undefined
      ? { paginationPolicy: options.paginationPolicy }
      : {}),
  });
}

export function toCoreLayoutConfig(
  config: LayoutConfig,
  fontMetrics: BrowserReaderState['fontMetrics'],
): CoreLayoutConfig {
  return {
    ...config,
    textMeasurement: 'fontAware',
    ...hostFontMetricConfig(fontMetrics),
  };
}

export function applyLayoutOverrides(
  state: BrowserReaderState,
  config: LayoutConfig,
): LayoutConfig {
  return {
    ...config,
    ...(state.fontSizeOverride !== undefined ? { rootFontSize: state.fontSizeOverride } : {}),
    ...(state.lineHeightOverride !== undefined
      ? { lineHeightOverride: state.lineHeightOverride }
      : {}),
    lineHeightForce: state.lineHeightForce,
    ...(state.fontFamilyOverride !== undefined
      ? { fontFamilyOverride: state.fontFamilyOverride }
      : {}),
    fontFamilyForce: state.fontFamilyForce,
  };
}

export function browserReaderPages(state: BrowserReaderState): readonly Page[] {
  return createRitoCoreWasmReaderPages(state.revisionBundle.revision.pageCount, state.config);
}

export function browserReaderSpreads(state: BrowserReaderState): readonly Spread[] {
  return createRitoCoreWasmReaderSpreads(
    browserReaderPages(state),
    state.revisionBundle.navigation,
  );
}
