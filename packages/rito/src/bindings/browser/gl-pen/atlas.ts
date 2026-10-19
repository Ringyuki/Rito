import { cssLandingOn } from './glyph-position';

/** Where a glyph cell sits in the atlas and where its origin is in it, in device pixels. */
export interface GlyphCell {
  readonly u: number;
  readonly v: number;
  readonly width: number;
  readonly height: number;
  readonly originX: number;
  readonly originY: number;
}

/** A cell with no ink (a space): nothing is drawn for it. */
export const EMPTY_CELL: GlyphCell = { u: 0, v: 0, width: 0, height: 0, originX: 0, originY: 0 };

/** How far a cluster's ink reaches from its origin, in device pixels, and its advance in CSS pixels. */
export interface GlyphReach {
  readonly left: number;
  readonly right: number;
  readonly up: number;
  readonly down: number;
  /** How far the canvas moves its pen past the cluster in a string, as it measures it. */
  readonly advance: number;
}

/** One cluster's cells, one per quarter-pixel phase, and how far it reaches. */
export interface GlyphFamily {
  readonly text: string;
  readonly cells: (GlyphCell | undefined)[];
  reach: GlyphReach | undefined;
}

/** The families of one font in one ink at one ratio, and the ink's channels. */
export interface GlyphTable {
  /** The atlas filling the table's cells belong to. */
  readonly generation: number;
  readonly ratio: number;
  readonly font: string;
  readonly ink: string;
  /** The ink as the canvas paints it, 0..255. */
  readonly channels: readonly number[];
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  /**
   * The families of clusters of one UTF-16 code, by the code: 256 pages of
   * 256, a page made when a code in it is first drawn, so a cluster's
   * family is two array reads away.
   */
  readonly byCode: (GlyphFamily | undefined)[][];
  /** The families of longer clusters, by their text. */
  readonly byText: Map<string, GlyphFamily>;
}

/** A row of cells of one height class, rasterized on a canvas of its own until it is full. */
interface Band {
  readonly height: number;
  readonly canvas: OffscreenCanvas;
  readonly context: OffscreenCanvasRenderingContext2D;
  y: number;
  x: number;
  dirty: boolean;
  font: string;
  ink: string;
}

const PAD = 2;
const HEIGHT_CLASS = 8;

/**
 * Glyph cells for the GPU pen: each cluster rasterized by the canvas, in
 * its run's font and ink, at each quarter-pixel phase it is drawn at, so
 * the coverage is the canvas's own. Cells are packed in rows by height;
 * the row being filled is kept on a canvas and uploaded whole. A full
 * atlas is emptied and filled again from what is drawn next.
 */
