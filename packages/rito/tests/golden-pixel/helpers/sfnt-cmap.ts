export interface SfntCmap {
  hasGlyph(codePoint: number): boolean;
}

export interface SfntFallbackFixtureSpec {
  readonly authorOnly: string;
  readonly pinnedOnly: string;
  readonly mixedCjk: string;
  readonly variableLatin: string;
}

interface SfntTable {
  readonly offset: number;
  readonly length: number;
}

type GlyphLookup = (codePoint: number) => boolean;

export function parseSfntCmap(bytes: Uint8Array): SfntCmap {
  const reader = new SfntReader(bytes);
  const table = findTable(reader, 'cmap');
  const tableEnd = table.offset + table.length;
  reader.requireRange(table.offset, 4, tableEnd, 'cmap header');
  const recordCount = reader.uint16(table.offset + 2);
  reader.requireRange(table.offset + 4, recordCount * 8, tableEnd, 'cmap encoding records');
  const lookups: GlyphLookup[] = [];

  for (let index = 0; index < recordCount; index += 1) {
    const recordOffset = table.offset + 4 + index * 8;
    const platform = reader.uint16(recordOffset);
    const encoding = reader.uint16(recordOffset + 2);
    if (!isUnicodeEncoding(platform, encoding)) continue;
    const subtableOffset = table.offset + reader.uint32(recordOffset + 4);
    reader.requireRange(subtableOffset, 2, tableEnd, 'cmap subtable header');
    const lookup = createLookup(reader, subtableOffset, tableEnd);
    if (lookup) lookups.push(lookup);
  }

  if (lookups.length === 0) throw new Error('SFNT font has no supported Unicode cmap subtable');
  return {
    hasGlyph(codePoint: number): boolean {
      requireUnicodeScalar(codePoint);
      return lookups.some((lookup) => lookup(codePoint));
    },
  };
}

export function requireSfntFallbackFixtureCoverage(
  authorBytes: Uint8Array,
  pinnedBytes: Uint8Array,
  spec: SfntFallbackFixtureSpec,
): void {
  const author = parseSfntCmap(authorBytes);
  const pinned = parseSfntCmap(pinnedBytes);
  requireExclusiveGlyph(author, pinned, spec.authorOnly, 'author');
  requireExclusiveGlyph(author, pinned, spec.pinnedOnly, 'pinned');

  for (const character of uniqueCharacters(spec.mixedCjk)) {
    if (character === spec.authorOnly || character === spec.pinnedOnly) continue;
    requireGlyph(author, character, false, 'author');
    requireGlyph(pinned, character, true, 'pinned');
  }

  const latin = uniqueCharacters(spec.variableLatin);
  for (const character of latin) requireGlyph(pinned, character, true, 'pinned');
  if (!latin.some((character) => author.hasGlyph(codePointOf(character)))) {
    throw new Error('Latin fixture must keep at least one author-font glyph');
  }
  const hasFallback = latin.some(
    (character) =>
      !author.hasGlyph(codePointOf(character)) && pinned.hasGlyph(codePointOf(character)),
  );
  if (!hasFallback) throw new Error('Latin fixture must keep at least one pinned fallback glyph');
}

function requireExclusiveGlyph(
  author: SfntCmap,
  pinned: SfntCmap,
  character: string,
  owner: 'author' | 'pinned',
): void {
  requireGlyph(author, character, owner === 'author', 'author');
  requireGlyph(pinned, character, owner === 'pinned', 'pinned');
}

function requireGlyph(
  cmap: SfntCmap,
  character: string,
  expected: boolean,
  font: 'author' | 'pinned',
): void {
  const codePoint = codePointOf(character);
  if (cmap.hasGlyph(codePoint) === expected) return;
  const expectation = expected ? 'must contain' : 'must not contain';
  throw new Error(
    `${font} font cmap ${expectation} ${character} (U+${codePoint.toString(16).toUpperCase()})`,
  );
}

function uniqueCharacters(text: string): readonly string[] {
  return [...new Set(text)];
}

function codePointOf(character: string): number {
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined) throw new Error('Expected a non-empty font fixture character');
  return codePoint;
}

function findTable(reader: SfntReader, expectedTag: string): SfntTable {
  reader.requireRange(0, 12, reader.byteLength, 'SFNT header');
  const tableCount = reader.uint16(4);
  reader.requireRange(12, tableCount * 16, reader.byteLength, 'SFNT table directory');
  for (let index = 0; index < tableCount; index += 1) {
    const recordOffset = 12 + index * 16;
    if (reader.tag(recordOffset) !== expectedTag) continue;
    const table = {
      offset: reader.uint32(recordOffset + 8),
      length: reader.uint32(recordOffset + 12),
    };
    reader.requireRange(table.offset, table.length, reader.byteLength, `${expectedTag} table`);
    return table;
  }
  throw new Error(`SFNT font is missing its ${expectedTag} table`);
}

