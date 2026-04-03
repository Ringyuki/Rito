import type { EpubDocument } from '../runtime/types';
import type { FontFaceRule } from '../style/types';
import { parseFontFaceRules } from '../style/css-rule-parser';
import { buildHrefResolver } from '../utils/resolve-href';
import { createLogger, type Logger } from '../utils/logger';

/**
 * Register EPUB-embedded fonts via the FontFace API.
 *
 * Parses `@font-face` from stylesheets, resolves font data, and adds to `document.fonts`.
 * Call before `paginate()` so text measurement uses the correct fonts.
 *
 * @example
 * ```ts
 * const doc = loadEpub(data);
 * await loadFonts(doc);
 * const measurer = createTextMeasurer(canvas);
 * ```
 */
export async function loadFonts(doc: EpubDocument, logger?: Logger): Promise<void> {
  const log = logger ?? createLogger();
  const fontFaceRules = collectFontFaceRules(doc);
  if (fontFaceRules.length === 0) return;

  const resolve = buildHrefResolver(doc.fonts);
  const promises: Promise<void>[] = [];

  for (const rule of fontFaceRules) {
    const fontData = resolveFontData(rule, resolve);
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
      face
        .load()
        .then(() => {
          document.fonts.add(face);
        })
        .catch((err: unknown) => {
          log.warn(`Failed to load font "${rule.family}":`, err);
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

function resolveFontData(
  rule: FontFaceRule,
  resolve: (src: string) => Uint8Array | undefined,
): Uint8Array | undefined {
  return resolve(rule.src);
}