export class GlyphAtlas {
  readonly texture: WebGLTexture;
  readonly size: number;
  private readonly tables = new Map<string, GlyphTable>();
  private readonly bands = new Map<number, Band>();
  private nextRow = 0;
  private generation = 0;
  private readonly measure: OffscreenCanvasRenderingContext2D;
  private measureFont = '';

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.size = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
    const texture = gl.createTexture();
    this.texture = texture;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, this.size, this.size);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const measure = new OffscreenCanvas(1, 1).getContext('2d');
    if (!measure) throw new Error('The GPU pen could not measure glyphs');
    measure.letterSpacing = '0px';
    measure.wordSpacing = '0px';
    this.measure = measure;
  }

  table(ratio: number, font: string, ink: string, channels: readonly number[]): GlyphTable {
    const key = `${String(ratio)}|${font}|${ink}`;
    let table = this.tables.get(key);
    if (table === undefined) {
      table = {
        generation: this.generation,
        ratio,
        font,
        ink,
        channels,
        red: (channels[0] ?? 0) / 255,
        green: (channels[1] ?? 0) / 255,
        blue: (channels[2] ?? 0) / 255,
        byCode: [],
        byText: new Map(),
      };
      this.tables.set(key, table);
    }
    return table;
  }

  /** The cell of `family` at `phase` quarters, rasterized now if new; undefined when the atlas is full. */
  cell(table: GlyphTable, family: GlyphFamily, phase: number): GlyphCell | undefined {
    const reach = this.reach(table, family);
    const width = reach.left + reach.right;
    const height = reach.up + reach.down;
    if (width <= 2 * PAD + 1 || height <= 2 * PAD + 1) return (family.cells[phase] = EMPTY_CELL);
    const band = this.bandFor(height, width);
    if (band === undefined) return undefined;
    const cell: GlyphCell = {
      u: band.x,
      v: band.y,
      width,
      height,
      originX: reach.left,
      originY: reach.up,
    };
    this.rasterize(band, table, family.text, cell, phase);
    band.x += width;
    family.cells[phase] = cell;
    return cell;
  }

  /** How far a cluster reaches, measured by the canvas the first time it is asked for. */
  reach(table: GlyphTable, family: GlyphFamily): GlyphReach {
    return (family.reach ??= this.reachOf(table, family.text));
  }

  /** Whether a table's cells are still in the atlas. */
  holds(table: GlyphTable): boolean {
    return table.generation === this.generation;
  }

  /** Puts every row that changed into the texture. */
  upload(): void {
    for (const band of this.bands.values()) this.uploadBand(band);
  }

  /** Forgets every cell; the next frame rasterizes what it draws again. */
  reset(): void {
    this.generation += 1;
    this.tables.clear();
    this.bands.clear();
    this.nextRow = 0;
  }

  private reachOf(table: GlyphTable, text: string): GlyphReach {
    if (this.measureFont !== table.font) {
      this.measure.font = table.font;
      this.measureFont = table.font;
    }
    const box = this.measure.measureText(text);
    const device = (value: number): number => Math.ceil(Math.max(0, value) * table.ratio);
    return {
      left: device(box.actualBoundingBoxLeft) + PAD,
      right: device(box.actualBoundingBoxRight) + PAD + 1,
      up: device(box.actualBoundingBoxAscent) + PAD,
      down: device(box.actualBoundingBoxDescent) + PAD + 1,
      advance: box.width,
    };
  }

  private bandFor(height: number, width: number): Band | undefined {
    const rowHeight = Math.ceil(height / HEIGHT_CLASS) * HEIGHT_CLASS;
    if (width > this.size) return undefined;
    let band = this.bands.get(rowHeight);
    if (band !== undefined && band.x + width <= this.size) return band;
    if (this.nextRow + rowHeight > this.size) return undefined;
    if (band === undefined) {
      const canvas = new OffscreenCanvas(this.size, rowHeight);
      const context = canvas.getContext('2d');
      if (!context) return undefined;
      context.textBaseline = 'alphabetic';
      context.letterSpacing = '0px';
      context.wordSpacing = '0px';
      band = { height: rowHeight, canvas, context, y: 0, x: 0, dirty: false, font: '', ink: '' };
      this.bands.set(rowHeight, band);
    } else {
      // The full row goes to the texture before its canvas starts the next.
      this.uploadBand(band);
      band.context.setTransform(1, 0, 0, 1, 0, 0);
      band.context.clearRect(0, 0, band.canvas.width, band.canvas.height);
    }
    band.y = this.nextRow;
    band.x = 0;
    this.nextRow += rowHeight;
    return band;
  }

  private rasterize(
    band: Band,
    table: GlyphTable,
    text: string,
    cell: GlyphCell,
    phase: number,
  ): void {
    const context = band.context;
    const ratio = table.ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (band.font !== table.font) {
      context.font = table.font;
      band.font = table.font;
    }
    if (band.ink !== table.ink) {
      context.fillStyle = table.ink;
      band.ink = table.ink;
    }
    context.save();
    context.beginPath();
    context.rect(cell.u / ratio, 0, cell.width / ratio, cell.height / ratio);
    context.clip();
    context.fillText(
      text,
      cssLandingOn(cell.u + cell.originX + phase / 4, ratio),
      cssLandingOn(cell.originY, ratio),
    );
    context.restore();
    band.dirty = true;
  }

  private uploadBand(band: Band): void {
    if (!band.dirty) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      band.y,
      this.size,
      band.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      band.canvas,
    );
    band.dirty = false;
  }
}
