import type { CoreRevisionHandle } from './core-contracts';
import type { BrowserReaderState } from './reader/types';

interface ReaderFontFaceInput {
  readonly family: string;
  readonly href: string;
  readonly style?: string | undefined;
  readonly weight?: string | undefined;
}

interface PreparedReaderFontFace {
  readonly key: string;
  readonly face: FontFace;
}

interface FailedReaderFontFace {
  readonly input: ReaderFontFaceInput;
}

export interface BrowserFontFaceRegistry {
  readonly add: (face: FontFace) => void;
  readonly delete: (face: FontFace) => boolean;
}

const unavailableFaces = new WeakMap<BrowserReaderState, Set<string>>();

/** Load only faces referenced by this candidate and remember terminal host failures. */
export async function prepareBrowserReaderRevisionFonts(
  state: BrowserReaderState,
  worker: BrowserReaderState['worker'],
  revision: CoreRevisionHandle,
  isLive: () => boolean,
  fontFamilies: readonly string[] = state.revisionBundle.fontFamilies,
): Promise<boolean> {
  const inputs = readerFontFaceInputs(state, fontFamilies);
  const registry = browserFontFaceRegistry();
  if (typeof FontFace === 'undefined' || !registry) return inputs.length === 0;
  const unavailable = unavailableFontFaces(state);
  const unavailableInput = inputs.find((input) => unavailable.has(fontFaceKey(input)));
  if (unavailableInput) throw referencedFontUnavailable(unavailableInput);
  const pending = inputs.filter((input) => !readerFontFaceIsRegistered(state, input));
  const attempts = await Promise.all(
    pending.map(async (input) => {
      try {
        return (await prepareReaderFontFace(worker, revision, input, isLive)) ?? { input };
      } catch {
        return { input };
      }
    }),
  );
  if (!isLive()) return false;
  const failures = attempts.filter(isFailedReaderFontFace);
  const firstFailure = failures[0];
  if (firstFailure) {
    for (const failure of failures) unavailable.add(fontFaceKey(failure.input));
    throw referencedFontUnavailable(firstFailure.input);
  }
  for (const attempt of attempts) {
    if (isFailedReaderFontFace(attempt)) continue;
    if (!commitReaderFontFace(state, attempt, registry)) {
      unavailable.add(attempt.key);
      const input = pending.find((candidate) => fontFaceKey(candidate) === attempt.key);
      if (input) throw referencedFontUnavailable(input);
    }
  }
  return true;
}

export function unregisterReaderFonts(state: BrowserReaderState): void {
  const registry = browserFontFaceRegistry();
  if (registry) {
    for (const face of state.registeredFontFaces.values()) {
      try {
        registry.delete(face);
      } catch {
        // Font cleanup is best effort and must not block Reader session release.
      }
    }
  }
  state.registeredFontFaces.clear();
  unavailableFaces.delete(state);
}

export function browserFontFaceRegistry(): BrowserFontFaceRegistry | undefined {
  if (typeof document !== 'undefined' && 'fonts' in document) return document.fonts;
  return (globalThis as typeof globalThis & { readonly fonts?: BrowserFontFaceRegistry }).fonts;
}

function readerFontFaceInputs(
  state: BrowserReaderState,
  fontFamilies: readonly string[],
): readonly ReaderFontFaceInput[] {
  if (state.publication.fontFaces.length > 0) {
    const used = referencedFontFamilies(fontFamilies);
    return uniqueFontFaceInputs(
      state.publication.fontFaces.filter((face) => used.has(normalizeFamily(face.family))),
    );
  }
  const family = fontFamilies[0];
  const font = state.publication.resources.fonts[0];
  if (!family || !font || state.publication.resources.fonts.length !== 1) return [];
  return [{ family, href: font.href }];
}

function referencedFontFamilies(values: readonly string[]): ReadonlySet<string> {
  const families = new Set<string>();
  for (const value of values) {
    for (const family of parseFontFamilyList(value)) families.add(normalizeFamily(family));
  }
  return families;
}

function parseFontFamilyList(value: string): readonly string[] {
  const families: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let escaped = false;
  const finish = (): void => {
    const family = current.trim();
    if (family.length > 0) families.push(family);
    current = '';
  };
  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = undefined;
      else current += character;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ',') {
      finish();
    } else {
      current += character;
    }
  }
  if (escaped) current += '\\';
  finish();
  return families;
}

function uniqueFontFaceInputs(
  inputs: readonly ReaderFontFaceInput[],
): readonly ReaderFontFaceInput[] {
  const seen = new Set<string>();
  return inputs.filter((input) => {
    const key = fontFaceKey(input);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function prepareReaderFontFace(
  worker: BrowserReaderState['worker'],
  revision: CoreRevisionHandle,
  input: ReaderFontFaceInput,
  isLive: () => boolean,
): Promise<PreparedReaderFontFace | undefined> {
  const { bytes } = (
    await worker.readResourceAtRevision(coreRevisionHandle(revision), 'font', input.href)
  ).value;
  if (!isLive()) return undefined;
  const face = new FontFace(input.family, ownedArrayBuffer(bytes), fontFaceDescriptors(input));
  await face.load();
  return { key: fontFaceKey(input), face };
}

function isFailedReaderFontFace(
  attempt: PreparedReaderFontFace | FailedReaderFontFace,
): attempt is FailedReaderFontFace {
  return 'input' in attempt;
}

function referencedFontUnavailable(input: ReaderFontFaceInput): Error {
  return new Error(
    `Referenced publication font could not be loaded: ${input.family} (${input.href})`,
  );
}

function readerFontFaceIsRegistered(
  state: BrowserReaderState,
  input: ReaderFontFaceInput,
): boolean {
  return (
    state.registeredFontFaces.has(fontFaceKey(input)) || hasPinnedFontFamily(state, input.family)
  );
}

function hasPinnedFontFamily(state: BrowserReaderState, family: string): boolean {
  const expected = normalizeFamily(family);
  for (const alias of state.pinnedFonts.faces.keys()) {
    if (normalizeFamily(alias) === expected) return true;
  }
  return false;
}

function commitReaderFontFace(
  state: BrowserReaderState,
  prepared: PreparedReaderFontFace,
  registry: BrowserFontFaceRegistry,
): boolean {
  if (state.registeredFontFaces.has(prepared.key)) return true;
  try {
    registry.add(prepared.face);
    state.registeredFontFaces.set(prepared.key, prepared.face);
    return true;
  } catch {
    return false;
  }
}

function unavailableFontFaces(state: BrowserReaderState): Set<string> {
  const existing = unavailableFaces.get(state);
  if (existing) return existing;
  const created = new Set<string>();
  unavailableFaces.set(state, created);
  return created;
}

function fontFaceDescriptors(input: ReaderFontFaceInput): FontFaceDescriptors {
  return {
    ...(input.style !== undefined ? { style: input.style } : {}),
    ...(input.weight !== undefined ? { weight: input.weight } : {}),
  };
}

function fontFaceKey(input: ReaderFontFaceInput): string {
  return [input.family, input.href, input.style ?? '', input.weight ?? ''].join('\u0000');
}

function normalizeFamily(value: string): string {
  return value.trim().replace(/[A-Z]/g, (character) => character.toLowerCase());
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes.buffer;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function coreRevisionHandle(revision: CoreRevisionHandle): CoreRevisionHandle {
  return {
    revisionId: revision.revisionId,
    revisionVersion: revision.revisionVersion,
  };
}
