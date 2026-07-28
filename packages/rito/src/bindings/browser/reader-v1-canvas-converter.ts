import type {
  RitoReaderBackgroundPaintV1,
  RitoReaderBlockPaintV1,
  RitoReaderBorderEdgePaintV1,
  RitoReaderColorV1,
  RitoReaderDisplayCommandV1,
  RitoReaderPaintTextCommandV1,
  RitoReaderRunBorderEdgeV1,
  RitoReaderRunPaintV1,
} from '@ritojs/core-wasm/decoder';

import type { CoreFrameCommand } from './core-contracts';
import { BrowserReaderCanvasUnsupportedErrorV1 } from './reader-v1-canvas-error';

type CoreBlock = Extract<CoreFrameCommand, { readonly kind: 'paintBlock' }>;
type CoreBorderEdge = NonNullable<NonNullable<CoreBlock['paint']['border']>['top']>;
type CoreRunPaint = Extract<CoreFrameCommand, { readonly kind: 'paintText' }>['paint'];
type CoreRunBorderEdge = NonNullable<NonNullable<CoreRunPaint['border']>['top']>;

export function convertReaderDisplayCommandsV1(
  commands: readonly RitoReaderDisplayCommandV1[],
): readonly CoreFrameCommand[] {
  const converted: CoreFrameCommand[] = [];
  let stateDepth = 0;
  for (const command of commands) {
    if (command.kind === 'push-state') stateDepth += 1;
    if (command.kind === 'pop-state') {
      if (stateDepth === 0) return unsupported('display-state:unmatched-pop');
      stateDepth -= 1;
    }
    const value = convertCommand(command);
    if (value !== undefined) converted.push(value);
  }
  if (stateDepth !== 0) return unsupported('display-state:unclosed-push');
  if (typeof structuredClone !== 'function') return unsupported('structuredClone');
  return deepFreeze(structuredClone(converted));
}

function convertCommand(command: RitoReaderDisplayCommandV1): CoreFrameCommand | undefined {
  switch (command.kind) {
    case 'push-state':
      return { kind: 'pushState' };
    case 'pop-state':
      return { kind: 'popState' };
    case 'translate':
      return { kind: 'translate', dx: command.dx, dy: command.dy };
    case 'opacity':
      return { kind: 'opacity', value: command.value };
    case 'transform':
      return convertTransform(command);
    case 'clip-rect':
      return convertClipRect(command);
    case 'paint-page':
      return convertPage(command);
    case 'paint-block':
      return convertBlock(command);
    case 'paint-text':
      return convertText(command);
    case 'paint-ruby':
      return {
        kind: 'paintRuby',
        text: command.text,
        rect: command.rect,
        paint: convertRunPaint(command.paint),
      };
    case 'paint-image':
      return {
        kind: 'paintImage',
        src: command.src,
        rect: command.rect,
        ...(command.alt === undefined ? {} : { alt: command.alt }),
        ...(command.href === undefined ? {} : { href: command.href }),
        ...(command.sourceRect === undefined ? {} : { sourceRect: command.sourceRect }),
      };
    case 'paint-horizontal-rule':
      return convertHorizontalRule(command);
    default:
      return assertNever(command);
  }
}

function convertClipRect(
  command: Extract<RitoReaderDisplayCommandV1, { readonly kind: 'clip-rect' }>,
): CoreFrameCommand {
  return {
    kind: 'clipRect',
    rect: command.rect,
    ...(command.radius === undefined ? {} : { radius: command.radius }),
  };
}

function convertPage(
  command: Extract<RitoReaderDisplayCommandV1, { readonly kind: 'paint-page' }>,
): CoreFrameCommand {
  const backgroundColor = command.paint.backgroundColor;
  return {
    kind: 'paintPage',
    rect: command.rect,
    paint:
      backgroundColor === undefined ? {} : { backgroundColor: toCanvasColorV1(backgroundColor) },
  };
}

function convertTransform(
  command: Extract<RitoReaderDisplayCommandV1, { readonly kind: 'transform' }>,
): CoreFrameCommand {
  return {
    kind: 'transform',
    origin: command.origin,
    box: command.boxSize,
    transforms: command.transforms.map((transform) =>
      transform.kind === 'rotate' ? { kind: 'rotate', rad: transform.radians } : transform,
    ),
  };
}

function convertBlock(
  command: Extract<RitoReaderDisplayCommandV1, { readonly kind: 'paint-block' }>,
): CoreFrameCommand {
  return {
    kind: 'paintBlock',
    rect: command.rect,
    paint: convertBlockPaint(command.paint),
    ...(command.borderBox === undefined ? {} : { borderBox: command.borderBox }),
  };
}

function convertText(command: RitoReaderPaintTextCommandV1): CoreFrameCommand {
  return {
    kind: 'paintText',
    text: command.text,
    rect: command.rect,
    paint: convertRunPaint(command.paint),
    ...(command.lineHeightPx === undefined ? {} : { lineHeightPx: command.lineHeightPx }),
    ...(command.href === undefined ? {} : { href: command.href }),
    ...(command.sourceText === undefined ? {} : { sourceText: command.sourceText }),
  };
}

function convertBlockPaint(paint: RitoReaderBlockPaintV1): CoreBlock['paint'] {
  const background = convertBackground(paint.background);
  const border = paint.border === undefined ? undefined : convertBlockBorder(paint.border);
  return {
    ...(background === undefined ? {} : { background }),
    ...(border === undefined ? {} : { border }),
    ...(paint.radius === undefined ? {} : { radius: convertBlockRadius(paint.radius) }),
    boxShadow: paint.boxShadows.map((shadow) => ({
      ...shadow,
      color: toCanvasColorV1(shadow.color),
    })),
  };
}

