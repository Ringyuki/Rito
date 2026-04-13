import type {
  HorizontalRule,
  InlineAtom,
  LayoutBlock,
  LineBox,
  TextRun,
} from '../../layout/core/types';
import { buildHrefResolver } from '../../utils/resolve-href';
import { resolveTextColor } from '../../utils/color';
import { drawRubyAnnotation, drawTextRun, RUBY_FONT_SCALE, RUBY_GAP } from '../text/text-renderer';
import { renderBlockBackground, resolveBlockRadius, traceRoundedRect } from './background-renderer';
import { renderImage } from './image-renderer';
import type { ColorOverride } from './types';

export function renderBlock(
  ctx: CanvasRenderingContext2D,
  block: LayoutBlock,
  offsetX: number,
  offsetY: number,
  images?: ReadonlyMap<string, ImageBitmap>,
  colorOverride?: ColorOverride,
): void {
  const relativeOffset = block.relativeOffset;
  if (relativeOffset) {
    ctx.save();
    ctx.translate(relativeOffset.dx, relativeOffset.dy);
  }

  const hasTransform = block.transform !== undefined && block.transform.length > 0;
  if (hasTransform) {
    ctx.save();
    const cx = offsetX + block.bounds.x + block.bounds.width / 2;
    const cy = offsetY + block.bounds.y + block.bounds.height / 2;
    applyTransform(ctx, block.transform, cx, cy);
  }

  const hasOpacity = block.opacity !== undefined && block.opacity < 1;
  if (hasOpacity) {
    ctx.save();
    ctx.globalAlpha = block.opacity;
  }

  const blockX = offsetX + block.bounds.x;
  const blockY = offsetY + block.bounds.y;
  const radius = resolveBlockRadius(block);
  renderBlockBackground(ctx, block, blockX, blockY, radius, images);

  const clipping = block.overflow === 'hidden';
  if (clipping) {
    ctx.save();
    if (radius.rx > 0 || radius.ry > 0) {
      traceRoundedRect(
        ctx,
        blockX,
        blockY,
        block.bounds.width,
        block.bounds.height,
        radius.rx,
        radius.ry,
      );
    } else {
      ctx.beginPath();
      ctx.rect(blockX, blockY, block.bounds.width, block.bounds.height);
    }
    ctx.clip();
  }

  for (const child of block.children) {
    renderChild(ctx, child, blockX, blockY, images, colorOverride);
  }

  if (clipping) ctx.restore();
  if (hasOpacity) ctx.restore();
  if (hasTransform) ctx.restore();
  if (relativeOffset) ctx.restore();
}

function renderChild(
  ctx: CanvasRenderingContext2D,
  child: LayoutBlock['children'][number],
  offsetX: number,
  offsetY: number,
  images?: ReadonlyMap<string, ImageBitmap>,
  colorOverride?: ColorOverride,
): void {
  if (child.type === 'line-box') {
    renderLineBox(ctx, child, offsetX, offsetY, images, colorOverride);
    return;
  }
  if (child.type === 'image') {
    renderImage(ctx, child, offsetX, offsetY, images);
    return;
  }
  if (child.type === 'hr') {
    renderHorizontalRule(ctx, child, offsetX, offsetY);
    return;
  }
  renderBlock(ctx, child, offsetX, offsetY, images, colorOverride);
}

function renderLineBox(
  ctx: CanvasRenderingContext2D,
  lineBox: LineBox,
  offsetX: number,
  offsetY: number,
  images?: ReadonlyMap<string, ImageBitmap>,
  colorOverride?: ColorOverride,
): void {
  const lineX = offsetX + lineBox.bounds.x;
  const lineY = offsetY + lineBox.bounds.y;

  for (const run of lineBox.runs) {
    if (run.type === 'inline-atom') {
      renderInlineAtom(ctx, run, lineX, lineY, images);
    } else {
      drawTextRun(ctx, run, lineX, lineY, colorOverride);
    }
  }

  // Second pass: draw ruby annotations, grouping contiguous runs with the same annotation
  renderRubyAnnotations(ctx, lineBox, lineX, lineY, colorOverride);
}

/**
 * Scan text runs for ruby annotations and draw each annotation centered
 * over its full base group (which may span multiple styled runs).
 */
function renderRubyAnnotations(
  ctx: CanvasRenderingContext2D,
  lineBox: LineBox,
  lineX: number,
  lineY: number,
  colorOverride?: ColorOverride,
): void {
  const runs = lineBox.runs;
  let i = 0;
  while (i < runs.length) {
    const run = runs[i];
    if (!run || run.type !== 'text-run' || !run.rubyAnnotation) {
      i++;
      continue;
    }

    // Scan forward for contiguous text runs with the same annotation
    const annotation = run.rubyAnnotation;
    const groupStart = run;
    let groupEndRun: TextRun = run;
    let j = i + 1;
    while (j < runs.length) {
      const next = runs[j];
      if (!next || next.type !== 'text-run' || next.rubyAnnotation !== annotation) break;
      groupEndRun = next;
      j++;
    }

    // Compute total base width and annotation position (above the base text)
    const groupX = lineX + groupStart.bounds.x;
    const annotationY =
      lineY + groupStart.bounds.y - groupStart.style.fontSize * RUBY_FONT_SCALE - RUBY_GAP;
    const groupWidth = groupEndRun.bounds.x + groupEndRun.bounds.width - groupStart.bounds.x;

    const color = colorOverride
      ? resolveTextColor(
          groupStart.style.color,
          colorOverride.backgroundColor,
          colorOverride.foregroundColor,
        )
      : groupStart.style.color;

    drawRubyAnnotation(ctx, annotation, groupX, annotationY, groupWidth, groupStart.style, color);

    i = j;
  }
}