function isUnicodeEncoding(platform: number, encoding: number): boolean {
  return platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
}

function createLookup(
  reader: SfntReader,
  offset: number,
  tableEnd: number,
): GlyphLookup | undefined {
  const format = reader.uint16(offset);
  if (format === 4) return createFormat4Lookup(reader, offset, tableEnd);
  if (format === 12 || format === 13) {
    return createGroupedLookup(reader, offset, tableEnd, format === 13);
  }
  return undefined;
}

function createFormat4Lookup(reader: SfntReader, offset: number, tableEnd: number): GlyphLookup {
  reader.requireRange(offset, 14, tableEnd, 'cmap format 4 header');
  const end = offset + reader.uint16(offset + 2);
  reader.requireRange(offset, end - offset, tableEnd, 'cmap format 4 subtable');
  const segmentCountX2 = reader.uint16(offset + 6);
  if (segmentCountX2 === 0 || segmentCountX2 % 2 !== 0) {
    throw new Error('cmap format 4 has an invalid segment count');
  }
  const segmentCount = segmentCountX2 / 2;
  const endCodes = offset + 14;
  const startCodes = endCodes + segmentCount * 2 + 2;
  const deltas = startCodes + segmentCount * 2;
  const rangeOffsets = deltas + segmentCount * 2;
  reader.requireRange(rangeOffsets, segmentCount * 2, end, 'cmap format 4 segments');

  return (codePoint) => {
    if (codePoint > 0xffff) return false;
    for (let index = 0; index < segmentCount; index += 1) {
      const start = reader.uint16(startCodes + index * 2);
      const finish = reader.uint16(endCodes + index * 2);
      if (codePoint < start || codePoint > finish) continue;
      const delta = reader.uint16(deltas + index * 2);
      const rangeOffsetPosition = rangeOffsets + index * 2;
      const rangeOffset = reader.uint16(rangeOffsetPosition);
      if (rangeOffset === 0) return ((codePoint + delta) & 0xffff) !== 0;
      const glyphOffset = rangeOffsetPosition + rangeOffset + (codePoint - start) * 2;
      reader.requireRange(glyphOffset, 2, end, 'cmap format 4 glyph');
      const glyph = reader.uint16(glyphOffset);
      return glyph !== 0 && ((glyph + delta) & 0xffff) !== 0;
    }
    return false;
  };
}

function createGroupedLookup(
  reader: SfntReader,
  offset: number,
  tableEnd: number,
  constantGlyph: boolean,
): GlyphLookup {
  reader.requireRange(offset, 16, tableEnd, 'grouped cmap header');
  const end = offset + reader.uint32(offset + 4);
  reader.requireRange(offset, end - offset, tableEnd, 'grouped cmap subtable');
  const groupCount = reader.uint32(offset + 12);
  const groups = offset + 16;
  reader.requireRange(groups, groupCount * 12, end, 'grouped cmap ranges');
  return (codePoint) => {
    for (let index = 0; index < groupCount; index += 1) {
      const group = groups + index * 12;
      const start = reader.uint32(group);
      const finish = reader.uint32(group + 4);
      if (codePoint < start) return false;
      if (codePoint > finish) continue;
      const firstGlyph = reader.uint32(group + 8);
      return constantGlyph ? firstGlyph !== 0 : firstGlyph + codePoint - start !== 0;
    }
    return false;
  };
}

function requireUnicodeScalar(codePoint: number): void {
  const surrogate = codePoint >= 0xd800 && codePoint <= 0xdfff;
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff || surrogate) {
    throw new RangeError(`Invalid Unicode scalar: ${String(codePoint)}`);
  }
}

class SfntReader {
  readonly #view: DataView;

  constructor(bytes: Uint8Array) {
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get byteLength(): number {
    return this.#view.byteLength;
  }

  uint16(offset: number): number {
    this.requireRange(offset, 2, this.byteLength, 'uint16');
    return this.#view.getUint16(offset);
  }

  uint32(offset: number): number {
    this.requireRange(offset, 4, this.byteLength, 'uint32');
    return this.#view.getUint32(offset);
  }

  tag(offset: number): string {
    this.requireRange(offset, 4, this.byteLength, 'SFNT tag');
    return String.fromCharCode(
      this.#view.getUint8(offset),
      this.#view.getUint8(offset + 1),
      this.#view.getUint8(offset + 2),
      this.#view.getUint8(offset + 3),
    );
  }

  requireRange(offset: number, length: number, limit: number, label: string): void {
    const valid =
      Number.isSafeInteger(offset) &&
      Number.isSafeInteger(length) &&
      offset >= 0 &&
      length >= 0 &&
      limit >= 0 &&
      offset <= limit - length;
    if (!valid) throw new Error(`${label} exceeds the SFNT font bounds`);
  }
}
