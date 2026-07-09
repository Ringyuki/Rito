import type { DocumentNode, ElementAttributes } from '../parser/xhtml/types';
import type { SelectorTarget } from '../style/cascade/selector-matcher';
import { resolveStyles } from '../style/cascade/resolver';
import { DEFAULT_STYLE } from '../style/core/defaults';
import type { ComputedStyle, CssRule } from '../style/core/types';
import { fontShorthandFromStyle } from '../style/css/font-shorthand';
import type { Viewport } from '../style/css/parse-utils';
import { applyBodyPresentationalAttrs } from './body-presentational-attrs';

export interface ChapterRootStyles {
  readonly htmlFontSize: number;
  readonly bodyStyle: ComputedStyle;
  readonly ancestors: readonly SelectorTarget[];
}

/** Resolve omitted html/body wrappers through the same cascade as chapter nodes. */
export function computeChapterRootStyles(
  rules: readonly CssRule[],
  initialRootFontSize: number,
  bodyAttributes: ElementAttributes | undefined,
  viewport: Viewport,
): ChapterRootStyles {
  const initialStyle = styleWithFontSize(DEFAULT_STYLE, initialRootFontSize);
  const body: DocumentNode = {
    type: 'block',
    tag: 'body',
    ...(bodyAttributes ? { attributes: bodyAttributes } : {}),
    children: [],
  };
  const html: DocumentNode = { type: 'block', tag: 'html', children: [body] };
  const resolvedHtml = resolveStyles([html], initialStyle, rules, viewport, {
    rootFontSize: initialRootFontSize,
  })[0];
  const resolvedBody = resolvedHtml?.children[0];
  let bodyStyle = resolvedBody?.style ?? initialStyle;
  if (bodyAttributes && !bodyStyle.backgroundColor) {
    bodyStyle = applyBodyPresentationalAttrs(bodyStyle, bodyAttributes);
  }
  return {
    htmlFontSize: resolvedHtml?.style.fontSize ?? initialRootFontSize,
    bodyStyle,
    ancestors: [selectorTarget('body', bodyAttributes), selectorTarget('html')],
  };
}

function styleWithFontSize(style: ComputedStyle, fontSize: number): ComputedStyle {
  const sized = { ...style, fontSize };
  return { ...sized, font: fontShorthandFromStyle(sized) };
}

function selectorTarget(tag: string, attrs?: ElementAttributes): SelectorTarget {
  return {
    tag,
    ...(attrs?.class ? { className: attrs.class } : {}),
    ...(attrs?.id ? { id: attrs.id } : {}),
    ...(attrs?.allAttributes ? { attributes: attrs.allAttributes } : {}),
  };
}
