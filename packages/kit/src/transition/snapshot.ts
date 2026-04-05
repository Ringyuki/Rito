/** Capture the current contents of the main canvas into the snapshot canvas. */
export function captureSnapshot(
  mainCanvas: HTMLCanvasElement,
  snapshotCanvas: HTMLCanvasElement,
): void {
  const ctx = snapshotCanvas.getContext('2d');
  if (!ctx) return;
  snapshotCanvas.width = mainCanvas.width;
  snapshotCanvas.height = mainCanvas.height;
  snapshotCanvas.style.width = mainCanvas.style.width;
  snapshotCanvas.style.height = mainCanvas.style.height;
  ctx.drawImage(mainCanvas, 0, 0);
}

/** Show the snapshot canvas on top at translateX(0). */
export function showSnapshot(snapshotCanvas: HTMLCanvasElement): void {
  snapshotCanvas.style.display = 'block';
  snapshotCanvas.style.opacity = '1';
  snapshotCanvas.style.transform = 'translateX(0)';
  snapshotCanvas.style.transition = 'none';
}

/** Show the snapshot canvas at a specific initial CSS translateX value. */
export function showSnapshotAt(snapshotCanvas: HTMLCanvasElement, translateX: string): void {
  snapshotCanvas.style.display = 'block';
  snapshotCanvas.style.opacity = '1';
  snapshotCanvas.style.transform = `translateX(${translateX})`;
  snapshotCanvas.style.transition = 'none';
}

/** Set snapshot position and opacity immediately (no CSS transition). Used for finger tracking. */
export function setSnapshotTransform(
  snapshotCanvas: HTMLCanvasElement,
  translateXPx: number,
  opacity: number,
): void {
  snapshotCanvas.style.transition = 'none';
  snapshotCanvas.style.transform = `translateX(${String(translateXPx)}px)`;
  snapshotCanvas.style.opacity = String(opacity);
}

/** Hide the snapshot canvas and reset transforms. */
export function hideSnapshot(snapshotCanvas: HTMLCanvasElement): void {
  snapshotCanvas.style.display = 'none';
  snapshotCanvas.style.opacity = '1';
  snapshotCanvas.style.transform = 'translateX(0)';
  snapshotCanvas.style.transition = 'none';
}
