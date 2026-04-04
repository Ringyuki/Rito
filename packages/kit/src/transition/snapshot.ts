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

/** Show the snapshot canvas on top. */
export function showSnapshot(snapshotCanvas: HTMLCanvasElement): void {
  snapshotCanvas.style.display = 'block';
  snapshotCanvas.style.opacity = '1';
  snapshotCanvas.style.transform = 'translateX(0)';
  snapshotCanvas.style.transition = 'none';
}

/** Hide the snapshot canvas and reset transforms. */
export function hideSnapshot(snapshotCanvas: HTMLCanvasElement): void {
  snapshotCanvas.style.display = 'none';
  snapshotCanvas.style.opacity = '1';
  snapshotCanvas.style.transform = 'translateX(0)';
  snapshotCanvas.style.transition = 'none';
}
