import type { ReaderInteractionTarget, ReaderInteractions } from '@ritojs/core';
import type { WiringDeps } from '../core/wiring-deps';
import type { ReaderControllerEvents } from '../types';
import { dispatchImageResourceClick, supersedePendingImageRequest } from './image-click';

interface NativeClickCapture {
  readonly interactions: ReaderInteractions;
  readonly targetGeneration: number;
  readonly contentInteractionGeneration: number;
}

export function dispatchNativeClickTarget(
  pageIndex: number,
  target: ReaderInteractionTarget,
  deps: WiringDeps,
): void {
  supersedePendingImageRequest(deps);
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
  runCapturedInteraction(
    capture,
    deps,
    () => capture.interactions.getFootnote(key),
    (content) => {
      if (!content) return;
      emitNativeClickEvent(
        'footnoteClick',
        {
          id: key,
          href: target.href ?? '',
          content,
        },
        'native-footnote-publication',
        deps,
      );
    },
  );
}

function dispatchLink(target: ReaderInteractionTarget, deps: WiringDeps): void {
  const href = target.href ?? '';
  if (isExternalHref(href)) {
    dispatchExternalLink(target, href, deps);
    return;
  }
  dispatchInternalLink(target, href, deps);
}

function dispatchExternalLink(
  target: ReaderInteractionTarget,
  href: string,
  deps: WiringDeps,
): void {
  const navigate = (): void => {
    if (canOpenExternalHref(href)) window.open(href, '_blank', 'noopener');
  };
  emitNativeClickEvent(
    'linkClick',
    { href, text: target.label, type: 'external', navigate },
    'native-link-publication',
    deps,
  );
}

function dispatchInternalLink(
  target: ReaderInteractionTarget,
  href: string,
  deps: WiringDeps,
): void {
  const navigate = (): void => {
    supersedePendingImageRequest(deps);
    const capture = captureInteraction(deps);
    const locator = target.targetLocator;
    if (!capture || !locator) return;
    runCapturedInteraction(
      capture,
      deps,
      () => capture.interactions.resolveLocator(locator),
      (resolution) => {
        if (!resolution) return;
        if (resolution.status === 'resolved') {
          deps.goToSpread(resolution.spreadIndex);
          return;
        }
        deps.navigateToLocator(locator);
      },
    );
  };
  emitNativeClickEvent(
    'linkClick',
    {
      href,
      text: target.label,
      type: 'internal',
      resolvedLabel: target.destinationLabel,
      navigate,
    },
    'native-link-publication',
    deps,
  );
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
  dispatchImageResourceClick(
    {
      src: target.imageSrc ?? '',
      alt: target.imageAlt ?? '',
      screenBounds: mapper.pageContentToScreen(
        pageIndex,
        target.bounds,
        deps.canvas.getBoundingClientRect(),
      ),
    },
    mapper,
    deps,
  );
}

function emitNativeClickEvent<K extends 'footnoteClick' | 'linkClick'>(
  event: K,
  payload: ReaderControllerEvents[K],
  failureSource: string,
  deps: WiringDeps,
): void {
  try {
    deps.emitter.emit(event, payload);
  } catch (error: unknown) {
    containReportedError(error, failureSource, deps);
  }
}

function reportError(error: unknown, source: string, deps: WiringDeps): void {
  deps.emitter.emit('error', {
    message: error instanceof Error ? error.message : String(error),
    source,
  });
}

function containReportedError(error: unknown, source: string, deps: WiringDeps): void {
  try {
    reportError(error, source, deps);
  } catch {
    // Consumer error listeners must not escape native event publication.
  }
}

function runCapturedInteraction<T>(
  capture: NativeClickCapture,
  deps: WiringDeps,
  read: () => Promise<T>,
  install: (value: T) => void,
): void {
  let task: Promise<T>;
  try {
    task = Promise.resolve(read());
  } catch (error) {
    task = Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
  void task
    .then((value) => {
      if (captureIsCurrent(capture, deps)) install(value);
    })
    .catch((error: unknown) => {
      containInteractionFailure(error, capture, deps);
    });
}

function containInteractionFailure(
  error: unknown,
  capture: NativeClickCapture,
  deps: WiringDeps,
): void {
  if (!captureIsCurrent(capture, deps)) return;
  containReportedError(error, 'native-interaction', deps);
}

function captureInteraction(deps: WiringDeps): NativeClickCapture | undefined {
  if (!deps.coordState.nativeInteractionsAlive) return undefined;
  const interactions = deps.reader.interactions;
  if (!interactions?.enabled) return undefined;
  return {
    interactions,
    targetGeneration: deps.coordState.nativeTargetLoadGeneration,
    contentInteractionGeneration: deps.coordState.contentInteractionGeneration,
  };
}

function captureIsCurrent(capture: NativeClickCapture, deps: WiringDeps): boolean {
  return (
    deps.coordState.nativeTargetLoadGeneration === capture.targetGeneration &&
    deps.coordState.contentInteractionGeneration === capture.contentInteractionGeneration &&
    deps.coordState.nativeInteractionsAlive &&
    deps.reader.interactions === capture.interactions &&
    capture.interactions.enabled
  );
}
