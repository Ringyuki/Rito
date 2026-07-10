import type { LayoutConfig } from './ts-core/layout/core/types';
import type { ParseResult } from './ts-core/parser/xhtml/xhtml-parser';
import type { CssRule } from './ts-core/style/core/types';
import {
  buildChapterStyleTree,
  type PreparedChapterStyleContext,
  type ResolvedChapterStyleTree,
} from './ts-core/runtime/pagination-core';
import {
  buildStylesheetRuleMap,
  buildStylesheetRules,
} from './ts-core/runtime/pagination-stylesheets';

/** Internal stylesheet context used only by the TypeScript parity-fixture exporter. */
export interface FixtureChapterStyleContext extends PreparedChapterStyleContext {
  readonly rules: readonly CssRule[];
}

export function createFixtureChapterStyleContext(
  stylesheets: ReadonlyMap<string, string>,
  rootFontSize: number,
): FixtureChapterStyleContext {
  return {
    rules: buildStylesheetRules(stylesheets, rootFontSize),
    rulesByStylesheet: buildStylesheetRuleMap(stylesheets, rootFontSize),
    rootFontSize,
  };
}

/**
 * Resolve a parsed chapter through the exact style path used by pagination.
 * This is deliberately exported only from the internal reference entrypoint.
 */
export function resolveFixtureChapterStyleTree(
  parsed: ParseResult,
  config: LayoutConfig,
  context: FixtureChapterStyleContext,
): ResolvedChapterStyleTree {
  return buildChapterStyleTree(
    parsed.nodes,
    config,
    context,
    parsed.bodyAttributes,
    parsed.stylesheetHrefs,
    parsed.embeddedStylesheets,
  );
}
