import type { ElementAttributes, ImageNode, TextNode } from '../../parser/xhtml/types';
import type { ComputedStyle, CssRule, StyledNode } from '../core/types';
import { fontShorthandFromStyle } from '../css/font-shorthand';
import type { Viewport } from '../css/parse-utils';
import { applyRuntimeElementDefaults } from './runtime-element-defaults';
import type { RuleIndex } from './rule-index';
import type { SelectorTarget } from './selector-matcher';
import { applyUnifiedRules } from './unified-rules';

export interface TreeResolutionContext {
  readonly parentStyle: ComputedStyle;
  readonly rules: readonly CssRule[] | undefined;
  readonly index: RuleIndex | undefined;
  readonly ancestors: readonly SelectorTarget[];
  readonly rootFontSize: number;
  readonly viewport: Viewport | undefined;
}

export interface SiblingInfo {
  readonly siblingIndex: number;
  readonly siblingCount: number;
  readonly previousSibling?: SelectorTarget;
}

interface ResolvedElement {
  readonly target: SelectorTarget;
  readonly style: ComputedStyle;
}

export function resolveTextNode(node: TextNode, parentStyle: ComputedStyle): StyledNode {
  return {
    type: 'text',
    content: node.content,
    ...(node.sourceText !== undefined ? { sourceText: node.sourceText } : {}),
    style: parentStyle,
    children: [],
    ...(node.sourceRef ? { sourceRef: node.sourceRef } : {}),
  };
}

export function resolveImageNode(
  node: ImageNode,
  context: TreeResolutionContext,
  siblingInfo?: SiblingInfo,
): StyledNode {
  const { style } = resolveElement('img', node.attributes, context, siblingInfo);
  return {
    type: 'image',
    src: node.src,
    alt: node.alt,
    style,
    children: [],
    ...(node.sourceRef ? { sourceRef: node.sourceRef } : {}),
  };
}

export function resolveElement(
  tag: string,
  attributes: ElementAttributes | undefined,
  context: TreeResolutionContext,
  siblingInfo?: SiblingInfo,
): ResolvedElement {
  const target = buildSelectorTarget(tag, attributes, siblingInfo);
  const style = applyLanguage(applyCascade(target, attributes?.style, context), attributes);
  return { target, style };
}

export function buildSelectorTarget(
  tag: string,
  attributes: ElementAttributes | undefined,
  siblingInfo?: SiblingInfo,
): SelectorTarget {
  const target: SelectorTarget = {
    tag,
    ...(attributes?.class ? { className: attributes.class } : {}),
    ...(attributes?.id ? { id: attributes.id } : {}),
    ...(attributes?.allAttributes ? { attributes: attributes.allAttributes } : {}),
  };
  return siblingInfo ? mergeSiblingInfo(target, siblingInfo) : target;
}

function mergeSiblingInfo(target: SelectorTarget, info: SiblingInfo): SelectorTarget {
  return {
    ...target,
    siblingIndex: info.siblingIndex,
    siblingCount: info.siblingCount,
    ...(info.previousSibling ? { previousSibling: info.previousSibling } : {}),
  };
}

function applyCascade(
  target: SelectorTarget,
  inlineCss: string | undefined,
  context: TreeResolutionContext,
): ComputedStyle {
  let style = applyRuntimeElementDefaults(context.parentStyle, target.tag);
  style = applyUnifiedRules(
    style,
    target,
    context.parentStyle.fontSize,
    context.rules,
    context.index,
    context.ancestors,
    inlineCss,
    context.rootFontSize,
    context.viewport,
  );
  return finalizeStyle(style);
}

function applyLanguage(
  style: ComputedStyle,
  attributes: ElementAttributes | undefined,
): ComputedStyle {
  return attributes?.language ? { ...style, language: attributes.language.toLowerCase() } : style;
}

/** Assemble paint-ready fields after all cascade sources have been merged. */
function finalizeStyle(style: ComputedStyle): ComputedStyle {
  return { ...style, font: fontShorthandFromStyle(style) };
}
