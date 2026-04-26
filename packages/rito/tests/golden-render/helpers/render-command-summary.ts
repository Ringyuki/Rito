import type { Spread } from '../../../src/layout/core';
import { buildSpreadDisplayList, type DisplayList, type DrawCommand } from '../../../src/render';
import { render } from '../../../src/render/spread';
import type { EpubDocument, PaginationResult } from '../../../src/runtime/types';
import { createMockCanvasContext } from '../../helpers/mock-canvas-context';
import type { CanvasRecord } from '../../helpers/mock-canvas-context';
import { isCall, isPropertySet } from '../../helpers/mock-canvas-context';
import type { BookFixture } from '../../golden-books/helpers/book-manifest';
import {
  hashJson,
  roundNumber,
  toJsonValue,
  type JsonValue,
} from '../../golden-books/helpers/canonicalize';
import type { GoldenBookConfig } from '../../golden-books/helpers/golden-configs';
import { countPage } from '../../golden-books/helpers/page-summary';
import type { RenderPageCase } from './render-page-selection';

interface MockImageBitmap {
  readonly __ritoTestImageHref: string;
}

const PIXEL_RATIOS = [1, 2] as const;

export function summarizeRenderCommandSuite(
  book: BookFixture,
  document: EpubDocument,
  result: PaginationResult,
  config: GoldenBookConfig,
  cases: readonly RenderPageCase[],
): JsonValue {
  const images = createMockImageMap(document);
  return {
    schemaVersion: 2,
    book: {
      id: book.id,
      path: book.path,
    },
    config: summarizeConfig(config),
    selection: {
      pageCount: result.pages.length,
      selectedPageCount: cases.length,
      pixelRatios: toJsonValue(PIXEL_RATIOS),
      selectedPages: cases.map((testCase) => summarizePageCase(testCase)),
    },
    cases: cases.map((testCase) => summarizeRenderCase(result, config, testCase, images)),
  };
}

function summarizeConfig(config: GoldenBookConfig): JsonValue {
  return {
    id: config.id,
    lineBreaking: config.lineBreaking,
    layout: toJsonValue(config.layout),
  };
}

function summarizePageCase(testCase: RenderPageCase): JsonValue {
  return {
    id: testCase.id,
    pageIndex: testCase.pageIndex,
    features: toJsonValue(testCase.features),
    counts: toJsonValue(testCase.counts),
  };
}

function summarizeRenderCase(
  result: PaginationResult,
  config: GoldenBookConfig,
  testCase: RenderPageCase,
  images: ReadonlyMap<string, ImageBitmap>,
): JsonValue {
  const page = result.pages[testCase.pageIndex];
  if (!page) throw new Error(`Missing page ${String(testCase.pageIndex)} for ${testCase.id}`);

  return {
    id: testCase.id,
    page: {
      index: page.index,
      bounds: toJsonValue(page.bounds),
      counts: toJsonValue(countPage(page)),
      selectedFeatureCounts: toJsonValue(testCase.counts),
      selectedFeatures: toJsonValue(testCase.features),
    },
    renders: PIXEL_RATIOS.map((pixelRatio) => renderCaseVariant(page, config, images, pixelRatio)),
  };
}

function renderCaseVariant(
  page: NonNullable<PaginationResult['pages'][number]>,
  config: GoldenBookConfig,
  images: ReadonlyMap<string, ImageBitmap>,
  pixelRatio: number,
): JsonValue {
  const recorder = createMockCanvasContext({
    width: Math.round(config.layout.viewportWidth * pixelRatio),
    height: Math.round(config.layout.viewportHeight * pixelRatio),
  });
  render({ index: page.index, left: page } satisfies Spread, recorder.ctx, config.layout, {
    backgroundColor: '#ffffff',
    images,
    pixelRatio,
  });

  return {
    pixelRatio,
    canvas: {
      width: Math.round(config.layout.viewportWidth * pixelRatio),
      height: Math.round(config.layout.viewportHeight * pixelRatio),
    },
    displayList: summarizeDisplayList(
      buildSpreadDisplayList({ index: page.index, left: page }, config.layout, {
        backgroundColor: '#ffffff',
      }),
    ),
    records: summarizeRecords(recorder.records),
  };
}

