/** Normalize parser output while preserving absent metadata versus explicit empty lists. */
export function normalizeParseResult(result) {
  return {
    bodyAttributes: normalizeAttributes(result.bodyAttributes),
    embeddedStylesheets: result.embeddedStylesheets ? [...result.embeddedStylesheets] : null,
    nodes: result.nodes.map((node) => normalizeXhtmlNode(node)),
    stylesheetHrefs: result.stylesheetHrefs ? [...result.stylesheetHrefs] : null,
    warnings: [...result.warnings],
  };
}

export function normalizeSourceRef(sourceRef) {
  return sourceRef ? { nodePath: [...sourceRef.nodePath] } : null;
}

function normalizeXhtmlNode(node) {
  const sourceRef = normalizeSourceRef(node.sourceRef);
  if (node.type === 'text') {
    return { content: node.content, sourceRef, type: node.type };
  }
  if (node.type === 'image') {
    return {
      alt: node.alt,
      attributes: normalizeAttributes(node.attributes),
      sourceRef,
      src: node.src,
      type: node.type,
    };
  }
  return {
    attributes: normalizeAttributes(node.attributes),
    children: node.children.map((child) => normalizeXhtmlNode(child)),
    sourceRef,
    tag: node.tag,
    type: node.type,
  };
}

function normalizeAttributes(attributes) {
  if (!attributes) return null;
  return {
    allAttributes: attributes.allAttributes
      ? Object.fromEntries(
          [...attributes.allAttributes.entries()].sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        )
      : null,
    class: attributes.class ?? null,
    colspan: attributes.colspan ?? null,
    href: attributes.href ?? null,
    id: attributes.id ?? null,
    language: attributes.language ?? null,
    rowspan: attributes.rowspan ?? null,
    style: attributes.style ?? null,
  };
}
