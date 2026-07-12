import type { ReaderOptions, ReaderPinnedFontPolicy } from '../../reader';
import type {
  BrowserReaderOpenResult,
  BrowserReaderWorkerClient,
  BrowserReaderWorkerOpenOptions,
  BrowserReaderWorkerPinnedFontPolicyInput,
  CorePinnedFontFaceSummary,
  CorePinnedFontPolicySummary,
} from './core-contracts';
import { browserFontFaceRegistry, type BrowserFontFaceRegistry } from './resources';

export type BrowserReaderOwnedPinnedFontPolicy = BrowserReaderWorkerPinnedFontPolicyInput;

export interface BrowserReaderPinnedFonts {
  policy: BrowserReaderOwnedPinnedFontPolicy | undefined;
  readonly summary: CorePinnedFontPolicySummary;
  registry: BrowserFontFaceRegistry | undefined;
  readonly faces: Map<string, FontFace>;
}

export interface BrowserReaderPreparedPinnedFonts {
  readonly policy: BrowserReaderOwnedPinnedFontPolicy | undefined;
  readonly registry: BrowserFontFaceRegistry | undefined;
}

export function readerLayoutOptions(options: ReaderOptions): ReaderOptions {
  const { pinnedFontPolicy: _pinnedFontPolicy, ...layoutOptions } = options;
  return layoutOptions;
}

export function prepareBrowserReaderPinnedFonts(
  input: ReaderPinnedFontPolicy | undefined,
): BrowserReaderPreparedPinnedFonts {
  if (input === undefined) return { policy: undefined, registry: undefined };
  const registry = requirePinnedFontEnvironment();
  return {
    policy: {
      schemaVersion: input.schemaVersion,
      faces: input.faces.map((face, index) => ({
        ...face,
        bytes: ownedFontBuffer(face.bytes, index),
      })),
    },
    registry,
  };
}

export async function openBrowserReaderWorker(
  worker: BrowserReaderWorkerClient,
  data: ArrayBuffer,
  policy: BrowserReaderOwnedPinnedFontPolicy | undefined,
  expectedSummary?: CorePinnedFontPolicySummary,
): Promise<BrowserReaderOpenResult> {
  const options = workerOpenOptions(policy);
  const result = options === undefined ? await worker.open(data) : await worker.open(data, options);
  if (expectedSummary !== undefined)
    requireMatchingPinnedFontSummary(expectedSummary, result.pinnedFontPolicy);
  return result;
}

export async function registerBrowserReaderPinnedFonts(
  prepared: BrowserReaderPreparedPinnedFonts,
  summary: CorePinnedFontPolicySummary,
): Promise<BrowserReaderPinnedFonts> {
  const sources = pinnedFontSources(prepared.policy, summary);
  if (sources.length === 0) return { ...prepared, summary, faces: new Map() };
  const registry = prepared.registry;
  if (!registry) throw new Error('Browser pinned fonts require a FontFaceSet');
  const loaded = await Promise.all(
    sources.map(async ({ source, summary: faceSummary }) => {
      const face = new FontFace(faceSummary.familyAlias, source.bytes, {
        style: faceSummary.style,
        weight: String(faceSummary.weight),
      });
      await face.load();
      return { key: faceSummary.familyAlias, face };
    }),
  );
  const faces = new Map<string, FontFace>();
  try {
    for (const loadedFace of loaded) {
      registry.add(loadedFace.face);
      faces.set(loadedFace.key, loadedFace.face);
    }
  } catch (error) {
    unregisterPinnedFaces(registry, faces);
    throw error;
  }
  return { ...prepared, summary, faces };
}

export function disposeBrowserReaderPinnedFonts(pinned: BrowserReaderPinnedFonts): void {
  if (pinned.registry) unregisterPinnedFaces(pinned.registry, pinned.faces);
  else pinned.faces.clear();
  pinned.policy = undefined;
  pinned.registry = undefined;
}

