interface FloatEntry {
  width: number;
  bottomY: number;
}

/** Tracks active left/right floats for text wrapping. */
export class FloatContext {
  private leftFloats: FloatEntry[] = [];
  private rightFloats: FloatEntry[] = [];

  /** Clear floats that have expired at the given y position. */
  clearExpired(y: number): void {
    this.leftFloats = this.leftFloats.filter((f) => y < f.bottomY);
    this.rightFloats = this.rightFloats.filter((f) => y < f.bottomY);
  }

  /** Register a float on the given side. */
  addFloat(side: 'left' | 'right', width: number, bottomY: number): void {
    const entry: FloatEntry = { width, bottomY };
    if (side === 'left') {
      this.leftFloats.push(entry);
    } else {
      this.rightFloats.push(entry);
    }
  }

  /** Get the total width consumed by all active left floats at y. */
  getLeftWidth(y: number): number {
    return sumActiveWidths(this.leftFloats, y);
  }

  /** Get the total width consumed by all active right floats at y. */
  getRightWidth(y: number): number {
    return sumActiveWidths(this.rightFloats, y);
  }

  /** Get the Y position needed to clear past the specified float side(s). */
  getClearY(clear: 'left' | 'right' | 'both'): number {
    const leftY = maxBottomY(this.leftFloats);
    const rightY = maxBottomY(this.rightFloats);
    if (clear === 'left') return leftY;
    if (clear === 'right') return rightY;
    return Math.max(leftY, rightY);
  }
}

function sumActiveWidths(floats: readonly FloatEntry[], y: number): number {
  let total = 0;
  for (const f of floats) {
    if (y < f.bottomY) total += f.width;
  }
  return total;
}

function maxBottomY(floats: readonly FloatEntry[]): number {
  let max = 0;
  for (const f of floats) {
    if (f.bottomY > max) max = f.bottomY;
  }
  return max;
}
