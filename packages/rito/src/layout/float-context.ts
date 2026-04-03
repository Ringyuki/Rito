/** Tracks active left/right floats for text wrapping. */
export class FloatContext {
  private leftFloat: { bottomY: number; width: number } | undefined;
  private rightFloat: { bottomY: number; width: number } | undefined;

  /** Clear floats that have expired at the given y position. */
  clearExpired(y: number): void {
    if (this.leftFloat && y >= this.leftFloat.bottomY) this.leftFloat = undefined;
    if (this.rightFloat && y >= this.rightFloat.bottomY) this.rightFloat = undefined;
  }

  /** Register a float. */
  addFloat(side: 'left' | 'right', width: number, bottomY: number): void {
    if (side === 'left') {
      this.leftFloat = { bottomY, width };
    } else {
      this.rightFloat = { bottomY, width };
    }
  }

  /** Get the width consumed by left float at y, or 0. */
  getLeftWidth(y: number): number {
    return this.leftFloat && y < this.leftFloat.bottomY ? this.leftFloat.width : 0;
  }

  /** Get the width consumed by right float at y, or 0. */
  getRightWidth(y: number): number {
    return this.rightFloat && y < this.rightFloat.bottomY ? this.rightFloat.width : 0;
  }
}
