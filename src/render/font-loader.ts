import type { EpubDocument } from '../runtime/types';
import type { FontFaceRule } from '../style/types';
import { parseFontFaceRules } from '../style/css-rule-parser';

/**
 * Load and register EPUB-embedded fonts in the browser.
 *
 * Parses `@font-face` rules from the EPUB's stylesheets, resolves font file
 * references against the loaded font data, and registers them via the
 * `FontFace` API so they are available for canvas text measurement and rendering.
 *
 * Must be called before `paginate()` / `createTextMeasurer()` to ensure
 * text measurement uses the correct fonts.
 *
 * @param doc - A loaded {@link EpubDocument} from {@link loadEpub}.
 * @returns A promise that resolves when all fonts are loaded and registered.
 *
 * @example
 * ```ts
 * const doc = loadEpub(data);
 * await loadFonts(doc);
 * const measurer = createTextMeasurer(canvas);
 * ```
 */
export async function loadFonts(doc: EpubDocument): Promise<void> {
  const fontFaceRules = collectFontFaceRules(doc);
  if (fontFaceRules.length === 0) return;

  const promises: Promise<void>[] = [];

  for (const rule of fontFaceRules) {
    const fontData = resolveFontData(rule, doc);
    if (!fontData) continue;

    const descriptors: FontFaceDescriptors = {};
    if (rule.weight) descriptors.weight = rule.weight;
    if (rule.style) descriptors.style = rule.style;

    const buffer = fontData.buffer.slice(
      fontData.byteOffset,
      fontData.byteOffset + fontData.byteLength,
    );
    const face = new FontFace(rule.family, buffer as ArrayBuffer, descriptors);
    promises.push(
      face.load().then(() => {
        document.fonts.add(face);
      }),
    );
  }

  await Promise.all(promises);
}

function collectFontFaceRules(doc: EpubDocument): FontFaceRule[] {
  const rules: FontFaceRule[] = [];
  for (const css of doc.stylesheets.values()) {
    rules.push(...parseFontFaceRules(css));
  }
  return rules;
}

/**
 * Resolve a @font-face src URL to font binary data from the EPUB.
 *
 * The src is relative to the CSS file's location within the EPUB.
 * Since we store fonts by their manifest href (relative to the OPF directory),
 * we need to normalize the path.
 */
function resolveFontData(rule: FontFaceRule, doc: EpubDocument): Uint8Array | undefined {
  // Try direct match first (fonts keyed by href relative to OPF dir)
  for (const [href, data] of doc.fonts) {
    if (rule.src.endsWith(href) || href.endsWith(rule.src)) {
      return data;
    }
    // Match by filename
    const ruleName = rule.src.split('/').pop();
    const hrefName = href.split('/').pop();
    if (ruleName && hrefName && ruleName === hrefName) {
      return data;
    }
  }
  return undefined;
}
