import type { ComputedStyle, StyledNode } from '../../style/core/types';
import { DISPLAY_VALUES } from '../../style/core/types';
import { createImageAtom, createInlineBlockAtom } from './styled-segment-atoms';
import {
  applyTextTransform,
  buildInlineChildContext,
  patchInheritedStyle,
  type SegmentCollectionContext,
} from './styled-segment-context';
import type { InlineAtomSegment, InlineSegment, StyledSegment } from './styled-segment';

export function collectSegments(
  nodes: readonly StyledNode[],
  out: InlineSegment[],
  context: SegmentCollectionContext,
): void {
  for (const node of nodes) collectSegmentNode(node, out, context);
}

function collectSegmentNode(
  node: StyledNode,
  out: InlineSegment[],
  context: SegmentCollectionContext,
): void {
  switch (node.type) {
    case 'text':
      collectTextSegment(node, out, context);
      break;
    case 'inline':
      collectInlineSegments(node, out, context);
      break;
    case 'image':
      collectImageSegment(node, out, context);
      break;
    case 'block':
      collectInlineBlockSegment(node, out, context);
      break;
  }
}

function collectTextSegment(
  node: StyledNode,
  out: InlineSegment[],
  context: SegmentCollectionContext,
): void {
  const content = node.content ?? '';
  if (content.length === 0) return;
  const style = patchInheritedStyle(node.style, context);
  const normalized = normalizeTextForWhiteSpace(node, style, context);
  if (normalized.text.length === 0) return;
  const seg: StyledSegment = {
    text: applyTextTransform(normalized.text, style),
    style,
    ...(node.sourceRef
      ? {
          sourceRef: node.sourceRef,
          sourceText: normalized.sourceText,
          ...(normalized.sourceTextOffset > 0
            ? { sourceTextOffset: normalized.sourceTextOffset }
            : {}),
        }
      : {}),
  };
  out.push(context.href ? { ...seg, href: context.href } : seg);
}

function normalizeTextForWhiteSpace(
  node: StyledNode,
  style: ComputedStyle,
  context: SegmentCollectionContext,
): { readonly text: string; readonly sourceText: string; readonly sourceTextOffset: number } {
  const content = node.content ?? '';
  const preserve = style.whiteSpace === 'pre' || style.whiteSpace === 'pre-wrap';
  const sourceText = preserve ? (node.sourceText ?? content) : content;
  let text = sourceText;
  let sourceTextOffset = 0;

  // A synthetic newline produced by <br> is a forced break under every
  // white-space mode and must not participate in ordinary space collapsing.
  const forcedBreak = content === '\n' && node.sourceText === undefined;
  if (!preserve && !forcedBreak && context.whitespace?.previousEndedWithSpace) {
    if (text.startsWith(' ')) {
      text = text.slice(1);
      sourceTextOffset = 1;
    }
  }

  if (context.whitespace) {
    if (preserve || forcedBreak) context.whitespace.previousEndedWithSpace = false;
    else if (text.length > 0) context.whitespace.previousEndedWithSpace = text.endsWith(' ');
  }
  return { text, sourceText, sourceTextOffset };
}

function collectInlineSegments(
  node: StyledNode,
  out: InlineSegment[],
  context: SegmentCollectionContext,
): void {
  if (node.tag === 'ruby') {
    collectRubySegments(node, out, context);
    return;
  }

  const child = buildInlineChildContext(node, context);
  const beforeLen = out.length;
  collectSegments(node.children, out, child.context);
  markInlineFragments(out, beforeLen, node, child.hasOwnBorders);
}

function collectImageSegment(
  node: StyledNode,
  out: InlineSegment[],
  context: SegmentCollectionContext,
): void {
  let atom = createImageAtom(node, context.imageSizes);
  if (context.href) atom = { ...atom, href: context.href };
  if (context.verticalAlign && node.style.verticalAlign === 'baseline') {
    out.push({ ...atom, style: { ...atom.style, verticalAlign: context.verticalAlign } });
  } else {
    out.push(atom);
  }
  if (context.whitespace) context.whitespace.previousEndedWithSpace = false;
}

