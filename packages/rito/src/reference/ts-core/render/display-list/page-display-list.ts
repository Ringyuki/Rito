import type {
  BlockPaint,
  HorizontalRule,
  InlineAtom,
  LayoutBlock,
  LayoutConfig,
  LineBox,
  Page,
  RubyAnnotation,
  TextRun,
} from '../../layout/core/types';
import { resolveTextColor } from '../../utils/color';
import type { BlockDecorationPaint, DisplayList, DisplayListOptions, DrawCommand } from './types';
import { absoluteRect, resolveBlockRadius } from './geometry';

interface BuildContext {
  readonly commands: DrawCommand[];
  readonly options: DisplayListOptions | undefined;
}

/** Convert a page into a platform-neutral display list in logical pixels. */
export function buildPageDisplayList(
  page: Page,
  config: LayoutConfig,
  options?: DisplayListOptions,
): DisplayList {
  const ctx: BuildContext = { commands: [], options };
  appendPagePaint(ctx, page, options);
  appendPageClip(ctx, page);

  for (const block of page.content) {
    appendBlock(ctx, block, config.marginLeft, config.marginTop);
  }

  ctx.commands.push({ kind: 'popState' });
  return {
    width: page.bounds.width,
    height: page.bounds.height,
    commands: ctx.commands,
  };
}

function appendPagePaint(
  ctx: BuildContext,
  page: Page,
  options: DisplayListOptions | undefined,
): void {
  if (options?.spreadBodyBg) return;
  const backgroundColor = page.paint?.backgroundColor ?? options?.backgroundColor;
  if (!backgroundColor) return;
  ctx.commands.push({
    kind: 'paintPage',
    rect: { x: 0, y: 0, width: page.bounds.width, height: page.bounds.height },
    paint: { backgroundColor },
  });
}

function appendPageClip(ctx: BuildContext, page: Page): void {
  ctx.commands.push({ kind: 'pushState' });
  ctx.commands.push({
    kind: 'clipRect',
    rect: { x: 0, y: 0, width: page.bounds.width, height: page.bounds.height },
  });
}

function appendBlock(
  ctx: BuildContext,
  block: LayoutBlock,
  offsetX: number,
  offsetY: number,
): void {
  const effects = appendBlockEffects(ctx, block, offsetX, offsetY);
  const blockX = offsetX + block.bounds.x;
  const blockY = offsetY + block.bounds.y;
  appendBlockPaint(ctx, block, blockX, blockY);

  const clipped = appendBlockClip(ctx, block, blockX, blockY);
  for (const child of block.children) {
    appendChild(ctx, child, blockX, blockY);
  }
  if (clipped) ctx.commands.push({ kind: 'popState' });
  appendPops(ctx, effects);
}

function appendBlockEffects(
  ctx: BuildContext,
  block: LayoutBlock,
  offsetX: number,
  offsetY: number,
): number {
  let pushes = 0;
  const paint = block.paint;
  if (paint?.visualOffset) {
    ctx.commands.push({ kind: 'pushState' });
    ctx.commands.push({
      kind: 'translate',
      dx: paint.visualOffset.dx,
      dy: paint.visualOffset.dy,
    });
    pushes++;
  }
  if (paint?.transform && paint.transform.length > 0) {
    ctx.commands.push({ kind: 'pushState' });
    ctx.commands.push({
      kind: 'transform',
      origin: {
        x: offsetX + block.bounds.x + block.bounds.width / 2,
        y: offsetY + block.bounds.y + block.bounds.height / 2,
      },
      box: { width: block.bounds.width, height: block.bounds.height },
      transforms: paint.transform,
    });
    pushes++;
  }
  if (paint?.opacity !== undefined && paint.opacity < 1) {
    ctx.commands.push({ kind: 'pushState' });
    ctx.commands.push({ kind: 'opacity', value: paint.opacity });
    pushes++;
  }
  return pushes;
}

function appendBlockPaint(
  ctx: BuildContext,
  block: LayoutBlock,
  blockX: number,
  blockY: number,
): void {
  const paint = toBlockDecorationPaint(block.paint);
  if (!paint) return;
  ctx.commands.push({
    kind: 'paintBlock',
    rect: { x: blockX, y: blockY, width: block.bounds.width, height: block.bounds.height },
    paint,
    ...(block.borderBox ? { borderBox: block.borderBox } : {}),
  });
}

function toBlockDecorationPaint(paint: BlockPaint | undefined): BlockDecorationPaint | undefined {
  if (!paint) return undefined;
  const hasDecoration =
    paint.background !== undefined ||
    paint.border !== undefined ||
    (paint.boxShadow !== undefined && paint.boxShadow.length > 0);
  if (!hasDecoration) return undefined;
  return {
    ...(paint.background ? { background: paint.background } : {}),
    ...(paint.border ? { border: paint.border } : {}),
    ...(paint.radius ? { radius: paint.radius } : {}),
    ...(paint.boxShadow && paint.boxShadow.length > 0 ? { boxShadow: paint.boxShadow } : {}),
  };
}

