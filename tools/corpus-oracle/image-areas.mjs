// Where the truth page draws bitmap images, so a walk can count the
// beyond-floor pixels outside them apart. Canvas and DOM resample a scaled
// bitmap differently on the GPU (Δ up to ~53 per channel, no renderer can
// match the compositor's mip chain), so inside an image the diff measures
// the two rasterizers, not the engine. Each area is the image's DRAWN
// rectangle (object-fit / preserveAspectRatio applied) shrunk by one CSS
// pixel on every side: an image placed or sized wrongly still differs
// along its edges, which stay counted.

/**
 * The drawn image areas of a multicol truth chapter loaded in `page`, in
 * column-local CSS px: `{ column, left, top, right, bottom }`. Columns step
 * by `step` (column width plus gap) from the root's left edge.
 */
export async function collectImageAreas(page, { step }) {
  return page.evaluate(async (step) => {
    const areas = [];
    const push = (rect) => {
      if (rect.width <= 2 || rect.height <= 2) return;
      const column = Math.floor(rect.left / step);
      const x = column * step;
      areas.push({
        column,
        left: rect.left - x + 1,
        top: rect.top + 1,
        right: rect.right - x - 1,
        bottom: rect.bottom - 1,
      });
    };
    // A bitmap of `natural` size fitted into `box` the way `fit` and the
    // centred default position place it.
    const fitted = (box, natural, fit) => {
      if (!natural.width || !natural.height || fit === 'fill' || fit === 'cover') return box;
      let scale = Math.min(box.width / natural.width, box.height / natural.height);
      if (fit === 'none') scale = 1;
      if (fit === 'scale-down') scale = Math.min(scale, 1);
      const width = natural.width * scale;
      const height = natural.height * scale;
      const left = box.left + (box.width - width) / 2;
      const top = box.top + (box.height - height) / 2;
      return { left, top, right: left + width, bottom: top + height, width, height };
    };
    const contentBox = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const n = (name) => parseFloat(cs.getPropertyValue(name)) || 0;
      const left = r.left + n('border-left-width') + n('padding-left');
      const top = r.top + n('border-top-width') + n('padding-top');
      const right = r.right - n('border-right-width') - n('padding-right');
      const bottom = r.bottom - n('border-bottom-width') - n('padding-bottom');
      return { left, top, right, bottom, width: right - left, height: bottom - top };
    };
    for (const img of document.querySelectorAll('img')) {
      if (!img.complete || !img.naturalWidth) continue;
      const fit = getComputedStyle(img).objectFit;
      push(fitted(contentBox(img), { width: img.naturalWidth, height: img.naturalHeight }, fit));
    }
    for (const image of document.querySelectorAll('image')) {
      const href = image.getAttribute('href') ?? image.getAttribute('xlink:href');
      if (!href) continue;
      const bitmap = new Image();
      bitmap.src = new URL(href, document.baseURI).href;
      await bitmap.decode().catch(() => undefined);
      const box = image.getBoundingClientRect();
      const ratio = (image.getAttribute('preserveAspectRatio') ?? '').trim();
      const fit = ratio === 'none' ? 'fill' : ratio.endsWith('slice') ? 'cover' : 'contain';
      push(fitted(box, { width: bitmap.naturalWidth, height: bitmap.naturalHeight }, fit));
    }
    for (const el of document.querySelectorAll('body, body *')) {
      if (!getComputedStyle(el).backgroundImage.includes('url(')) continue;
      for (const rect of el.getClientRects()) push(rect);
    }
    return areas;
  }, step);
}

/**
 * A device-pixel mask of one page: 1 where a pixel lies inside an image
 * area of `column`, the column placed at the content origin.
 */
export function imageMask(areas, column, { pageWd, pageHd, marginD, dsf }) {
  const mask = new Uint8Array(pageWd * pageHd);
  for (const area of areas) {
    if (area.column !== column) continue;
    const x0 = Math.max(0, Math.ceil(marginD + area.left * dsf));
    const x1 = Math.min(pageWd, Math.floor(marginD + area.right * dsf));
    const y0 = Math.max(0, Math.ceil(marginD + area.top * dsf));
    const y1 = Math.min(pageHd, Math.floor(marginD + area.bottom * dsf));
    for (let y = y0; y < y1; y += 1) mask.fill(1, y * pageWd + x0, y * pageWd + x1);
  }
  return mask;
}
