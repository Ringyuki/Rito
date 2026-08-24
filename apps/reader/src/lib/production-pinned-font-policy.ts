import type { ReaderPinnedFontPolicy } from '@ritojs/core';
import sourceHanSerifCnUrl from '@/assets/fonts/SourceHanSerifCN-Regular.otf?url';
import sourceHanSansCnUrl from '@/assets/fonts/SourceHanSansCN-Regular.otf?url';
import tinosUrl from '@/assets/fonts/Tinos-Regular.ttf?url';
import arimoUrl from '@/assets/fonts/Arimo-Regular.ttf?url';

interface ProductionPinnedFontFaceSource {
  readonly url: string;
  readonly fileName: string;
  readonly byteLength: number;
  readonly expectedSha256: string;
  readonly genericRole: ReaderPinnedFontPolicy['faces'][number]['genericRole'];
  readonly language: string;
}

const TINOS: ProductionPinnedFontFaceSource = {
  url: tinosUrl,
  fileName: 'Tinos-Regular.ttf',
  byteLength: 521_588,
  expectedSha256: '60a0e8ef0c04dd5dd69ffe91025fa2ae5836cbd35600a82ba031977557e2cb61',
  genericRole: 'serif',
  language: 'und',
};

const SOURCE_HAN_SERIF_CN: ProductionPinnedFontFaceSource = {
  url: sourceHanSerifCnUrl,
  fileName: 'SourceHanSerifCN-Regular.otf',
  byteLength: 11_626_108,
  expectedSha256: '3754ea669c530e2473354f8f6d9f79680a44d7e26ec7d00eeabee4a7e0753c5d',
  genericRole: 'serif',
  language: 'zh-Hans',
};

const ARIMO: ProductionPinnedFontFaceSource = {
  url: arimoUrl,
  fileName: 'Arimo-Regular.ttf',
  byteLength: 478_712,
  expectedSha256: '41b22bc8f0b51f932825d37bc55b5eb6ba67dfe599a626e4aff2b43b624f9f8c',
  genericRole: 'sansSerif',
  language: 'und',
};

const SOURCE_HAN_SANS_CN: ProductionPinnedFontFaceSource = {
  url: sourceHanSansCnUrl,
  fileName: 'SourceHanSansCN-Regular.otf',
  byteLength: 8_331_636,
  expectedSha256: 'c0aa89a70f92a820ff95490fea6d472cd19621a71c9a748a4950eb2eafe6438e',
  genericRole: 'sansSerif',
  language: 'zh-Hans',
};

let productionPolicyPromise: Promise<ReaderPinnedFontPolicy> | undefined;

export function loadProductionPinnedFontPolicy(): Promise<ReaderPinnedFontPolicy> {
  productionPolicyPromise ??= createProductionPinnedFontPolicy();
  return productionPolicyPromise;
}

async function createProductionPinnedFontPolicy(): Promise<ReaderPinnedFontPolicy> {
  const [tinosBytes, sourceHanSerifCnBytes, arimoBytes, sourceHanSansCnBytes] = await Promise.all([
    fetchFontBytes(TINOS),
    fetchFontBytes(SOURCE_HAN_SERIF_CN),
    fetchFontBytes(ARIMO),
    fetchFontBytes(SOURCE_HAN_SANS_CN),
  ]);
  const faces = [
    createPolicyFace(TINOS, tinosBytes),
    createPolicyFace(SOURCE_HAN_SERIF_CN, sourceHanSerifCnBytes),
    createPolicyFace(ARIMO, arimoBytes),
    createPolicyFace(SOURCE_HAN_SANS_CN, sourceHanSansCnBytes),
  ];
  return Object.freeze({ schemaVersion: 1, faces: Object.freeze(faces) });
}

function createPolicyFace(
  source: ProductionPinnedFontFaceSource,
  bytes: ArrayBuffer,
): ReaderPinnedFontPolicy['faces'][number] {
  return Object.freeze({
    bytes,
    expectedSha256: source.expectedSha256,
    genericRole: source.genericRole,
    language: source.language,
  });
}

async function fetchFontBytes(source: ProductionPinnedFontFaceSource): Promise<ArrayBuffer> {
  const response = await fetchFontResponse(source);
  if (!response.ok) {
    throw new Error(`Failed to load ${source.fileName}: HTTP ${String(response.status)}`);
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== source.byteLength) {
    throw new Error(
      `Failed to load ${source.fileName}: expected ${String(source.byteLength)} bytes, received ${String(bytes.byteLength)}`,
    );
  }
  await verifyFontSha256(source, bytes);
  return bytes;
}

async function fetchFontResponse(source: ProductionPinnedFontFaceSource): Promise<Response> {
  try {
    return await fetch(source.url);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load ${source.fileName}: ${detail}`, { cause: error });
  }
}

async function verifyFontSha256(
  source: ProductionPinnedFontFaceSource,
  bytes: ArrayBuffer,
): Promise<void> {
  const runtime = globalThis as unknown as { readonly crypto?: Crypto };
  const subtle = runtime.crypto?.subtle;
  if (!subtle) {
    throw new Error(`Failed to verify ${source.fileName}: WebCrypto is unavailable`);
  }
  const digest = await subtle.digest('SHA-256', bytes);
  const actual = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  if (actual !== source.expectedSha256) {
    throw new Error(
      `Failed to verify ${source.fileName}: SHA-256 mismatch; expected ${source.expectedSha256}, received ${actual}`,
    );
  }
}
