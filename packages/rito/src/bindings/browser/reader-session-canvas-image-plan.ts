import type { CoreReaderPrimitive, CoreReaderPrimitiveList } from './core-contracts';

interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

interface ImageUse {
  decodeScale(sourceWidth: number, sourceHeight: number): number;
}

type TransformPrimitive = Extract<CoreReaderPrimitive, { readonly kind: 'transform' }>;

/**
 * The decode target every image in a primitive list needs: each draw
 * names the device rect it lands in (a tiled draw, its tile), so the
 * scale a bitmap is decoded at follows from that rect and the device
 * transforms in force — no pixel ratio applies, the list is already on
 * the device grid.
 */
export class BrowserReaderCanvasImageTargetPlan {
  private constructor(private readonly usesByHref: ReadonlyMap<string, readonly ImageUse[]>) {}

  get hrefs(): readonly string[] {
    return [...this.usesByHref.keys()];
  }

  targetFor(
    href: string,
    sourceWidth: number,
    sourceHeight: number,
    bucketSize: number,
  ): ImageDimensions {
    const uses = this.usesByHref.get(href);
    if (!uses?.length) throw new Error(`Image is not required by this display list: ${href}`);
    let scale = 0;
    for (const use of uses) scale = Math.max(scale, use.decodeScale(sourceWidth, sourceHeight));
    if (!Number.isFinite(scale) || scale <= 0) {
      throw new Error(`reader session image ${href} has an invalid paint target.`);
    }
    const sourceDominant = Math.max(sourceWidth, sourceHeight);
    const requestedDominant = sourceDominant * Math.min(1, scale);
    const bucketedDominant = Math.min(
      sourceDominant,
      Math.ceil(requestedDominant / bucketSize) * bucketSize,
    );
    const divisor = greatestCommonDivisor(sourceWidth, sourceHeight);
    const ratioWidth = sourceWidth / divisor;
    const ratioHeight = sourceHeight / divisor;
    const ratioDominant = Math.max(ratioWidth, ratioHeight);
    const multiplier = Math.min(divisor, Math.ceil(bucketedDominant / ratioDominant));
    return {
      width: ratioWidth * multiplier,
      height: ratioHeight * multiplier,
    };
  }

  static collect(list: CoreReaderPrimitiveList): BrowserReaderCanvasImageTargetPlan {
    const collector = new ImageTargetCollector();
    collector.collect(list.commands);
    return new BrowserReaderCanvasImageTargetPlan(collector.usesByHref);
  }
}

class ImageTargetCollector {
  readonly usesByHref = new Map<string, ImageUse[]>();
  private readonly stack: LinearTransform[] = [LinearTransform.identity()];

  collect(primitives: readonly CoreReaderPrimitive[]): void {
    for (const primitive of primitives) this.collectPrimitive(primitive);
    if (this.stack.length !== 1) throw new Error('reader session display state is unbalanced.');
  }

  private collectPrimitive(primitive: CoreReaderPrimitive): void {
    if (primitive.kind === 'push-state') this.stack.push(this.transform);
    else if (primitive.kind === 'pop-state') this.popState();
    else if (primitive.kind === 'translate') this.validateTranslate(primitive.dx, primitive.dy);
    else if (primitive.kind === 'transform') this.applyTransform(primitive);
    else if (primitive.kind === 'draw-image') this.addDraw(primitive.src, primitive.dest);
  }

  private get transform(): LinearTransform {
    const value = this.stack.at(-1);
    if (!value) throw new Error('reader session display state is empty.');
    return value;
  }

  private popState(): void {
    if (this.stack.length === 1) throw new Error('reader session display restore is unbalanced.');
    this.stack.pop();
  }

  private applyTransform(primitive: TransformPrimitive): void {
    requireFinite(primitive.origin.x, 'transform origin x');
    requireFinite(primitive.origin.y, 'transform origin y');
    let next = this.transform;
    for (const operation of primitive.transforms) {
      if (operation.kind === 'rotate') {
        requireFinite(operation.radians, 'rotation');
        next = next.rotate(operation.radians);
      } else if (operation.kind === 'scale') {
        requireFinite(operation.sx, 'scale x');
        requireFinite(operation.sy, 'scale y');
        next = next.scale(operation.sx, operation.sy);
      } else {
        requireFinite(operation.dx, 'transform translation x');
        requireFinite(operation.dy, 'transform translation y');
      }
    }
    this.stack[this.stack.length - 1] = next;
  }

  private addDraw(href: string, dest: { readonly width: number; readonly height: number }): void {
    requireHref(href);
    requireRect(dest, href);
    const transform = this.transform;
    this.add(href, {
      decodeScale: (sourceWidth, sourceHeight) =>
        Math.max(
          (dest.width * transform.xScale) / sourceWidth,
          (dest.height * transform.yScale) / sourceHeight,
        ),
    });
  }

  private add(href: string, use: ImageUse): void {
    const uses = this.usesByHref.get(href);
    if (uses) uses.push(use);
    else this.usesByHref.set(href, [use]);
  }

  private validateTranslate(dx: number, dy: number): void {
    requireFinite(dx, 'translation x');
    requireFinite(dy, 'translation y');
  }
}

class LinearTransform {
  private constructor(
    private readonly a: number,
    private readonly b: number,
    private readonly c: number,
    private readonly d: number,
  ) {}

  get xScale(): number {
    return Math.hypot(this.a, this.b);
  }

  get yScale(): number {
    return Math.hypot(this.c, this.d);
  }

  scale(sx: number, sy: number): LinearTransform {
    return new LinearTransform(this.a * sx, this.b * sx, this.c * sy, this.d * sy);
  }

  rotate(radians: number): LinearTransform {
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    return new LinearTransform(
      this.a * cosine + this.c * sine,
      this.b * cosine + this.d * sine,
      -this.a * sine + this.c * cosine,
      -this.b * sine + this.d * cosine,
    );
  }

  static identity(): LinearTransform {
    return new LinearTransform(1, 0, 0, 1);
  }
}

function requireHref(href: string): void {
  if (!href) throw new Error('reader session display list image href is empty.');
}

function requireRect(
  rect: { readonly width: number; readonly height: number },
  href: string,
): void {
  requirePositiveFinite(rect.width, `image ${href} width`);
  requirePositiveFinite(rect.height, `image ${href} height`);
}

function requirePositiveFinite(value: number, label: string): void {
  requireFinite(value, label);
  if (value <= 0) throw new Error(`reader session ${label} must be positive.`);
}

function requireFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`reader session ${label} must be finite.`);
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}
