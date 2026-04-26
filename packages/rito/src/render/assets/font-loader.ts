import type { EpubDocument } from '../../runtime/types';
import type { FontFaceRule } from '../../style/core/types';
import { parseFontFaceRules } from '../../style/css/rule-parser';
import { buildHrefResolver } from '../../utils/resolve-href';
import { createLogger, type Logger } from '../../utils/logger';
import type { FontRegistry } from './types';

/**
 * Register EPUB-embedded fonts through an injected font registry.
 *
 * Parses `@font-face` from stylesheets, resolves font data, and passes
 * resources to the provided platform registry.
 * Call before `paginate()` so text measurement uses the correct fonts.
 */
export async function loadFontsWithRegistry(
  doc: EpubDocument,
  registry: FontRegistry,
  logger?: Logger,
): Promise<void> {
  const log = logger ?? createLogger();
  const fontFaceRules = collectFontFaceRules(doc);
  if (fontFaceRules.length === 0) return;

  const resolve = buildHrefResolver(doc.fonts);
  const promises: Promise<void>[] = [];

  for (const rule of fontFaceRules) {
    const fontData = resolveFontData(rule, resolve);
    if (!fontData) continue;

    promises.push(
      registry
        .loadFont({
          family: rule.family,
          src: rule.src,
          bytes: fontData,
          ...(rule.weight ? { weight: rule.weight } : {}),
          ...(rule.style ? { style: rule.style } : {}),
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
