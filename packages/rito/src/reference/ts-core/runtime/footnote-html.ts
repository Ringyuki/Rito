import type { DocumentNode, ElementAttributes } from '../parser/xhtml/types';

const ALLOWED_TAGS = new Set([
  'a',
  'abbr',
  'address',
  'b',
  'bdi',
  'bdo',
  'blockquote',
  'cite',
  'code',
  'dd',
  'del',
  'dfn',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'ins',
  'kbd',
  'li',
  'mark',
  'ol',
  'p',
  'pre',
  'q',
  'rp',
  'rt',
  'ruby',
  's',
  'samp',
  'section',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'u',
  'ul',
  'var',
]);

const GLOBAL_ATTRIBUTES = new Set([
  'aria-describedby',
  'aria-hidden',
  'aria-label',
  'class',
  'dir',
  'id',
  'lang',
  'role',
  'title',
  'xml:lang',
]);

const TAG_ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
  a: new Set(['href']),
  blockquote: new Set(['cite']),
  del: new Set(['cite', 'datetime']),
  img: new Set(['alt', 'height', 'src', 'width']),
  ins: new Set(['cite', 'datetime']),
  li: new Set(['value']),
  ol: new Set(['reversed', 'start', 'type']),
  q: new Set(['cite']),
  td: new Set(['colspan', 'headers', 'rowspan']),
  th: new Set(['colspan', 'headers', 'rowspan', 'scope']),
  time: new Set(['datetime']),
};

const URL_ATTRIBUTES = new Set(['cite', 'href', 'src']);
const NUMERIC_ATTRIBUTES = new Set(['colspan', 'height', 'rowspan', 'start', 'value', 'width']);
const URI_SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i;

/** Serialize a parser tree as an allowlist-sanitized HTML fragment. */
export function serializeFootnoteHtml(nodes: readonly DocumentNode[]): string {
  const parts: string[] = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      parts.push(escapeHtml(node.content));
      continue;
    }
    if (node.type === 'image') {
      parts.push(`<img${serializeAttributes('img', node.attributes)}>`);
      continue;
    }

    const tag = node.tag.toLowerCase();
    const children = serializeFootnoteHtml(node.children);
    if (!ALLOWED_TAGS.has(tag)) {
      parts.push(children);
      continue;
    }
    parts.push(`<${tag}${serializeAttributes(tag, node.attributes)}>${children}</${tag}>`);
  }
  return parts.join('');
}

function serializeAttributes(tag: string, attrs: ElementAttributes | undefined): string {
  if (!attrs?.allAttributes) return '';
  const tagAttributes = TAG_ATTRIBUTES[tag];
  const parts: string[] = [];
  for (const [rawName, rawValue] of attrs.allAttributes) {
    const name = rawName.toLowerCase();
    if (!GLOBAL_ATTRIBUTES.has(name) && !tagAttributes?.has(name)) continue;
    const value = sanitizeAttribute(name, rawValue);
    if (value === undefined) continue;
    parts.push(` ${name}="${escapeAttribute(value)}"`);
  }
  return parts.join('');
}

function sanitizeAttribute(name: string, value: string): string | undefined {
  if (URL_ATTRIBUTES.has(name)) return isSafeUrl(value, name === 'src') ? value.trim() : undefined;
  if (NUMERIC_ATTRIBUTES.has(name))
    return /^\d{1,6}$/.test(value.trim()) ? value.trim() : undefined;
  if (name === 'dir') return /^(auto|ltr|rtl)$/i.test(value.trim()) ? value.trim() : undefined;
  if (name === 'scope') {
    return /^(col|colgroup|row|rowgroup)$/i.test(value.trim()) ? value.trim() : undefined;
  }
  if (name === 'reversed') return 'reversed';
  return value;
}

function isSafeUrl(value: string, isSource: boolean): boolean {
  const normalized = value.trim();
  if (!normalized || normalized.startsWith('//') || hasUnsafeUrlCharacter(normalized)) {
    return false;
  }
  const scheme = URI_SCHEME_RE.exec(normalized)?.[1]?.toLowerCase();
  if (!scheme) return true;
  if (scheme === 'http' || scheme === 'https') return true;
  return !isSource && (scheme === 'mailto' || scheme === 'tel');
}

function hasUnsafeUrlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