let cachedAtomResolver:
  | { images: ReadonlyMap<string, ImageBitmap>; resolve: (href: string) => ImageBitmap | undefined }
  | undefined;

function getAtomResolver(
  images: ReadonlyMap<string, ImageBitmap>,
): (href: string) => ImageBitmap | undefined {
  if (cachedAtomResolver?.images === images) return cachedAtomResolver.resolve;
  const resolve = buildHrefResolver(images);
  cachedAtomResolver = { images, resolve };
  return resolve;
}

function renderInlineAtom(
  ctx: CanvasRenderingContext2D,
  atom: InlineAtom,
  offsetX: number,
  offsetY: number,
  images?: ReadonlyMap<string, ImageBitmap>,
): void {
  if (atom.imageSrc && images) {
    const bitmap = getAtomResolver(images)(atom.imageSrc);
    if (bitmap) {
      const x = offsetX + atom.bounds.x;
      const y = offsetY + atom.bounds.y;
      ctx.drawImage(bitmap, x, y, atom.bounds.width, atom.bounds.height);
    }
  }
  if (atom.block) {
    renderBlock(ctx, atom.block, offsetX + atom.bounds.x, offsetY + atom.bounds.y, images);
  }
}

function renderHorizontalRule(
  ctx: CanvasRenderingContext2D,
  hr: HorizontalRule,
  offsetX: number,
  offsetY: number,
): void {
  const x = offsetX + hr.bounds.x;
  const rawY = offsetY + hr.bounds.y + hr.bounds.height / 2;
  const snap = hr.bounds.height % 2 === 1 ? 0.5 : 0;
  const y = Math.round(rawY) + snap;
  ctx.save();
  ctx.strokeStyle = hr.color;
  ctx.lineWidth = hr.bounds.height;
  ctx.beginPath();
  ctx.moveTo(Math.round(x), y);
  ctx.lineTo(Math.round(x + hr.bounds.width), y);
  ctx.stroke();
  ctx.restore();
}

const TRANSFORM_FN_RE = /(rotate|scale|scaleX|scaleY|translate|translateX|translateY)\(([^)]+)\)/g;
const DEG_TO_RAD = Math.PI / 180;

/** Apply CSS transform functions around the given center point. */
function applyTransform(
  ctx: CanvasRenderingContext2D,
  transform: string,
  cx: number,
  cy: number,
): void {
  ctx.translate(cx, cy);
  TRANSFORM_FN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TRANSFORM_FN_RE.exec(transform)) !== null) {
    if (match[1]) applyTransformFn(ctx, match[1], match[2]?.trim() ?? '');
  }
  ctx.translate(-cx, -cy);
}

function applyTransformFn(ctx: CanvasRenderingContext2D, fn: string, args: string): void {
  if (fn === 'rotate') {
    const angle = parseAngle(args);
    if (angle !== undefined) ctx.rotate(angle);
  } else if (fn === 'scale') {
    const parts = args.split(',').map((s) => parseFloat(s.trim()));
    const sx = parts[0] ?? 1;
    const sy = parts[1] ?? sx;
    if (!isNaN(sx) && !isNaN(sy)) ctx.scale(sx, sy);
  } else if (fn === 'scaleX') {
    const v = parseFloat(args);
    if (!isNaN(v)) ctx.scale(v, 1);
  } else if (fn === 'scaleY') {
    const v = parseFloat(args);
    if (!isNaN(v)) ctx.scale(1, v);
  } else if (fn === 'translate') {
    const parts = args.split(',').map((s) => parseLengthValue(s.trim()));
    ctx.translate(parts[0] ?? 0, parts[1] ?? 0);
  } else if (fn === 'translateX') {
    ctx.translate(parseLengthValue(args), 0);
  } else if (fn === 'translateY') {
    ctx.translate(0, parseLengthValue(args));
  }
}

function parseAngle(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed.endsWith('deg')) {
    const n = parseFloat(trimmed);
    return isNaN(n) ? undefined : n * DEG_TO_RAD;
  }
  if (trimmed.endsWith('rad')) {
    const n = parseFloat(trimmed);
    return isNaN(n) ? undefined : n;
  }
  if (trimmed.endsWith('turn')) {
    const n = parseFloat(trimmed);
    return isNaN(n) ? undefined : n * 2 * Math.PI;
  }
  const n = parseFloat(trimmed);
  return isNaN(n) ? undefined : n * DEG_TO_RAD;
}

function parseLengthValue(value: string): number {
  const n = parseFloat(value);
  return isNaN(n) ? 0 : n;
}
