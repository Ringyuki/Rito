import type { ReaderInteractionTarget, ReaderInteractions } from '@ritojs/core';
import type { WiringDeps } from '../core/wiring-deps';

interface NativeClickCapture {
  readonly interactions: ReaderInteractions;
  readonly generation: number;
}

export function dispatchNativeClickTarget(
  pageIndex: number,
  target: ReaderInteractionTarget,
  deps: WiringDeps,
): void {
  if (target.kind === 'footnote') {
    dispatchFootnote(target, deps);
    return;
  }
  if (target.kind === 'link') {
    dispatchLink(target, deps);
    return;
  }
  if (target.kind === 'image') dispatchImage(pageIndex, target, deps);
}

function dispatchFootnote(target: ReaderInteractionTarget, deps: WiringDeps): void {
  const capture = captureInteraction(deps);
  const key = target.footnoteKey;
  if (!capture || key === undefined) return;
  void capture.interactions
    .getFootnote(key)
    .then((content) => {
      if (!content || !captureIsCurrent(capture, deps)) return;
      deps.emitter.emit('footnoteClick', {
        id: key,
        href: target.href ?? '',
        content,
      });
    })
    .catch((error: unknown) => {
      if (captureIsCurrent(capture, deps)) reportError(error, deps);
    });
}

function dispatchLink(target: ReaderInteractionTarget, deps: WiringDeps): void {
  const href = target.href ?? '';
  if (isExternalHref(href)) {
    const navigate = (): void => {
      if (canOpenExternalHref(href)) window.open(href, '_blank', 'noopener');
    };
    deps.emitter.emit('linkClick', {
      href,
      text: target.label,
      type: 'external',
      navigate,
    });
    return;
  }

  const navigate = (): void => {
    const capture = captureInteraction(deps);
    const locator = target.targetLocator;
    if (!capture || !locator) return;
    void capture.interactions
      .resolveLocator(locator)
      .then((resolution) => {
        if (resolution?.status === 'resolved' && captureIsCurrent(capture, deps)) {
          deps.goToSpread(resolution.spreadIndex);
        }
      })
      .catch((error: unknown) => {
        if (captureIsCurrent(capture, deps)) reportError(error, deps);
      });
  };
  deps.emitter.emit('linkClick', {
    href,
    text: target.label,
    type: 'internal',
    navigate,
  });
}

function isExternalHref(href: string): boolean {
  return href.startsWith('//') || externalScheme(href) !== undefined;
}

function canOpenExternalHref(href: string): boolean {
  if (href.startsWith('//')) return true;
  const scheme = externalScheme(href)?.toLowerCase();
  return scheme === 'http' || scheme === 'https' || scheme === 'mailto' || scheme === 'tel';
}

function externalScheme(href: string): string | undefined {
  const query = href.indexOf('?');
  const fragment = href.indexOf('#');
  const pathEnd = Math.min(query < 0 ? href.length : query, fragment < 0 ? href.length : fragment);
  const path = href.slice(0, pathEnd);
  const colon = path.indexOf(':');
  if (colon <= 0) return undefined;
  for (let index = 0; index < colon; index += 1) {
    const character = path[index];
    if (!character || !isSchemeCharacter(character, index === 0)) return undefined;
  }
  return path.slice(0, colon);
}

function isSchemeCharacter(character: string, first: boolean): boolean {
  const code = character.charCodeAt(0);
  const letter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
  if (first || letter) return letter;
  return (code >= 48 && code <= 57) || character === '+' || character === '-' || character === '.';
}

function dispatchImage(pageIndex: number, target: ReaderInteractionTarget, deps: WiringDeps): void {
  const mapper = deps.coordState.mapper;
  if (!mapper) return;
  const src = target.imageSrc ?? '';
  if (deps.coordState.activeImageBlobUrl) {
    URL.revokeObjectURL(deps.coordState.activeImageBlobUrl);
    deps.coordState.activeImageBlobUrl = null;
  }
  const blobUrl = src ? deps.reader.getImageBlobUrl(src) : undefined;
  if (blobUrl) deps.coordState.activeImageBlobUrl = blobUrl;
  deps.emitter.emit('imageClick', {
    src,
    alt: target.imageAlt ?? '',
    blobUrl,
    screenBounds: mapper.pageContentToScreen(
      pageIndex,
      target.bounds,
      deps.canvas.getBoundingClientRect(),
    ),
  });
}

function reportError(error: unknown, deps: WiringDeps): void {
  deps.emitter.emit('error', {
    message: error instanceof Error ? error.message : String(error),
    source: 'native-interaction',
  });
}

function captureInteraction(deps: WiringDeps): NativeClickCapture | undefined {
  if (!deps.coordState.nativeInteractionsAlive) return undefined;
  const interactions = deps.reader.interactions;
  if (!interactions?.enabled) return undefined;
  return { interactions, generation: deps.coordState.nativeTargetLoadGeneration };
}

function captureIsCurrent(capture: NativeClickCapture, deps: WiringDeps): boolean {
  return (
    deps.coordState.nativeTargetLoadGeneration === capture.generation &&
    deps.coordState.nativeInteractionsAlive &&
    deps.reader.interactions === capture.interactions &&
    capture.interactions.enabled
  );
}
