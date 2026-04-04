interface FloatEntry {
  width: number;
  bottomY: number;
}

export class FloatContext {
  private leftFloats: FloatEntry[] = [];
  private rightFloats: FloatEntry[] = [];

  clearExpired(y: number): void {
    this.leftFloats = this.leftFloats.filter((entry) => y < entry.bottomY);
    this.rightFloats = this.rightFloats.filter((entry) => y < entry.bottomY);
  }

  addFloat(side: 'left' | 'right', width: number, bottomY: number): void {
    const entry: FloatEntry = { width, bottomY };
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
}

function sumActiveWidths(floats: readonly FloatEntry[], y: number): number {
  let total = 0;
  for (const entry of floats) {
    if (y < entry.bottomY) total += entry.width;
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