function appendBlockClip(
  ctx: BuildContext,
  block: LayoutBlock,
  blockX: number,
  blockY: number,
): boolean {
  if (block.paint?.clipToBounds !== true) return false;
  ctx.commands.push({ kind: 'pushState' });
  ctx.commands.push({
    kind: 'clipRect',
    rect: { x: blockX, y: blockY, width: block.bounds.width, height: block.bounds.height },
    radius: resolveBlockRadius(block),
  });
  return true;
}

function appendChild(
  ctx: BuildContext,
  child: LayoutBlock['children'][number],
  offsetX: number,
  offsetY: number,
): void {
  if (child.type === 'line-box') {
    appendLineBox(ctx, child, offsetX, offsetY);
  } else if (child.type === 'image') {
    appendImage(ctx, child, offsetX, offsetY);
  } else if (child.type === 'hr') {
    appendHorizontalRule(ctx, child, offsetX, offsetY);
  } else {
    appendBlock(ctx, child, offsetX, offsetY);
  }
}

function appendLineBox(
  ctx: BuildContext,
  lineBox: LineBox,
  offsetX: number,
  offsetY: number,
): void {
  const lineX = offsetX + lineBox.bounds.x;
  const lineY = offsetY + lineBox.bounds.y;
  for (const run of lineBox.runs) {
    if (run.type === 'text-run') appendTextRun(ctx, run, lineX, lineY);
    else if (run.type === 'ruby-annotation') appendRuby(ctx, run, lineX, lineY);
    else appendInlineAtom(ctx, run, lineX, lineY);
  }
}

function appendTextRun(ctx: BuildContext, run: TextRun, offsetX: number, offsetY: number): void {
  const paint = resolveRunPaint(run, ctx.options);
  ctx.commands.push({
    kind: 'paintText',
    text: run.text,
    rect: absoluteRect(run.bounds, offsetX, offsetY),
    paint,
    ...(run.lineHeightPx !== undefined ? { lineHeightPx: run.lineHeightPx } : {}),
    ...(run.href ? { href: run.href } : {}),
    ...(run.sourceText !== undefined ? { sourceText: run.sourceText } : {}),
    ...(run.sourceTextOffset !== undefined ? { sourceTextOffset: run.sourceTextOffset } : {}),
  });
}

function appendRuby(
  ctx: BuildContext,
  ruby: RubyAnnotation,
  offsetX: number,
  offsetY: number,
): void {
  ctx.commands.push({
    kind: 'paintRuby',
    text: ruby.text,
    rect: absoluteRect(ruby.bounds, offsetX, offsetY),
    paint: resolveRunPaint(ruby, ctx.options),
  });
}

function appendInlineAtom(
  ctx: BuildContext,
  atom: InlineAtom,
  offsetX: number,
  offsetY: number,
): void {
  if (atom.imageSrc) {
    ctx.commands.push({
      kind: 'paintImage',
      src: atom.imageSrc,
      rect: absoluteRect(atom.bounds, offsetX, offsetY),
      ...(atom.alt ? { alt: atom.alt } : {}),
      ...(atom.href ? { href: atom.href } : {}),
    });
  }
  if (atom.block) appendBlock(ctx, atom.block, offsetX + atom.bounds.x, offsetY + atom.bounds.y);
}

function appendImage(
  ctx: BuildContext,
  image: Extract<LayoutBlock['children'][number], { type: 'image' }>,
  offsetX: number,
  offsetY: number,
): void {
  ctx.commands.push({
    kind: 'paintImage',
    src: image.src,
    rect: absoluteRect(image.bounds, offsetX, offsetY),
    ...(image.alt ? { alt: image.alt } : {}),
    ...(image.href ? { href: image.href } : {}),
  });
}

function appendHorizontalRule(
  ctx: BuildContext,
  hr: HorizontalRule,
  offsetX: number,
  offsetY: number,
): void {
  ctx.commands.push({
    kind: 'paintHorizontalRule',
    rect: absoluteRect(hr.bounds, offsetX, offsetY),
    paint: hr.paint,
  });
}

function appendPops(ctx: BuildContext, count: number): void {
  for (let index = 0; index < count; index++) {
    ctx.commands.push({ kind: 'popState' });
  }
}

function resolveRunPaint(
  run: Pick<TextRun | RubyAnnotation, 'paint'>,
  options: DisplayListOptions | undefined,
): TextRun['paint'] {
  if (!options?.foregroundColor || !options.backgroundColor) return run.paint;
  const color = resolveTextColor(run.paint.color, options.backgroundColor, options.foregroundColor);
  if (color === run.paint.color) return run.paint;
  return {
    ...run.paint,
    color,
    ...(run.paint.decoration ? { decoration: { ...run.paint.decoration, color } } : {}),
    ...(run.paint.textShadow
      ? { textShadow: run.paint.textShadow.map((shadow) => ({ ...shadow, color })) }
      : {}),
  };
}
