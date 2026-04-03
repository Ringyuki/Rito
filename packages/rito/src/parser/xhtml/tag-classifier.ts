const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'details',
  'dialog',
  'dd',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hgroup',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'ul',
]);

const IGNORED_TAGS = new Set([
  'audio',
  'canvas',
  'embed',
  'iframe',
  'map',
  'math',
  'noscript',
  'object',
  'picture',
  'script',
  'style',
  'svg',
  'template',
  'video',
]);

export type TagClassification = 'block' | 'inline' | 'ignored';

export function classifyTag(tagName: string): TagClassification {
  const lower = tagName.toLowerCase();
  if (BLOCK_TAGS.has(lower)) return 'block';
  if (IGNORED_TAGS.has(lower)) return 'ignored';
  return 'inline';
}
