export interface LocalizedFontName {
  readonly lang?: string;
  readonly nameId: number;
  readonly value: string;
}

export interface ParsedFontNames {
  readonly familyNames: readonly LocalizedFontName[];
  readonly fullNames: readonly LocalizedFontName[];
  readonly postscriptNames: readonly LocalizedFontName[];
}

interface FaceMatcher {
  readonly family?: string;
  readonly fullName?: string;
  readonly postscriptName?: string;
}

interface ParsedFaceNames extends ParsedFontNames {
  readonly matchScore: number;
}

interface NameRecord {
  readonly lang?: string;
  readonly languageId: number;
  readonly nameId: number;
  readonly platformId: number;
  readonly value: string;
}

const NAME_TABLE_TAG = 0x6e616d65;
const TTCF_TAG = 0x74746366;

const NAME_ID_FAMILY = 1;
const NAME_ID_FULL = 4;
const NAME_ID_POSTSCRIPT = 6;
const NAME_ID_TYPOGRAPHIC_FAMILY = 16;

const WINDOWS_LANGUAGE_IDS = new Map<number, string>([
  [0x0401, 'ar'],
  [0x0408, 'el'],
  [0x0409, 'en-US'],
  [0x040d, 'he'],
  [0x0411, 'ja'],
  [0x0412, 'ko'],
  [0x0419, 'ru'],
  [0x041e, 'th'],
  [0x0439, 'hi'],
  [0x0804, 'zh-CN'],
  [0x0c04, 'zh-HK'],
  [0x1004, 'zh-SG'],
  [0x0404, 'zh-TW'],
]);

const MAC_LANGUAGE_IDS = new Map<number, string>([
  [0, 'en'],
  [10, 'he'],
  [11, 'ja'],
  [12, 'ar'],
  [19, 'zh-Hant'],
  [20, 'ur'],
  [21, 'hi'],
  [22, 'th'],
  [23, 'ko'],
  [32, 'ru'],
  [14, 'el'],
  [33, 'zh-CN'],
]);

export function parseLocalizedFontNames(
  buffer: ArrayBuffer,
  matcher?: FaceMatcher,
): ParsedFontNames | null {
  try {
    const view = new DataView(buffer);
    const faceOffsets = getFaceOffsets(view);
    if (faceOffsets.length === 0) return null;

    const parsedFaces = faceOffsets
      .map((offset) => parseFaceNames(view, offset, matcher))
      .filter((face): face is ParsedFaceNames => face !== null);

    if (parsedFaces.length === 0) return null;

    parsedFaces.sort((left, right) => right.matchScore - left.matchScore);
    const best = parsedFaces[0];
    if (!best) return null;
    return {
      familyNames: best.familyNames,
      fullNames: best.fullNames,
      postscriptNames: best.postscriptNames,
    };
  } catch {
    return null;
  }
}

function getFaceOffsets(view: DataView): readonly number[] {
  if (view.byteLength < 12) return [];
  if (view.getUint32(0, false) === TTCF_TAG) {
    if (view.byteLength < 12) return [];
    const numFonts = view.getUint32(8, false);
    const offsets: number[] = [];
    for (let index = 0; index < numFonts; index++) {
      const recordOffset = 12 + index * 4;
      if (recordOffset + 4 > view.byteLength) break;
      offsets.push(view.getUint32(recordOffset, false));
    }
    return offsets;
  }
  return [0];
}

function parseFaceNames(
  view: DataView,
  faceOffset: number,
  matcher?: FaceMatcher,
): ParsedFaceNames | null {
  const tableOffset = findNameTableOffset(view, faceOffset);
  if (tableOffset === null) return null;

  const records = parseNameRecords(view, tableOffset);
  if (records.length === 0) return null;

  const familyNames = collectLocalizedNames(records, [NAME_ID_TYPOGRAPHIC_FAMILY, NAME_ID_FAMILY]);
  const fullNames = collectLocalizedNames(records, [NAME_ID_FULL]);
  const postscriptNames = collectLocalizedNames(records, [NAME_ID_POSTSCRIPT]);

  return {
    familyNames,
    fullNames,
    postscriptNames,
    matchScore: scoreFace(records, matcher),
  };
}

function findNameTableOffset(view: DataView, faceOffset: number): number | null {
  if (faceOffset + 12 > view.byteLength) return null;
  const numTables = view.getUint16(faceOffset + 4, false);
  const recordsOffset = faceOffset + 12;

  for (let index = 0; index < numTables; index++) {
    const recordOffset = recordsOffset + index * 16;
    if (recordOffset + 16 > view.byteLength) return null;
    const tag = view.getUint32(recordOffset, false);
    if (tag === NAME_TABLE_TAG) {
      const offset = view.getUint32(recordOffset + 8, false);
      if (offset + 6 <= view.byteLength) return offset;
      const relativeOffset = faceOffset + offset;
      if (relativeOffset + 6 <= view.byteLength) return relativeOffset;
      return null;
    }
  }

  return null;
}