function createMockImageMap(document: EpubDocument): ReadonlyMap<string, ImageBitmap> {
  return new Map(
    [...document.images.keys()].map((href) => [
      href,
      { __ritoTestImageHref: href } as MockImageBitmap as unknown as ImageBitmap,
    ]),
  );
}

function summarizeRecords(records: readonly CanvasRecord[]): JsonValue {
  const normalized = records.map((record) => normalizeRecord(record));
  return {
    count: records.length,
    hash: hashJson(normalized),
    methods: countMethods(records),
    properties: countProperties(records),
    sequence: normalized,
  };
}

function summarizeDisplayList(displayList: DisplayList): JsonValue {
  const normalized = displayList.commands.map((command) => normalizeDrawCommand(command));
  return {
    width: roundNumber(displayList.width),
    height: roundNumber(displayList.height),
    commandCount: displayList.commands.length,
    hash: hashJson(normalized),
    commands: countCommands(displayList.commands),
  };
}

function normalizeDrawCommand(command: DrawCommand): JsonValue {
  if (command.kind === 'paintText' || command.kind === 'paintRuby') {
    const normalized = toJsonValue(command);
    if (isJsonObject(normalized)) return { ...normalized, text: summarizeText(command.text) };
  }
  return toJsonValue(command);
}

function isJsonObject(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeRecord(record: CanvasRecord): JsonValue {
  if (isCall(record)) {
    return {
      type: 'call',
      method: record.method,
      args: record.args.map((arg, index) => normalizeArg(record.method, index, arg)),
    };
  }
  if (isPropertySet(record)) {
    return {
      type: 'set',
      property: record.property,
      value: normalizeValue(record.value),
    };
  }
  return null;
}

function normalizeArg(method: string, index: number, value: unknown): JsonValue {
  if (isTextArgument(method, index) && typeof value === 'string') {
    return summarizeText(value);
  }
  return normalizeValue(value);
}

function normalizeValue(value: unknown): JsonValue {
  if (typeof value === 'number') return roundNumber(value);
  if (typeof value === 'string' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item));
  if (isMockImage(value)) return { imageHref: value.__ritoTestImageHref };
  if (value === undefined) return null;
  return toJsonValue(value);
}

function summarizeText(text: string): JsonValue {
  return {
    length: text.length,
    hash: hashJson(text),
  };
}

function isTextArgument(method: string, index: number): boolean {
  return (
    index === 0 && (method === 'fillText' || method === 'strokeText' || method === 'measureText')
  );
}

function isMockImage(value: unknown): value is MockImageBitmap {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__ritoTestImageHref' in value &&
    typeof value.__ritoTestImageHref === 'string'
  );
}

function countMethods(records: readonly CanvasRecord[]): JsonValue {
  const counts = new Map<string, number>();
  for (const record of records) {
    if (isCall(record)) counts.set(record.method, (counts.get(record.method) ?? 0) + 1);
  }
  return toSortedJsonObject(counts);
}

function countProperties(records: readonly CanvasRecord[]): JsonValue {
  const counts = new Map<string, number>();
  for (const record of records) {
    if (isPropertySet(record)) counts.set(record.property, (counts.get(record.property) ?? 0) + 1);
  }
  return toSortedJsonObject(counts);
}

function countCommands(commands: readonly DrawCommand[]): JsonValue {
  const counts = new Map<string, number>();
  for (const command of commands) {
    counts.set(command.kind, (counts.get(command.kind) ?? 0) + 1);
  }
  return toSortedJsonObject(counts);
}

function toSortedJsonObject(counts: ReadonlyMap<string, number>): JsonValue {
  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}
