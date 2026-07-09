import { DOMParser } from '@xmldom/xmldom';

/** Parse XML/XHTML without relying on a browser-global DOMParser. */
export function parseXmlDocument(
  source: string,
  mimeType: string,
  errorFactory: (details: string) => Error,
): Document {
  const errors: string[] = [];
  const parser = new DOMParser({
    errorHandler: {
      warning: (message: unknown): void => {
        errors.push(String(message));
      },
      error: (message: unknown): void => {
        errors.push(String(message));
      },
      fatalError: (message: unknown): void => {
        errors.push(String(message));
      },
    },
  });
  const document = parser.parseFromString(source, mimeType) as unknown as Document | undefined;
  const documentElement = (
    document as unknown as { readonly documentElement?: Element | null } | undefined
  )?.documentElement;
  if (!document || errors.length > 0 || !documentElement) {
    throw errorFactory(errors[0] ?? 'missing document element');
  }
  return document;
}

/** DOM Level 2 compatible direct element-child traversal. */
export function childElements(parent: Node): Element[] {
  const elements: Element[] = [];
  for (let index = 0; index < parent.childNodes.length; index++) {
    const child = parent.childNodes[index];
    if (child?.nodeType === 1) elements.push(child as Element);
  }
  return elements;
}
