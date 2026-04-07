// Parsed XHTML document tree types.

/** A stable reference to a position in the parsed XHTML tree. */
export interface SourceRef {
  /** Deterministic path from root: each entry is the child index at that depth. */
  readonly nodePath: readonly number[];
}

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
  readonly sourceRef?: SourceRef;
}

/** HTML attributes extracted from an element. */
export interface ElementAttributes {
  readonly class?: string;
  readonly style?: string;
  readonly id?: string;
  readonly href?: string;
  readonly colspan?: number;
  readonly rowspan?: number;
  /** All raw attributes for CSS attribute selector matching. */
  readonly allAttributes?: ReadonlyMap<string, string>;
}

/** An inline element (e.g. <em>, <strong>). */
export interface InlineNode {
  readonly type: typeof NODE_TYPES.Inline;
  readonly tag: string;
  readonly attributes?: ElementAttributes;
  readonly children: readonly DocumentNode[];
  readonly sourceRef?: SourceRef;
}

/** A block-level element (e.g. <p>, <div>, <h1>). */
export interface BlockNode {
  readonly type: typeof NODE_TYPES.Block;
  readonly tag: string;
  readonly attributes?: ElementAttributes;
  readonly children: readonly DocumentNode[];
  readonly sourceRef?: SourceRef;
}

/** An image element. */
export interface ImageNode {
  readonly type: 'image';
  readonly src: string;
  readonly alt: string;
  readonly attributes?: ElementAttributes;
  readonly sourceRef?: SourceRef;
}

/** Union of all document node types. */
export type DocumentNode = TextNode | InlineNode | BlockNode | ImageNode;
