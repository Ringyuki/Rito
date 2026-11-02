// How the truth page is shot after the root moves a column or a window into
// view.
//
// Moving the root by a margin lets Chromium reuse the raster it already
// holds and redraw only what it judges changed: measured, a 1px pixel column
// of a vertical column kept the ink of the column shot two moves earlier (a
// corner bracket's stroke over the next page's indent), however long the
// shot waited. Taking the root out of layout and back before the move makes
// Chromium lay out and paint the page afresh, and every shot then equals
// the same column shot from a fresh load.
//
// The truth is laid out in the engine's CSS viewport (one page's content
// box), so the right page-margin band, where an unbreakable line's overflow
// ink paints and the engine shows it up to the page edge, lies past the
// view: it is shot with the root moved one margin further left, which
// brings that band into the view's last `margin` columns, and the two shots
// are joined side by side.
import { createRequire } from 'node:module';

const REPO = new URL('../..', import.meta.url).pathname;
const { PNG } = createRequire(`${REPO}package.json`)('pngjs');

/**
 * Moves the root of `page` so the document's point (`x`, `y`) — CSS pixels
 * from its origin — sits at the view's origin, laid out and painted afresh.
 */
export async function moveTruthRoot(page, { x = 0, y = 0, element = 'html' }) {
  await page.evaluate(
    ({ x, y, element }) => {
      const root = document.documentElement;
      root.style.display = 'none';
      void root.offsetHeight;
      root.style.display = '';
      const target = element === 'body' ? document.body : root;
      target.style.marginLeft = x ? `${-x}px` : '';
      target.style.marginTop = y ? `${-y}px` : '';
    },
    { x, y, element },
  );
}

/**
 * The content box and the right margin band of `page` as one PNG,
 * `contentW + margin` CSS pixels wide and `height` tall, with the document's
 * point (`x`, `y`) at the content box's origin.
 */
export async function shootContentWithBand(page, { contentW, height, margin, x = 0, y = 0 }) {
  await moveTruthRoot(page, { x, y });
  const content = PNG.sync.read(
    await page.screenshot({ clip: { x: 0, y: 0, width: contentW, height } }),
  );
  await moveTruthRoot(page, { x: x + margin, y });
  const band = PNG.sync.read(
    await page.screenshot({ clip: { x: contentW - margin, y: 0, width: margin, height } }),
  );
  await moveTruthRoot(page, { x, y });
  const out = new PNG({ width: content.width + band.width, height: content.height });
  for (let row = 0; row < content.height; row += 1) {
    content.data.copy(
      out.data,
      row * out.width * 4,
      row * content.width * 4,
      (row + 1) * content.width * 4,
    );
    if (row < band.height) {
      band.data.copy(
        out.data,
        (row * out.width + content.width) * 4,
        row * band.width * 4,
        (row + 1) * band.width * 4,
      );
    }
  }
  return out;
}