function parseNameRecords(view: DataView, tableOffset: number): readonly NameRecord[] {
  if (tableOffset + 6 > view.byteLength) return [];

  const format = view.getUint16(tableOffset, false);
  const count = view.getUint16(tableOffset + 2, false);
  const stringStorageOffset = tableOffset + view.getUint16(tableOffset + 4, false);
  const recordStart = tableOffset + 6;

  const langTags =
    format === 1 ? parseLanguageTags(view, recordStart, count, stringStorageOffset) : [];

  const records: NameRecord[] = [];
  for (let index = 0; index < count; index++) {
    const offset = recordStart + index * 12;
    if (offset + 12 > view.byteLength) break;

    const platformId = view.getUint16(offset, false);
    const encodingId = view.getUint16(offset + 2, false);
    const languageId = view.getUint16(offset + 4, false);
    const nameId = view.getUint16(offset + 6, false);
    const byteLength = view.getUint16(offset + 8, false);
    const valueOffset = stringStorageOffset + view.getUint16(offset + 10, false);

    const value = decodeNameString(view, platformId, encodingId, valueOffset, byteLength);
    if (!value) continue;

    const lang =
      languageId >= 0x8000 ? langTags[languageId - 0x8000] : getLanguageTag(platformId, languageId);

    records.push({
      platformId,
      languageId,
      nameId,
      value,
      ...(lang ? { lang } : {}),
    });
  }

  return records;
}

function parseLanguageTags(
  view: DataView,
  recordStart: number,
  count: number,
  stringStorageOffset: number,
): readonly string[] {
  const langTagCountOffset = recordStart + count * 12;
  if (langTagCountOffset + 2 > view.byteLength) return [];

  const langTagCount = view.getUint16(langTagCountOffset, false);
  const tags: string[] = [];
  let recordOffset = langTagCountOffset + 2;

  for (let index = 0; index < langTagCount; index++) {
    if (recordOffset + 4 > view.byteLength) break;
    const byteLength = view.getUint16(recordOffset, false);
    const valueOffset = stringStorageOffset + view.getUint16(recordOffset + 2, false);
    const value = decodeUtf16Be(view, valueOffset, byteLength);
    if (value) tags.push(value);
    recordOffset += 4;
  }

  return tags;
}

function decodeNameString(
  view: DataView,
  platformId: number,
  encodingId: number,
  offset: number,
  byteLength: number,
): string | null {
  if (offset < 0 || byteLength <= 0 || offset + byteLength > view.byteLength) return null;

  if (platformId === 0 || platformId === 3) {
    return sanitizeName(decodeUtf16Be(view, offset, byteLength));
  }

  if (platformId === 1 && encodingId === 0) {
    return sanitizeName(decodeBytes(view, offset, byteLength, 'macintosh'));
  }

  return sanitizeName(decodeBytes(view, offset, byteLength, 'utf-8'));
}

function decodeUtf16Be(view: DataView, offset: number, byteLength: number): string {
  let out = '';
  for (let index = 0; index + 1 < byteLength; index += 2) {
    out += String.fromCharCode(view.getUint16(offset + index, false));
  }
  return out;
}

function decodeBytes(view: DataView, offset: number, byteLength: number, encoding: string): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, byteLength);
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

function sanitizeName(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.replaceAll('\u0000', '').trim();
  return normalized.length > 0 ? normalized : null;
}

function getLanguageTag(platformId: number, languageId: number): string | undefined {
  if (platformId === 3) return WINDOWS_LANGUAGE_IDS.get(languageId);
  if (platformId === 1) return MAC_LANGUAGE_IDS.get(languageId);
  return undefined;
}

function collectLocalizedNames(
  records: readonly NameRecord[],
  nameIds: readonly number[],
): readonly LocalizedFontName[] {
  const collected: LocalizedFontName[] = [];
  const seen = new Set<string>();

  for (const nameId of nameIds) {
    for (const record of records) {
      if (record.nameId !== nameId) continue;
      const lang = getRecordLanguage(record);
      const key = `${String(nameId)}:${lang ?? ''}:${record.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push({
        nameId,
        value: record.value,
        ...(lang ? { lang } : {}),
      });
    }
  }

  return collected;
}

function scoreFace(records: readonly NameRecord[], matcher: FaceMatcher | undefined): number {
  if (!matcher) return 0;

  let score = 0;
  for (const record of records) {
    if (matcher.postscriptName && record.nameId === NAME_ID_POSTSCRIPT) {
      if (equalsIgnoreCase(record.value, matcher.postscriptName)) score += 30;
    }
    if (matcher.fullName && record.nameId === NAME_ID_FULL) {
      if (equalsIgnoreCase(record.value, matcher.fullName)) score += 20;
    }
    if (
      matcher.family &&
      (record.nameId === NAME_ID_TYPOGRAPHIC_FAMILY || record.nameId === NAME_ID_FAMILY)
    ) {
      if (equalsIgnoreCase(record.value, matcher.family)) score += 10;
    }
  }
  return score;
}

function equalsIgnoreCase(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0;
}

function getRecordLanguage(record: NameRecord): string | undefined {
  return record.lang;
}
