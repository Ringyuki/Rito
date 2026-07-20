import type { CoreFrameCommand } from './core-contracts';

interface ImageDimensionsV1 {
  readonly width: number;
  readonly height: number;
}

interface ImageUseV1 {
  decodeScale(sourceWidth: number, sourceHeight: number): number;
}

type BlockCommand = Extract<CoreFrameCommand, { readonly kind: 'paintBlock' }>;
type TransformCommand = Extract<CoreFrameCommand, { readonly kind: 'transform' }>;

export class BrowserReaderCanvasImageTargetPlanV1 {
  private constructor(private readonly usesByHref: ReadonlyMap<string, readonly ImageUseV1[]>) {}

  get hrefs(): readonly string[] {
    return [...this.usesByHref.keys()];
  }

  targetFor(
    href: string,
    sourceWidth: number,
    sourceHeight: number,
    bucketSize: number,
  ): ImageDimensionsV1 {
    const uses = this.usesByHref.get(href);
    if (!uses?.length) throw new Error(`Image is not required by this display list: ${href}`);
    let scale = 0;
    for (const use of uses) scale = Math.max(scale, use.decodeScale(sourceWidth, sourceHeight));
    if (!Number.isFinite(scale) || scale <= 0) {
      throw new Error(`Reader v1 image ${href} has an invalid paint target.`);
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

  static collect(
    commands: readonly CoreFrameCommand[],
    pixelRatio: number,
  ): BrowserReaderCanvasImageTargetPlanV1 {
    requirePositiveFinite(pixelRatio, 'pixelRatio');
    const collector = new ImageTargetCollectorV1(pixelRatio);
    collector.collect(commands);
    return new BrowserReaderCanvasImageTargetPlanV1(collector.usesByHref);
  }
}

class ImageTargetCollectorV1 {
  readonly usesByHref = new Map<string, ImageUseV1[]>();
  private readonly stack: LinearTransformV1[] = [LinearTransformV1.identity()];

  constructor(private readonly pixelRatio: number) {}

  collect(commands: readonly CoreFrameCommand[]): void {
    for (const command of commands) this.collectCommand(command);
    if (this.stack.length !== 1) throw new Error('Reader v1 display state is unbalanced.');
  }

  private collectCommand(command: CoreFrameCommand): void {
    if (command.kind === 'pushState') this.stack.push(this.transform);
    else if (command.kind === 'popState') this.popState();
    else if (command.kind === 'translate') this.validateTranslate(command.dx, command.dy);
    else if (command.kind === 'transform') this.applyTransform(command);
    else if (command.kind === 'paintImage') this.addDirect(command.src, command.rect);
    else if (command.kind === 'paintBlock') this.addBackground(command);
  }

  private get transform(): LinearTransformV1 {
    const value = this.stack.at(-1);
    if (!value) throw new Error('Reader v1 display state is empty.');
    return value;
  }

  private popState(): void {
    if (this.stack.length === 1) throw new Error('Reader v1 display restore is unbalanced.');
    this.stack.pop();
  }

  private applyTransform(command: TransformCommand): void {
    requireFinite(command.origin.x, 'transform origin x');
    requireFinite(command.origin.y, 'transform origin y');
    requireFinite(command.box.width, 'transform box width');
    requireFinite(command.box.height, 'transform box height');
    let next = this.transform;
    for (const operation of command.transforms) {
      if (operation.kind === 'rotate') {
        requireFinite(operation.rad, 'rotation');
        next = next.rotate(operation.rad);
      } else if (operation.kind === 'scale') {
        requireFinite(operation.sx, 'scale x');
        requireFinite(operation.sy, 'scale y');
        next = next.scale(operation.sx, operation.sy);
      } else {
        requireFinite(operation.x.value, 'transform translation x');
        requireFinite(operation.y.value, 'transform translation y');
      }
    }
    this.stack[this.stack.length - 1] = next;
  }

  private addDirect(href: string, rect: { readonly width: number; readonly height: number }): void {
    requireHref(href);
    requireRect(rect, href);
    const transform = this.transform;
    this.add(href, {
      decodeScale: (sourceWidth, sourceHeight) =>
        Math.max(
          (rect.width * transform.xScale * this.pixelRatio) / sourceWidth,
          (rect.height * transform.yScale * this.pixelRatio) / sourceHeight,
        ),
    });
  }

  private addBackground(hrefCommand: BlockCommand): void {
    const background = hrefCommand.paint.background;
    const href = background?.image;
    if (!background || href === undefined) return;
    requireHref(href);
    requireRect(hrefCommand.rect, href);
    const transform = this.transform;
    this.add(href, backgroundUse(hrefCommand, transform, this.pixelRatio));
  }

  private add(href: string, use: ImageUseV1): void {
    const uses = this.usesByHref.get(href);
    if (uses) uses.push(use);
    else this.usesByHref.set(href, [use]);
  }

  private validateTranslate(dx: number, dy: number): void {
    requireFinite(dx, 'translation x');
    requireFinite(dy, 'translation y');
  }
}

function backgroundUse(
  command: BlockCommand,
  transform: LinearTransformV1,
  pixelRatio: number,
): ImageUseV1 {
  const background = command.paint.background;
  if (!background) throw new Error('Reader v1 background image paint is missing.');
  return {
    decodeScale(sourceWidth, sourceHeight) {
      // The generic Canvas renderer derives CSS auto-size from bitmap.width / height.
      // Keeping the intrinsic bitmap avoids changing layout geometry when a transform shrinks it.
      if (background.size === undefined || background.size === 'auto') return 1;
      const widthScale = command.rect.width / sourceWidth;
      const heightScale = command.rect.height / sourceHeight;
      const cssScale =
        background.size === 'cover'
          ? Math.max(widthScale, heightScale)
          : Math.min(widthScale, heightScale);
      const drawWidth = sourceWidth * cssScale;
      const drawHeight = sourceHeight * cssScale;
      return Math.max(
        (drawWidth * transform.xScale * pixelRatio) / sourceWidth,
        (drawHeight * transform.yScale * pixelRatio) / sourceHeight,
      );
    },
  };
}

class LinearTransformV1 {
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

  scale(sx: number, sy: number): LinearTransformV1 {
    return new LinearTransformV1(this.a * sx, this.b * sx, this.c * sy, this.d * sy);
  }

  rotate(radians: number): LinearTransformV1 {
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    return new LinearTransformV1(
      this.a * cosine + this.c * sine,
      this.b * cosine + this.d * sine,
      -this.a * sine + this.c * cosine,
      -this.b * sine + this.d * cosine,
    );
  }

  static identity(): LinearTransformV1 {
    return new LinearTransformV1(1, 0, 0, 1);
  }
}

function requireHref(href: string): void {
  if (!href) throw new Error('Reader v1 display list image href is empty.');
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
  if (value <= 0) throw new Error(`Reader v1 ${label} must be positive.`);
}

function requireFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`Reader v1 ${label} must be finite.`);
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}
