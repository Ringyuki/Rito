interface FloatEntry {
  width: number;
  startY: number;
  bottomY: number;
}

export class FloatContext {
  private leftFloats: FloatEntry[] = [];
  private rightFloats: FloatEntry[] = [];

  clearExpired(y: number): void {
    this.leftFloats = this.leftFloats.filter((entry) => y < entry.bottomY);
    this.rightFloats = this.rightFloats.filter((entry) => y < entry.bottomY);
  }

  addFloat(side: 'left' | 'right', width: number, startY: number, bottomY: number): void {
    const entry: FloatEntry = { width, startY, bottomY };
    if (side === 'left') {
      this.leftFloats.push(entry);
    } else {
      this.rightFloats.push(entry);
    }
  }

  getLeftWidth(y: number): number {
    return sumActiveWidths(this.leftFloats, y);
  }

  getRightWidth(y: number): number {
    return sumActiveWidths(this.rightFloats, y);
  }

  getClearY(clear: 'left' | 'right' | 'both'): number {
    const leftY = maxBottomY(this.leftFloats);
    const rightY = maxBottomY(this.rightFloats);
    if (clear === 'left') return leftY;
    if (clear === 'right') return rightY;
    return Math.max(leftY, rightY);
  }

  /** Return the highest startY among all placed floats, or 0 if none. */
  getMaxStartY(): number {
    let max = 0;
    for (const entry of this.leftFloats) {
      if (entry.startY > max) max = entry.startY;
    }
    for (const entry of this.rightFloats) {
      if (entry.startY > max) max = entry.startY;
    }
    return max;
  }

  /** Maximum total width of left floats active at any y in [fromY, toY). */
  getMaxLeftWidthInRange(fromY: number, toY: number): number {
    return maxWidthInRange(this.leftFloats, fromY, toY);
  }

  /** Maximum total width of right floats active at any y in [fromY, toY). */
  getMaxRightWidthInRange(fromY: number, toY: number): number {
    return maxWidthInRange(this.rightFloats, fromY, toY);
  }

  /** Return the lowest bottomY among all floats active at y, or y if none active. */
  getNextClearance(y: number): number {
    let minBottom = Infinity;
    for (const entry of this.leftFloats) {
      if (y >= entry.startY && y < entry.bottomY) minBottom = Math.min(minBottom, entry.bottomY);
    }
    for (const entry of this.rightFloats) {
      if (y >= entry.startY && y < entry.bottomY) minBottom = Math.min(minBottom, entry.bottomY);
    }
    return minBottom === Infinity ? y : minBottom;
  }
}

/**
 * Sub-pixel tolerance for float overlap checks. Font metrics (ascent/descent)
 * can make a float's rendered height slightly larger than fontSize × lineHeight.
 * Without tolerance, a 0.96px gap between two floats can flip which column a
 * subsequent float lands in, producing visually different layouts from browsers.
 */
const FLOAT_TOLERANCE = 1;

/** Sum widths of floats whose vertical range [startY, bottomY) includes y. */
function sumActiveWidths(floats: readonly FloatEntry[], y: number): number {
  let total = 0;
  for (const entry of floats) {
    if (y >= entry.startY && y < entry.bottomY + FLOAT_TOLERANCE) total += entry.width;
  }
  return total;
}

/**
 * Maximum total width of floats active at any y in [fromY, toY).
 * Checks at each float boundary within the range (where active sets change).
 */
function maxWidthInRange(floats: readonly FloatEntry[], fromY: number, toY: number): number {
  let max = sumActiveWidths(floats, fromY);
  for (const entry of floats) {
    // Check at each float's startY within range (where a new float becomes active)
    if (entry.startY > fromY && entry.startY < toY) {
      max = Math.max(max, sumActiveWidths(floats, entry.startY));
    }
  }
  return max;
}

function maxBottomY(floats: readonly FloatEntry[]): number {
  let max = 0;
  for (const entry of floats) {
    if (entry.bottomY > max) max = entry.bottomY;
  }
  return max;
}
