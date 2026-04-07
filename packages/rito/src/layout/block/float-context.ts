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

/** Sum widths of floats whose vertical range [startY, bottomY) includes y. */
function sumActiveWidths(floats: readonly FloatEntry[], y: number): number {
  let total = 0;
  for (const entry of floats) {
    if (y >= entry.startY && y < entry.bottomY) total += entry.width;
  }
  return total;
}

function maxBottomY(floats: readonly FloatEntry[]): number {
  let max = 0;
  for (const entry of floats) {
    if (entry.bottomY > max) max = entry.bottomY;
  }
  return max;
}
