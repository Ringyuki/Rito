import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeRitoReaderPublicationV1 } from '../src/reader-v1-publication-runtime.js';
import {
  READER_V1_PROTOCOL_VERSION,
  ReaderWireWriterV1,
} from '../src/reader-v1-wire-base-runtime.js';

const PUBLICATION_WIRE_BYTES_MAX = 16 * 1024 * 1024;
const SESSION_ID = (1n << 60n) + 23n;

test('RITOPUB1 decodes immutable publication metadata, spine, and nested TOC with bigint IDs', () => {
  const publication = decodeRitoReaderPublicationV1(publicationWire(publicationFixture()));

  assert.equal(publication.protocolVersion, READER_V1_PROTOCOL_VERSION);
  assert.equal(publication.sessionId, SESSION_ID);
  assert.equal(typeof publication.sessionId, 'bigint');
  assert.deepEqual(publication.metadata, {
    title: '縦書きの本',
    language: 'ja',
    identifier: 'urn:rito:test',
    creator: 'Rito',
  });
  assert.deepEqual(publication.spine, [
    {
      spineIndex: 0,
      linearIndex: 0,
      idref: 'chapter-1',
      href: 'Text/chapter-1.xhtml',
    },
    {
      spineIndex: 1,
      linearIndex: undefined,
      idref: 'notes',
      href: 'Text/notes.xhtml',
    },
    {
      spineIndex: 2,
      linearIndex: 1,
      idref: 'chapter-2',
      href: 'Text/chapter-2.xhtml',
    },
  ]);
  assert.equal(publication.toc[0].target.kind, 'locator');
  assert.deepEqual(publication.toc[0].target.locator, {
    href: 'Text/chapter-1.xhtml',
    anchorId: '開始',
    sourcePoint: undefined,
    sourceRange: undefined,
    progression: undefined,
  });
  assert.deepEqual(publication.toc[0].children[0].target, {
    kind: 'external',
    href: 'https://example.com/reference',
  });
  assert.deepEqual(publication.toc[1].target, {
    kind: 'unresolved',
    href: 'Text/missing.xhtml#lost',
  });
});

test('RITOPUB1 rejects every truncated prefix', () => {
  const bytes = publicationWire(publicationFixture());
  for (let end = 0; end < bytes.byteLength; end += 1) {
    assertInvalidWire(() => decodeRitoReaderPublicationV1(bytes.subarray(0, end)));
  }
});

test('RITOPUB1 rejects wire/protocol versions, high-bit IDs, unknown targets, and trailing bytes', () => {
  const cases = [];

  const wireVersion = publicationWire(publicationFixture());
  view(wireVersion).setUint32(8, 2, true);
  cases.push(wireVersion);

  const protocolVersion = publicationWire(publicationFixture());
  view(protocolVersion).setUint32(20, READER_V1_PROTOCOL_VERSION + 1, true);
  cases.push(protocolVersion);

  const highBitSession = publicationWire(publicationFixture());
  view(highBitSession).setBigUint64(24, 1n << 63n, true);
  cases.push(highBitSession);

  const unknownTarget = publicationFixture();
  unknownTarget.toc[0].target = { kind: 'unknown', tag: 255 };
  cases.push(publicationWire(unknownTarget));

  const valid = publicationWire(publicationFixture());
  const trailing = new Uint8Array(valid.byteLength + 1);
  trailing.set(valid);
  trailing[trailing.byteLength - 1] = 0x7f;
  view(trailing).setBigUint64(12, BigInt(trailing.byteLength), true);
  cases.push(trailing);

  for (const bytes of cases) {
    assertInvalidWire(() => decodeRitoReaderPublicationV1(bytes));
  }
});

test('RITOPUB1 fails closed on non-canonical publication semantics', () => {
  const invalidCases = [
    mutateFixture((value) => {
      value.spine[1].spineIndex = 9;
    }),
    mutateFixture((value) => {
      value.spine[2].linearIndex = 4;
    }),
    mutateFixture((value) => {
      value.toc[0].children[0].tocId = 8;
    }),
    mutateFixture((value) => {
      value.toc[0].target.locator.progression = 0.5;
    }),
    mutateFixture((value) => {
      value.toc[0].target.locator.sourcePoint = { nodePath: [0, 3], textOffset: 7n };
    }),
    mutateFixture((value) => {
      value.toc[0].target.locator.href = 'Text/chapter-2.xhtml';
    }),
    mutateFixture((value) => {
      value.toc[0].target.spineIndex = 99;
    }),
    mutateFixture((value) => {
      value.toc[0].children[0].target = {
        kind: 'external',
        href: 'Text/internal.xhtml',
      };
    }),
    mutateFixture((value) => {
      value.toc[1].target = { kind: 'unresolved', href: 'mailto:reader@example.com' };
    }),
    mutateFixture((value) => {
      value.spine[1].href = value.spine[0].href;
    }),
  ];

  for (const publication of invalidCases) {
    assertInvalidWire(() => decodeRitoReaderPublicationV1(publicationWire(publication)));
  }
});

