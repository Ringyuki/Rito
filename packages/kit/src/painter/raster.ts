/**
 * Makes the browser produce the pixels of what was drawn into `canvas`.
 *
 * A canvas records its drawing calls and rasters them the first time it is
 * read as an image. For a page buffer painted ahead of a turn, that first
 * read is the turn's opening frame, which then pays for the whole page.
 * Reading the buffer into one pixel of `scratch` pays for it here instead.
 */
export function rasterNow(canvas: OffscreenCanvas, scratch: OffscreenCanvas): void {
  if (canvas.width === 0 || canvas.height === 0) return;
  const context = scratch.getContext('2d');
  if (!context) return;
  context.drawImage(canvas, 0, 0, 1, 1);
  // Sizing a canvas clears it, so the scratch does not go on holding the
  // buffer's pixels through the call it has just recorded.
  scratch.width = 1;
}
