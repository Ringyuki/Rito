import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';

const GENERIC_ROLES = new Set(['serif', 'sansSerif', 'monospace']);
const POLICY_KEYS = new Set(['schemaVersion', 'faces']);
const FACE_KEYS = new Set(['path', 'expectedSha256', 'genericRole', 'language']);
const SHA256_RE = /^[0-9a-fA-F]{64}$/;

export function parseOptions(args, environment = process.env) {
  let directory = environment.RITO_EPUB_SMOKE_DIR ?? join(homedir(), 'Downloads');
  let explicitDirectory = false;
  let outputPath;
  let limit;
  let pinnedFontManifestPath;
  let help = false;
  const files = [];
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') continue;
    if (argument === '--help' || argument === '-h') {
      requireSingleOption(seen, '--help');
      help = true;
    } else if (argument === '--dir') {
      requireSingleOption(seen, argument);
      explicitDirectory = true;
      directory = requireValue(args, ++index, argument);
    } else if (argument === '--file') {
      const file = resolve(requireValue(args, ++index, argument));
      if (files.includes(file)) throw new Error(`Duplicate --file path: ${file}`);
      files.push(file);
    } else if (argument === '--output') {
      requireSingleOption(seen, argument);
      outputPath = requireValue(args, ++index, argument);
    } else if (argument === '--limit') {
      requireSingleOption(seen, argument);
      limit = requirePositiveInteger(requireValue(args, ++index, argument));
    } else if (argument === '--pinned-font') {
      requireSingleOption(seen, argument);
      pinnedFontManifestPath = requireValue(args, ++index, argument);
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  if (help && args.some((argument) => !['--help', '-h', '--'].includes(argument))) {
    throw new Error('--help cannot be combined with other options');
  }
  if (files.length > 0 && explicitDirectory) {
    throw new Error('--file cannot be combined with --dir');
  }
  if (files.length > 0 && limit !== undefined) throw new Error('--limit requires directory mode');
  return {
    directory: resolve(directory),
    files,
    ...(outputPath !== undefined ? { outputPath: resolve(outputPath) } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(pinnedFontManifestPath !== undefined
      ? { pinnedFontManifestPath: resolve(pinnedFontManifestPath) }
      : {}),
    ...(help ? { help: true } : {}),
  };
}

export async function selectEpubPaths(options) {
  if (options.files.length > 0) {
    await Promise.all(options.files.map(requireEpubFile));
    return options.files;
  }
  return await discoverEpubs(options.directory, options.limit);
}

export async function loadPinnedFontManifest(manifestPath) {
  const absoluteManifestPath = resolve(manifestPath);
  const source = await readFile(absoluteManifestPath, 'utf8').catch((error) => {
    throw new Error(`Cannot read pinned font manifest ${absoluteManifestPath}: ${error.message}`, {
      cause: error,
    });
  });
  const manifest = parseManifestJson(source);
  requirePlainObject(manifest, 'pinned font manifest');
  requireExactKeys(manifest, POLICY_KEYS, 'pinned font manifest');
  if (manifest.schemaVersion !== 1) throw new Error('pinned font manifest schemaVersion must be 1');
  if (!Array.isArray(manifest.faces) || manifest.faces.length === 0) {
    throw new Error('pinned font manifest faces must be a non-empty array');
  }
  const faces = [];
  for (const [index, face] of manifest.faces.entries()) {
    faces.push(await loadPinnedFontFace(face, index, absoluteManifestPath));
  }
  rejectDuplicatePinnedFaces(faces);
  const fontByteLength = sum(faces, (face) => face.byteLength);
  if (!Number.isSafeInteger(fontByteLength)) throw new Error('pinned font byte length is unsafe');
  return {
    policyInput: createPolicyInput(faces),
    metadata: createPolicyMetadata(absoluteManifestPath, faces, fontByteLength),
  };
}

export function emptySelectionMessage(options) {
  return options.files.length > 0
    ? 'No EPUB files were selected'
    : `No top-level EPUB files found in ${options.directory}`;
}

export function helpText() {
  return (
    `Usage: diagnose-epub-shapes [options]\n\n` +
    `  --dir <directory>           Scan top-level .epub files (default: Downloads)\n` +
    `  --file <epub>               Diagnose one EPUB; repeatable and exclusive with --dir\n` +
    `  --limit <count>             Limit directory scans\n` +
    `  --pinned-font <manifest>    Compare baseline with a schema-v1 pinned policy\n` +
    `  --output <json>             Write the report instead of stdout\n` +
    `  --help                      Show this help\n`
  );
}

function requireSingleOption(seen, option) {
  if (seen.has(option)) throw new Error(`${option} may be specified only once`);
  seen.add(option);
}

function requireValue(args, index, option) {
  const value = args[index];
  if (value === undefined || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

function requirePositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error('--limit must be a positive safe integer');
  }
  return parsed;
}

async function requireEpubFile(path) {
  if (extname(path).toLowerCase() !== '.epub') throw new Error(`Not an EPUB file: ${path}`);
  const metadata = await stat(path).catch(() => undefined);
  if (!metadata?.isFile()) throw new Error(`EPUB file does not exist: ${path}`);
}

async function discoverEpubs(directory, limit) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.epub'))
    .map((entry) => join(directory, entry.name))
    .sort((left, right) => left.localeCompare(right));
  return limit === undefined ? paths : paths.slice(0, limit);
}

function parseManifestJson(source) {
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid pinned font manifest JSON: ${error.message}`, { cause: error });
  }
}

async function loadPinnedFontFace(face, index, manifestPath) {
  const label = `pinned font manifest face ${index}`;
  requirePlainObject(face, label);
  requireOnlyKeys(face, FACE_KEYS, label);
  for (const key of ['path', 'expectedSha256', 'genericRole']) {
    if (!Object.hasOwn(face, key)) throw new Error(`${label} is missing ${key}`);
  }
  if (typeof face.path !== 'string' || face.path.trim().length === 0) {
    throw new Error(`${label} path must be a non-empty string`);
  }
  const path = resolve(dirname(manifestPath), face.path);
  if (!['.ttf', '.otf'].includes(extname(path).toLowerCase())) {
    throw new Error(`${label} path must reference a static .ttf or .otf file`);
  }
  if (typeof face.expectedSha256 !== 'string' || !SHA256_RE.test(face.expectedSha256)) {
    throw new Error(`${label} expectedSha256 must contain 64 hexadecimal digits`);
  }
  if (!GENERIC_ROLES.has(face.genericRole)) throw new Error(`${label} genericRole is unsupported`);
  const language = normalizeLanguage(face.language, label);
  const bytes = await readFile(path).catch((error) => {
    throw new Error(`Cannot read ${label} ${path}: ${error.message}`, { cause: error });
  });
  if (bytes.byteLength === 0) throw new Error(`${label} bytes must not be empty`);
  const expectedSha256 = face.expectedSha256.toLowerCase();
  const actualSha256 = sha256Hex(bytes);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`${label} SHA-256 mismatch: expected ${expectedSha256}, got ${actualSha256}`);
  }
  return {
    path,
    expectedSha256,
    genericRole: face.genericRole,
    language,
    byteLength: bytes.byteLength,
    bytes: Uint8Array.from(bytes),
  };
}

function normalizeLanguage(value, label) {
  if (value === undefined) return 'und';
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 63 ||
    !/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(value) ||
    value.split('-').some((part) => part.length > 8)
  ) {
    throw new Error(`${label} language must be an ASCII BCP47-style tag`);
  }
  return value.toLowerCase();
}

function rejectDuplicatePinnedFaces(faces) {
  const hashes = new Set();
  const selectors = new Set();
  for (const face of faces) {
    const selector = `${face.genericRole}\0${face.language}`;
    if (hashes.has(face.expectedSha256)) {
      throw new Error('pinned font manifest contains a duplicate face SHA-256');
    }
    if (selectors.has(selector)) {
      throw new Error('pinned font manifest contains a duplicate genericRole and language');
    }
    hashes.add(face.expectedSha256);
    selectors.add(selector);
  }
}

function createPolicyInput(faces) {
  return {
    schemaVersion: 1,
    faces: faces.map((face) => ({
      bytes: face.bytes,
      expectedSha256: face.expectedSha256,
      genericRole: face.genericRole,
      ...(face.language !== 'und' ? { language: face.language } : {}),
    })),
  };
}

function createPolicyMetadata(manifestPath, faces, fontByteLength) {
  return {
    manifestPath,
    schemaVersion: 1,
    fontByteLength,
    faces: faces.map((face) => ({
      path: face.path,
      expectedSha256: face.expectedSha256,
      genericRole: face.genericRole,
      language: face.language,
      byteLength: face.byteLength,
    })),
  };
}

function requirePlainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function requireExactKeys(value, keys, label) {
  requireOnlyKeys(value, keys, label);
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) throw new Error(`${label} is missing ${key}`);
  }
}

function requireOnlyKeys(value, keys, label) {
  const unknown = Object.keys(value).filter((key) => !keys.has(key));
  if (unknown.length > 0) throw new Error(`${label} contains unknown field ${unknown[0]}`);
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sum(values, select) {
  return values.reduce((total, value) => total + select(value), 0);
}
