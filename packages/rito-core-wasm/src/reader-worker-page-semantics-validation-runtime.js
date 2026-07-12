const PAGE_FIELDS = new Set(['revisionId', 'pageIndex', 'spreadIndex', 'nodes']);
const NODE_FIELDS = new Set(['role', 'level', 'text', 'alt', 'href', 'bounds', 'children']);
const BOUNDS_FIELDS = new Set(['x', 'y', 'width', 'height']);
const SEMANTIC_ROLES = new Set([
  'heading',
  'paragraph',
  'list',
  'listitem',
  'image',
  'link',
  'blockquote',
  'table',
  'generic',
]);

export function requirePageSemantics(value, revision, pageIndex, operation) {
  const semantics = requireExactRecord(value, PAGE_FIELDS, `${operation} page semantics`);
  if (semantics.revisionId !== revision.revisionId) {
    throw new Error(`${operation} returned a mismatched revisionId`);
  }
  if (semantics.pageIndex !== pageIndex) {
    throw new Error(`${operation} returned a mismatched pageIndex`);
  }
  requireCount(semantics.spreadIndex, `${operation} spreadIndex`);
  if (!Array.isArray(semantics.nodes)) {
    throw new Error(`${operation} returned malformed semantic nodes`);
  }
  const active = new WeakSet();
  for (const node of semantics.nodes) requireSemanticNode(node, operation, active);
  return semantics;
}

function requireSemanticNode(value, operation, active) {
  const node = requireExactRecord(value, NODE_FIELDS, `${operation} semantic node`);
  if (active.has(node)) throw new Error(`${operation} returned cyclic semantic children`);
  active.add(node);
  if (!SEMANTIC_ROLES.has(node.role)) {
    throw new Error(`${operation} returned an invalid semantic role`);
  }
  requireLevel(node, operation);
  requireOptionalText(node, operation);
  requireAlt(node, operation);
  requireHref(node, operation);
  requireBounds(node.bounds, operation);
  if (!Array.isArray(node.children)) {
    throw new Error(`${operation} returned malformed semantic children`);
  }
  if (node.role === 'image' && node.children.length > 0) {
    throw new Error(`${operation} returned semantic children on an image`);
  }
  for (const child of node.children) requireSemanticNode(child, operation, active);
  active.delete(node);
}

function requireLevel(node, operation) {
  if (node.role === 'heading') {
    if (!Number.isSafeInteger(node.level) || node.level < 1 || node.level > 6) {
      throw new Error(`${operation} returned an invalid heading level`);
    }
    return;
  }
  if (node.level !== undefined) {
    throw new Error(`${operation} returned a heading level on a non-heading node`);
  }
}

function requireOptionalText(node, operation) {
  if (node.text !== undefined && typeof node.text !== 'string') {
    throw new Error(`${operation} returned invalid semantic text`);
  }
  if (node.role === 'image' && node.text !== undefined) {
    throw new Error(`${operation} returned semantic text on an image`);
  }
}

function requireAlt(node, operation) {
  if (node.alt === undefined) return;
  if (typeof node.alt !== 'string') {
    throw new Error(`${operation} returned an invalid semantic alt`);
  }
  if (node.role !== 'image') {
    throw new Error(`${operation} returned semantic alt on a non-image node`);
  }
}

function requireHref(node, operation) {
  if (node.role === 'link') {
    if (typeof node.href !== 'string' || node.href.trim().length === 0) {
      throw new Error(`${operation} returned a link without non-empty href`);
    }
    return;
  }
  if (node.href !== undefined) {
    throw new Error(`${operation} returned semantic href on a non-link node`);
  }
}

function requireBounds(value, operation) {
  const bounds = requireExactRecord(value, BOUNDS_FIELDS, `${operation} semantic bounds`);
  for (const field of ['x', 'y']) {
    if (!Number.isFinite(bounds[field])) {
      throw new Error(`${operation} returned an invalid semantic bounds ${field}`);
    }
  }
  for (const field of ['width', 'height']) {
    if (!Number.isFinite(bounds[field]) || bounds[field] < 0) {
      throw new Error(`${operation} returned an invalid semantic bounds ${field}`);
    }
  }
}

function requireExactRecord(value, allowedFields, operation) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${operation} must be an object`);
  }
  for (const field of Reflect.ownKeys(value)) {
    if (typeof field !== 'string' || !allowedFields.has(field)) {
      throw new Error(`${operation} returned unknown field ${String(field)}`);
    }
  }
  return value;
}

function requireCount(value, operation) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${operation} must be a non-negative safe integer`);
  }
}