function collectInlineBlockSegment(
  node: StyledNode,
  out: InlineSegment[],
  context: SegmentCollectionContext,
): void {
  if (node.style.display !== DISPLAY_VALUES.InlineBlock) return;
  out.push(createInlineBlockAtom(node));
  if (context.whitespace) context.whitespace.previousEndedWithSpace = false;
}

function markInlineFragments(
  out: InlineSegment[],
  beforeLen: number,
  node: StyledNode,
  hasOwnBorders: boolean,
): void {
  const hasInlineMargin = node.style.marginLeft > 0 || node.style.marginRight > 0;
  if ((!hasOwnBorders && !hasInlineMargin) || out.length <= beforeLen) return;

  const range = findTextSegmentRange(out, beforeLen);
  if (!range) return;
  const first = out[range.first] as StyledSegment;
  out[range.first] = {
    ...first,
    ...(hasOwnBorders ? { borderStart: true } : {}),
    ...(node.style.marginLeft > 0 ? { inlineMarginLeft: node.style.marginLeft } : {}),
  };
  const last = out[range.last] as StyledSegment;
  out[range.last] = {
    ...last,
    ...(hasOwnBorders ? { borderEnd: true } : {}),
    ...(node.style.marginRight > 0 ? { inlineMarginRight: node.style.marginRight } : {}),
  };
}

function findTextSegmentRange(
  out: readonly InlineSegment[],
  start: number,
): { readonly first: number; readonly last: number } | undefined {
  let first = -1;
  let last = -1;
  for (let index = start; index < out.length; index++) {
    if (!isInlineAtomSegment(out[index] as InlineSegment)) {
      if (first < 0) first = index;
      last = index;
    }
  }
  return first >= 0 ? { first, last } : undefined;
}

function collectRubySegments(
  ruby: StyledNode,
  out: InlineSegment[],
  context: SegmentCollectionContext,
): void {
  let pendingBaseNodes: StyledNode[] = [];
  const flushBase = (annotation: string): void => {
    const baseSegments = flushRubyBase(pendingBaseNodes, annotation, context);
    for (const seg of baseSegments) out.push(seg);
    pendingBaseNodes = [];
  };

  for (const child of ruby.children) {
    if (child.type === 'text') {
      pendingBaseNodes.push(child);
    } else if (child.type === 'inline') {
      pendingBaseNodes = handleRubyInlineChild(child, pendingBaseNodes, flushBase);
    }
  }
  flushBase('');
}

function flushRubyBase(
  pendingBaseNodes: readonly StyledNode[],
  annotation: string,
  context: SegmentCollectionContext,
): InlineSegment[] {
  if (pendingBaseNodes.length === 0) return [];
  const baseSegments: InlineSegment[] = [];
  collectSegments(pendingBaseNodes, baseSegments, {
    href: context.href,
    bgColor: context.bgColor,
    verticalAlign: context.verticalAlign,
    whitespace: context.whitespace,
  });
  return annotation ? attachRubyAnnotation(baseSegments, annotation) : baseSegments;
}

function handleRubyInlineChild(
  child: StyledNode,
  pendingBaseNodes: readonly StyledNode[],
  flushBase: (annotation: string) => void,
): StyledNode[] {
  if (child.tag === 'rt') {
    flushBase(extractText(child));
    return [];
  }
  if (child.tag === 'rp') return [...pendingBaseNodes];
  if (child.tag === 'rb') {
    flushBase('');
    return [...child.children];
  }
  return [...pendingBaseNodes, child];
}

function attachRubyAnnotation(
  baseSegments: readonly InlineSegment[],
  annotation: string,
): InlineSegment[] {
  return baseSegments.map((seg) =>
    isInlineAtomSegment(seg) ? seg : { ...seg, rubyAnnotation: annotation },
  );
}

function extractText(node: StyledNode): string {
  if (node.type === 'text') return node.content ?? '';
  let result = '';
  for (const child of node.children) result += extractText(child);
  return result;
}

function isInlineAtomSegment(segment: InlineSegment): segment is InlineAtomSegment {
  return 'width' in segment;
}
