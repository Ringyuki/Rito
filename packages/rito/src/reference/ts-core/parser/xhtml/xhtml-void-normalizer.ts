const HTML_VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);
const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);

interface ScannedTag {
  readonly end: number;
  readonly name: string;
  readonly closing: boolean;
  readonly selfClosing: boolean;
}

interface VoidCandidate {
  readonly insertionIndex: number;
  closed: boolean;
}

interface OpenElement {
  readonly name: string;
  readonly candidate?: VoidCandidate;
}

/** Self-close unpaired HTML void tags without interpreting arbitrary source text as HTML. */
export function normalizeLegacyVoidElements(source: string): string {
  const insertionIndices = findUnpairedVoidElements(source);
  if (insertionIndices.length === 0) return source;

  let cursor = 0;
  const result: string[] = [];
  for (const insertionIndex of insertionIndices) {
    result.push(source.slice(cursor, insertionIndex), '/');
    cursor = insertionIndex;
  }
  result.push(source.slice(cursor));
  return result.join('');
}

/** Count the characters that legacy void-tag normalization will insert. */
export function countLegacyVoidElementInsertions(source: string): number {
  return findUnpairedVoidElements(source).length;
}

function findUnpairedVoidElements(source: string): number[] {
  const candidates: VoidCandidate[] = [];
  const stack: OpenElement[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    const start = source.indexOf('<', cursor);
    if (start < 0) break;

    const protectedEnd = findProtectedSectionEnd(source, start);
    if (protectedEnd !== undefined) {
      cursor = protectedEnd;
      continue;
    }

    const tag = scanTag(source, start);
    if (!tag) {
      cursor = start + 1;
      continue;
    }

    if (!tag.closing && !tag.selfClosing && RAW_TEXT_ELEMENTS.has(tag.name)) {
      cursor = findRawTextElementEnd(source, tag);
      continue;
    }

    updateElementStack(tag, stack, candidates);
    cursor = tag.end;
  }

  return candidates.filter((candidate) => !candidate.closed).map((item) => item.insertionIndex);
}

function updateElementStack(
  tag: ScannedTag,
  stack: OpenElement[],
  candidates: VoidCandidate[],
): void {
  if (tag.selfClosing) return;
  if (tag.closing) {
    const open = stack.at(-1);
    if (open?.name !== tag.name) return;
    stack.pop();
    if (open.candidate) open.candidate.closed = true;
    return;
  }

  const candidate = HTML_VOID_ELEMENTS.has(tag.name)
    ? { insertionIndex: tag.end - 1, closed: false }
    : undefined;
  if (candidate) candidates.push(candidate);
  stack.push(candidate ? { name: tag.name, candidate } : { name: tag.name });
}

function scanTag(source: string, start: number): ScannedTag | undefined {
  let cursor = start + 1;
  const closing = source[cursor] === '/';
  if (closing) cursor++;

  const nameStart = cursor;
  while (cursor < source.length && !isTagNameBoundary(source[cursor])) cursor++;
  if (cursor === nameStart) return undefined;

  const end = findTagEnd(source, cursor);
  if (end === undefined) return undefined;
  const name = source.slice(nameStart, cursor);
  return { end, name, closing, selfClosing: isSelfClosingTag(source, end) };
}

function findTagEnd(source: string, start: number): number | undefined {
  let quote: '"' | "'" | undefined;
  for (let cursor = start; cursor < source.length; cursor++) {
    const character = source[cursor];
    if (quote) {
      if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return cursor + 1;
    }
  }
  return undefined;
}

function isTagNameBoundary(character: string | undefined): boolean {
  return character === undefined || /[\s/>]/.test(character);
}

function isSelfClosingTag(source: string, end: number): boolean {
  let cursor = end - 2;
  while (cursor >= 0 && /\s/.test(source[cursor] ?? '')) cursor--;
  return source[cursor] === '/';
}

function findProtectedSectionEnd(source: string, start: number): number | undefined {
  if (source.startsWith('<!--', start)) return findDelimitedEnd(source, start + 4, '-->');
  if (source.startsWith('<![CDATA[', start)) return findDelimitedEnd(source, start + 9, ']]>');
  if (source.startsWith('<?', start)) return findDelimitedEnd(source, start + 2, '?>');
  if (source.startsWith('<!', start)) return findDeclarationEnd(source, start + 2);
  return undefined;
}

function findDelimitedEnd(source: string, start: number, delimiter: string): number {
  const end = source.indexOf(delimiter, start);
  return end < 0 ? source.length : end + delimiter.length;
}

function findDeclarationEnd(source: string, start: number): number {
  let quote: '"' | "'" | undefined;
  let subsetDepth = 0;
  for (let cursor = start; cursor < source.length; cursor++) {
    const character = source[cursor];
    if (quote) {
      if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '[') {
      subsetDepth++;
    } else if (character === ']') {
      subsetDepth = Math.max(0, subsetDepth - 1);
    } else if (character === '>' && subsetDepth === 0) {
      return cursor + 1;
    }
  }
  return source.length;
}

function findRawTextElementEnd(source: string, openingTag: ScannedTag): number {
  let cursor = openingTag.end;
  const closingPrefix = `</${openingTag.name}`;
  while (cursor < source.length) {
    const start = source.indexOf(closingPrefix, cursor);
    if (start < 0) return source.length;
    const tag = scanTag(source, start);
    if (tag?.closing && tag.name === openingTag.name) return tag.end;
    cursor = start + closingPrefix.length;
  }
  return source.length;
}
