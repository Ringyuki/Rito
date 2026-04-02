/**
 * Types for parsed XHTML chapter content.
 */

export const NODE_TYPES = {
  Block: 'block',
  Inline: 'inline',
  Text: 'text',
} as const;

export type NodeType = (typeof NODE_TYPES)[keyof typeof NODE_TYPES];

/** A text node containing raw text content. */
export interface TextNode {
  readonly type: typeof NODE_TYPES.Text;
  readonly content: string;
}

/** HTML attributes extracted from an element. */
export interface ElementAttributes {
  readonly class?: string;
  readonly style?: string;
  readonly id?: string;
}

/** An inline element (e.g. <em>, <strong>). */
export interface InlineNode {
  readonly type: typeof NODE_TYPES.Inline;
  readonly tag: string;
  readonly attributes?: ElementAttributes;
  readonly children: readonly DocumentNode[];
}

/** A block-level element (e.g. <p>, <div>, <h1>). */
export interface BlockNode {
  readonly type: typeof NODE_TYPES.Block;
  readonly tag: string;
  readonly attributes?: ElementAttributes;
  readonly children: readonly DocumentNode[];
}

/** Union of all document node types. */
export type DocumentNode = TextNode | InlineNode | BlockNode;