test('RITOPUB1 applies its 16 MiB cap before parsing a body', () => {
  const bytes = new Uint8Array(PUBLICATION_WIRE_BYTES_MAX + 1);
  bytes.set(new TextEncoder().encode('RITOPUB1'));
  view(bytes).setUint32(8, 1, true);
  view(bytes).setBigUint64(12, BigInt(bytes.byteLength), true);

  assert.throws(
    () => decodeRitoReaderPublicationV1(bytes),
    (error) => error?.code === 'invalid-wire' && /byte limit/.test(error.message),
  );
});

function publicationFixture() {
  return {
    protocolVersion: READER_V1_PROTOCOL_VERSION,
    sessionId: SESSION_ID,
    metadata: {
      title: '縦書きの本',
      language: 'ja',
      identifier: 'urn:rito:test',
      creator: 'Rito',
    },
    spine: [
      {
        spineIndex: 0,
        linearIndex: 0,
        idref: 'chapter-1',
        href: 'Text/chapter-1.xhtml',
      },
      {
        spineIndex: 1,
        linearIndex: undefined,
        idref: 'notes',
        href: 'Text/notes.xhtml',
      },
      {
        spineIndex: 2,
        linearIndex: 1,
        idref: 'chapter-2',
        href: 'Text/chapter-2.xhtml',
      },
    ],
    toc: [
      {
        tocId: 0,
        label: '第一章',
        target: {
          kind: 'locator',
          spineIndex: 0,
          locator: { href: 'Text/chapter-1.xhtml', anchorId: '開始' },
        },
        children: [
          {
            tocId: 1,
            label: '参考資料',
            target: { kind: 'external', href: 'https://example.com/reference' },
            children: [],
          },
        ],
      },
      {
        tocId: 2,
        label: '未収録',
        target: { kind: 'unresolved', href: 'Text/missing.xhtml#lost' },
        children: [],
      },
    ],
  };
}

function publicationWire(value) {
  const writer = ReaderWireWriterV1.message('RITOPUB1');
  writer.u32(value.protocolVersion, 'protocol version');
  writer.u64(value.sessionId, 'session ID');
  writer.record((record) => {
    record.string(value.metadata.title, 'title');
    record.string(value.metadata.language, 'language');
    record.string(value.metadata.identifier, 'identifier');
    record.option(value.metadata.creator, (creator) => record.string(creator, 'creator'));
  });
  writer.count(value.spine.length, 'spine count');
  for (const item of value.spine) {
    writer.record((record) => {
      record.u32(item.spineIndex, 'spine index');
      record.option(item.linearIndex, (linearIndex) => record.u32(linearIndex, 'linear index'));
      record.string(item.idref, 'spine idref');
      record.string(item.href, 'spine href');
    });
  }
  writeTocEntries(writer, value.toc);
  return writer.finish();
}

function writeTocEntries(writer, entries) {
  writer.count(entries.length, 'TOC count');
  for (const entry of entries) {
    writer.record((record) => {
      record.u32(entry.tocId, 'TOC ID');
      record.string(entry.label, 'TOC label');
      writeTocTarget(record, entry.target);
      writeTocEntries(record, entry.children);
    });
  }
}

function writeTocTarget(writer, target) {
  if (target.kind === 'locator') {
    writer.u8(0, 'locator target');
    writer.u32(target.spineIndex, 'target spine index');
    writeLocator(writer, target.locator);
    return;
  }
  if (target.kind === 'external') {
    writer.u8(1, 'external target');
    writer.string(target.href, 'external href');
    return;
  }
  if (target.kind === 'unresolved') {
    writer.u8(2, 'unresolved target');
    writer.string(target.href, 'unresolved href');
    return;
  }
  writer.u8(target.tag, 'unknown target');
}

function writeLocator(writer, locator) {
  writer.record((record) => {
    record.string(locator.href, 'locator href');
    record.option(locator.anchorId, (anchorId) => record.string(anchorId, 'locator anchor'));
    record.option(locator.sourcePoint, (point) => writeSourcePoint(record, point));
    record.option(locator.sourceRange, (range) => writeSourceRange(record, range));
    record.option(locator.progression, (progression) =>
      record.f64(progression, 'locator progression'),
    );
  });
}

function writeSourcePoint(writer, point) {
  writer.record((record) => {
    record.count(point.nodePath.length, 'source path');
    for (const part of point.nodePath) record.u32(part, 'source path part');
    record.u64(point.textOffset, 'source text offset');
  });
}

function writeSourceRange(writer, range) {
  writer.record((record) => {
    writeSourcePoint(record, range.start);
    writeSourcePoint(record, range.end);
  });
}

function mutateFixture(mutate) {
  const value = publicationFixture();
  mutate(value);
  return value;
}

function assertInvalidWire(run) {
  assert.throws(run, (error) => error?.code === 'invalid-wire');
}

function view(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