function convertBlockRadius(
  radius: NonNullable<RitoReaderBlockPaintV1['radius']>,
): NonNullable<CoreBlock['paint']['radius']> {
  if (radius.unit === 'corners') return { corners: radius.corners };
  return radius.unit === 'px' ? { px: radius.value } : { pct: radius.value };
}

function convertBackground(
  background: RitoReaderBackgroundPaintV1 | undefined,
): NonNullable<CoreBlock['paint']['background']> | undefined {
  if (background === undefined) return undefined;
  if (
    background.repeat !== undefined &&
    background.repeat !== 'repeat' &&
    background.repeat !== 'no-repeat'
  ) {
    unsupported(`background-repeat:${background.repeat}`);
  }
  return {
    ...(background.color === undefined ? {} : { color: toCanvasColorV1(background.color) }),
    ...(background.image === undefined ? {} : { image: background.image }),
    ...(background.size === undefined ? {} : { size: background.size }),
    ...(background.repeat === undefined ? {} : { repeat: background.repeat }),
    ...(background.position === undefined ? {} : { position: background.position }),
  };
}

function convertRunPaint(paint: RitoReaderRunPaintV1): CoreRunPaint {
  return {
    font: paint.font,
    color: toCanvasColorV1(paint.color),
    ...(paint.wordSpacingPx === undefined ? {} : { wordSpacingPx: paint.wordSpacingPx }),
    ...(paint.letterSpacingPx === undefined ? {} : { letterSpacingPx: paint.letterSpacingPx }),
    ...(paint.backgroundColor === undefined
      ? {}
      : { backgroundColor: toCanvasColorV1(paint.backgroundColor) }),
    ...(paint.backgroundRadius === undefined ? {} : { backgroundRadius: paint.backgroundRadius }),
    textShadow: paint.textShadows.map((shadow) => ({
      ...shadow,
      color: toCanvasColorV1(shadow.color),
    })),
    ...(paint.decoration === undefined
      ? {}
      : {
          decoration: {
            ...paint.decoration,
            color: toCanvasColorV1(paint.decoration.color),
          },
        }),
    ...(paint.padding === undefined ? {} : { padding: paint.padding }),
    ...(paint.border === undefined ? {} : { border: convertRunBorder(paint.border) }),
  };
}

function convertHorizontalRule(
  command: Extract<RitoReaderDisplayCommandV1, { readonly kind: 'paint-horizontal-rule' }>,
): CoreFrameCommand | undefined {
  const style = supportedBorderStyle(command.paint.style);
  if (style === undefined) return undefined;
  return {
    kind: 'paintHorizontalRule',
    rect: command.rect,
    paint: { color: toCanvasColorV1(command.paint.color), style },
  };
}

function convertBorderEdge(
  edge: RitoReaderBorderEdgePaintV1 | undefined,
): CoreBorderEdge | undefined {
  if (edge === undefined) return undefined;
  const style = supportedBorderStyle(edge.style);
  return style === undefined ? undefined : { color: toCanvasColorV1(edge.color), style };
}

function convertRunBorderEdge(
  edge: RitoReaderRunBorderEdgeV1 | undefined,
): CoreRunBorderEdge | undefined {
  if (edge === undefined) return undefined;
  const paint = convertBorderEdge(edge.paint);
  return paint === undefined ? undefined : { widthPx: edge.widthPx, paint };
}

function supportedBorderStyle(
  style: RitoReaderBorderEdgePaintV1['style'],
): CoreBorderEdge['style'] | undefined {
  if (style === 'none' || style === 'hidden') return undefined;
  if (style === 'solid' || style === 'dotted' || style === 'dashed') return style;
  return unsupported(`border-style:${style}`);
}

function convertBlockBorder(
  border: NonNullable<RitoReaderBlockPaintV1['border']>,
): NonNullable<CoreBlock['paint']['border']> {
  const top = convertBorderEdge(border.top);
  const right = convertBorderEdge(border.right);
  const bottom = convertBorderEdge(border.bottom);
  const left = convertBorderEdge(border.left);
  return {
    ...(top === undefined ? {} : { top }),
    ...(right === undefined ? {} : { right }),
    ...(bottom === undefined ? {} : { bottom }),
    ...(left === undefined ? {} : { left }),
  };
}

function convertRunBorder(
  border: NonNullable<RitoReaderRunPaintV1['border']>,
): NonNullable<CoreRunPaint['border']> {
  const top = convertRunBorderEdge(border.top);
  const bottom = convertRunBorderEdge(border.bottom);
  const start = convertRunBorderEdge(border.start);
  const end = convertRunBorderEdge(border.end);
  return {
    ...(top === undefined ? {} : { top }),
    ...(bottom === undefined ? {} : { bottom }),
    ...(start === undefined ? {} : { start }),
    ...(end === undefined ? {} : { end }),
  };
}

export function toCanvasColorV1(color: RitoReaderColorV1): string {
  if (color.space !== 'srgb') return unsupported(`color-space:${color.space}`);
  if (color.none.component0 || color.none.component1 || color.none.component2 || color.none.alpha) {
    return unsupported('color-component:none');
  }
  const components = [color.component0, color.component1, color.component2, color.alpha];
  if (!components.every(Number.isFinite)) return unsupported('color-component:non-finite');
  const red = color.component0 * 255;
  const green = color.component1 * 255;
  const blue = color.component2 * 255;
  return `rgba(${String(red)}, ${String(green)}, ${String(blue)}, ${String(color.alpha)})`;
}

function unsupported(feature: string): never {
  throw new BrowserReaderCanvasUnsupportedErrorV1(feature);
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Reader v1 display command: ${JSON.stringify(value)}`);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}
