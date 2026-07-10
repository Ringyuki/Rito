/** Parser-private XML tree types. These deliberately expose no DOM interfaces. */

export const XML_NODE_TYPES = {
  ELEMENT: 'element',
  TEXT: 'text',
  CDATA: 'cdata',
} as const;

export interface XmlAttribute {
  readonly qualifiedName: string;
  readonly localName: string;
  readonly prefix: string;
  readonly namespaceUri: string;
  readonly value: string;
}

export interface XmlElement {
  readonly type: typeof XML_NODE_TYPES.ELEMENT;
  readonly qualifiedName: string;
  readonly localName: string;
  readonly prefix: string;
  readonly namespaceUri: string;
  readonly attributes: readonly XmlAttribute[];
  readonly children: readonly XmlNode[];
}

export interface XmlText {
  readonly type: typeof XML_NODE_TYPES.TEXT;
  readonly value: string;
}

export interface XmlCdata {
  readonly type: typeof XML_NODE_TYPES.CDATA;
  readonly value: string;
}

export type XmlNode = XmlElement | XmlText | XmlCdata;

export interface XmlDocument {
  readonly root: XmlElement;
}
