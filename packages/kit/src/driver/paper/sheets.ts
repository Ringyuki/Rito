import { layLeaf, poseAt, type LeafShape } from './leaf';
import type { Leaf } from './leaves';
import type { PaperSheet } from './renderer';

/** A sheet lying flat: where its points are and how they face. */
interface Lying {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
}

interface Flat {
  readonly shape: LeafShape;
  readonly columns: number;
  readonly rows: number;
  readonly right: Lying;
  readonly left: Lying;
}

/**
 * Says what the sheets of a frame are, from the front of the book to the
 * back: the page lying left that the leaves land on, the leaves in the air
 * in the order they come in the book, and the page lying right that they
 * leave. The first leaf's front is printed on the back of the page lying
 * left; what lies under the last leaf is the page lying right. With one
 * page a spread nothing lies left, and the leaves are pages curled over.
 */
export function createSheets(): (
  book: readonly Leaf[],
  shape: LeafShape,
  columns: number,
  rows: number,
) => PaperSheet[] {
  let flat: Flat | null = null;
  return (book, shape, columns, rows) => {
    flat = flatFor(flat, shape, columns, rows);
    const first = book[0];
    const last = book[book.length - 1];
    const sheets: PaperSheet[] = [];
    if (shape.spine > 0) {
      sheets.push({ ...flat.left, front: null, back: first?.front ?? null, shown: 1, still: true });
    }
    for (const leaf of book) {
      const curl = leaf.curled?.curl;
      sheets.push({
        positions: leaf.positions,
        normals: leaf.normals,
        front: leaf.front,
        // A page curled over shows nothing of the spread it uncovers on its back.
        back: leaf.curled ? null : leaf.after,
        shown: leaf.shown,
        ...(curl ? { curl } : {}),
      });
    }
    sheets.push({ ...flat.right, front: last?.after ?? null, back: null, shown: 0, still: true });
    return sheets;
  };
}

/** The two sheets lying flat for a leaf of this shape on this grid, laid out once. */
function flatFor(kept: Flat | null, shape: LeafShape, columns: number, rows: number): Flat {
  if (
    kept?.shape.spine === shape.spine &&
    kept.shape.width === shape.width &&
    kept.shape.height === shape.height &&
    kept.columns === columns &&
    kept.rows === rows
  ) {
    return kept;
  }
  const lying = (turned: number): Lying => {
    const positions = new Float32Array(columns * rows * 3);
    const normals = new Float32Array(columns * rows * 3);
    layLeaf(shape, poseAt(shape, { u: 1, v: 0.5 }, turned), columns, rows, positions, normals);
    return { positions, normals };
  };
  return { shape, columns, rows, right: lying(0), left: lying(1) };
}
