export function requirePageTargetSemantics(target, operation) {
  requireDestinationLabelSemantics(target, operation);
  if (target.kind === 'footnote' || target.kind === 'footnotePending') {
    if (target.href === undefined || target.footnoteKey === undefined) {
      throw new Error(`${operation} returned an incomplete footnote target`);
    }
    if (target.targetLocator === undefined) {
      throw new Error(`${operation} returned a footnote target without a destination`);
    }
    return;
  }
  if (target.footnoteKey !== undefined) {
    throw new Error(`${operation} returned a footnote key for a non-footnote target`);
  }
  if (target.kind === 'link' && target.href === undefined) {
    throw new Error(`${operation} returned a link target without href`);
  }
  if (target.kind === 'image' && target.imageSrc === undefined) {
    throw new Error(`${operation} returned an image target without imageSrc`);
  }
  if (
    target.kind === 'image' &&
    (target.href !== undefined || target.targetLocator !== undefined)
  ) {
    throw new Error(`${operation} returned link fields on a standalone image target`);
  }
  if (
    target.kind === 'text' &&
    (target.href !== undefined ||
      target.targetLocator !== undefined ||
      target.imageSrc !== undefined)
  ) {
    throw new Error(`${operation} returned interactive fields on a text target`);
  }
}

function requireDestinationLabelSemantics(target, operation) {
  if (target.destinationLabel === undefined) return;
  if (target.kind !== 'link' || target.targetLocator === undefined || isExternalHref(target.href)) {
    throw new Error(`${operation} returned a destination label for a non-internal link target`);
  }
}

function isExternalHref(href) {
  if (typeof href !== 'string') return false;
  if (href.startsWith('//')) return true;
  const query = href.indexOf('?');
  const fragment = href.indexOf('#');
  const pathEnd = Math.min(query < 0 ? href.length : query, fragment < 0 ? href.length : fragment);
  const path = href.slice(0, pathEnd);
  const colon = path.indexOf(':');
  if (colon <= 0) return false;
  for (let index = 0; index < colon; index += 1) {
    const character = path[index];
    if (!character || !isSchemeCharacter(character, index === 0)) return false;
  }
  return true;
}

function isSchemeCharacter(character, first) {
  const code = character.charCodeAt(0);
  const letter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
  if (first || letter) return letter;
  return (code >= 48 && code <= 57) || character === '+' || character === '-' || character === '.';
}