function workerOpenOptions(
  policy: BrowserReaderOwnedPinnedFontPolicy | undefined,
): BrowserReaderWorkerOpenOptions | undefined {
  if (policy === undefined) return undefined;
  return {
    pinnedFontPolicy: {
      schemaVersion: policy.schemaVersion,
      faces: policy.faces.map((face) => ({ ...face, bytes: face.bytes.slice(0) })),
    },
  };
}

function pinnedFontSources(
  policy: BrowserReaderOwnedPinnedFontPolicy | undefined,
  summary: CorePinnedFontPolicySummary,
): readonly {
  readonly source: BrowserReaderOwnedPinnedFontPolicy['faces'][number];
  readonly summary: CorePinnedFontFaceSummary;
}[] {
  if (policy === undefined) {
    if (summary.faces.length !== 0)
      throw new Error('Browser reader received an unexpected pinned font policy');
    return [];
  }
  const sources = new Map(policy.faces.map((face) => [face.expectedSha256.toLowerCase(), face]));
  if (sources.size !== policy.faces.length || summary.faces.length !== policy.faces.length) {
    throw new Error('Browser reader pinned font summary does not match its request');
  }
  return summary.faces.map((faceSummary) => {
    const source = sources.get(faceSummary.sha256);
    if (!source || !pinnedFontSourceMatchesSummary(source, faceSummary)) {
      throw new Error('Browser reader pinned font summary does not match its request');
    }
    return { source, summary: faceSummary };
  });
}

function pinnedFontSourceMatchesSummary(
  source: BrowserReaderOwnedPinnedFontPolicy['faces'][number],
  summary: CorePinnedFontFaceSummary,
): boolean {
  return (
    source.bytes.byteLength === summary.byteLength &&
    source.genericRole === summary.genericRole &&
    (source.language?.toLowerCase() ?? 'und') === summary.language
  );
}

function requireMatchingPinnedFontSummary(
  expected: CorePinnedFontPolicySummary,
  actual: CorePinnedFontPolicySummary,
): void {
  const matches =
    expected.policyId === actual.policyId &&
    expected.faces.length === actual.faces.length &&
    expected.faces.every((face, index) => pinnedFontFaceSummaryEqual(face, actual.faces[index]));
  if (!matches) throw new Error('Browser reader worker returned a different pinned font policy');
}

function pinnedFontFaceSummaryEqual(
  expected: CorePinnedFontFaceSummary,
  actual: CorePinnedFontFaceSummary | undefined,
): boolean {
  return (
    actual !== undefined &&
    expected.sha256 === actual.sha256 &&
    expected.shapeFingerprint === actual.shapeFingerprint &&
    expected.familyAlias === actual.familyAlias &&
    expected.byteLength === actual.byteLength &&
    expected.genericRole === actual.genericRole &&
    expected.language === actual.language
  );
}

function requirePinnedFontEnvironment(): BrowserFontFaceRegistry {
  const registry = browserFontFaceRegistry();
  if (
    typeof FontFace === 'undefined' ||
    !registry ||
    typeof registry.add !== 'function' ||
    typeof registry.delete !== 'function'
  ) {
    throw new Error('Browser pinned fonts require FontFace and a mutable FontFaceSet');
  }
  return registry;
}

function ownedFontBuffer(bytes: ArrayBuffer, index: number): ArrayBuffer {
  if (!(bytes instanceof ArrayBuffer)) {
    throw new TypeError(`Browser pinned font face ${String(index)} bytes must be an ArrayBuffer`);
  }
  return bytes.slice(0);
}

function unregisterPinnedFaces(
  registry: BrowserFontFaceRegistry,
  faces: Map<string, FontFace>,
): void {
  for (const face of faces.values()) {
    try {
      registry.delete(face);
    } catch {
      // Font cleanup is best effort and must remain idempotent.
    }
  }
  faces.clear();
}
