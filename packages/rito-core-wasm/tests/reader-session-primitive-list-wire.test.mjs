// Decodes bytes the live Rust encoder wrote (tests/fixtures/*.hex, kept in
// step by crates/rito-core's cross_language_wire_fixture_matches_the_encoder
// test). A hand-built fixture can agree with a stale reading of the wire;
// these cannot.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  READER_V1_PRIMITIVE_LIST_FORMAT_VERSION,
  decodeRitoReaderPrimitiveList,
} from '../src/reader-session-primitive-decoder-runtime.js';

export function primitiveListFixture() {
  const hex = readFileSync(
    new URL('./fixtures/reader-session-primitive-list.hex', import.meta.url),
    'utf8',
  ).trim();
  return Uint8Array.from(hex.match(/../g), (pair) => Number.parseInt(pair, 16));
}

test('decodes every primitive the Rust encoder writes', () => {
  const list = decodeRitoReaderPrimitiveList(primitiveListFixture());
  assert.equal(list.formatVersion, READER_V1_PRIMITIVE_LIST_FORMAT_VERSION);
  assert.equal(list.ratio, 2);
  assert.equal(list.commandCount, 14);
  assert.deepEqual(
    list.commands.map((command) => command.kind),
    [
      'push-state',
      'pop-state',
      'translate',
      'opacity',
      'transform',
      'clip-path',
      'fill-rect',
      'fill-path',
      'stroke-path',
      'shadow',
      'draw-image',
      'text',
      'ruby',
      'image-fallback',
    ],
  );
  const fallback = list.commands[13];
  assert.equal(fallback.src, 'images/cover.jpg');
  assert.equal(fallback.state, 'broken');
  assert.deepEqual(fallback.block, list.commands[10].dest);
  assert.equal(fallback.blockInk, 0.06);
  assert.equal(fallback.iconInk, 0.4);
  assert.equal(fallback.pieces.length, 2);
  assert.ok(fallback.pieces.every((piece) => piece.clip.length > 0 && piece.path.length > 0));
  assert.ok(fallback.pieces[0].offset.x < 0 && fallback.pieces[1].offset.x > 0);
  assert.deepEqual(list.commands[2], { kind: 'translate', dx: 1, dy: 2 });
  assert.deepEqual(list.commands[4], {
    kind: 'transform',
    origin: { x: 1, y: 2 },
    transforms: [
      { kind: 'rotate', radians: 0.5 },
      { kind: 'scale', sx: 2, sy: 3 },
      { kind: 'translate', dx: 4, dy: 5 },
    ],
  });
  const clip = list.commands[5];
  assert.deepEqual(clip.path, [
    { op: 'move-to', x: 1, y: 2 },
    { op: 'line-to', x: 3, y: 4 },
    { op: 'arc', cx: 5, cy: 6, rx: 7, ry: 8, start: 0, sweep: 1.5 },
    { op: 'ellipse', cx: 9, cy: 10, rx: 2, ry: 3 },
    { op: 'rect', x: 0, y: 0, width: 20, height: 30 },
    { op: 'close' },
  ]);
  const fill = list.commands[6];
  assert.deepEqual(fill.rect, { x: 0, y: 0, width: 40, height: 60 });
  assert.equal(fill.ground, 'page');
  assert.equal(fill.groundRect, undefined);
  assert.equal(fill.color.component2, 0.75);
  const fillPath = list.commands[7];
  assert.equal(fillPath.rule, 'evenodd');
  assert.equal(fillPath.ground, 'block');
  assert.deepEqual(fillPath.groundRect, { x: 0.5, y: 0.5, width: 39, height: 59 });
  const stroke = list.commands[8];
  assert.equal(stroke.width, 1.5);
  assert.equal(stroke.cap, 'round');
  assert.deepEqual(stroke.dash, { on: 3, off: 2 });
  const shadow = list.commands[9];
  assert.equal(shadow.sigma, 1.5);
  assert.deepEqual(shadow.offset, { x: 1, y: 2 });
  assert.equal(shadow.clipOut.length, 6);
  const image = list.commands[10];
  assert.equal(image.src, 'images/cover.jpg');
  assert.deepEqual(image.dest, { x: 0, y: 0, width: 40, height: 60 });
  assert.equal(image.sourceRect, undefined);
  assert.deepEqual(image.tiles, {
    origin: { x: 0, y: 0 },
    stepX: 16,
    stepY: 16,
    columns: 2,
    rows: 3,
  });
  assert.equal(list.commands[12].kind, 'ruby');
});

test('decodes every optional field of a text run, scaled to the device grid', () => {
  // The fixture is lowered at ratio 2, but a text run keeps its CSS
  // lengths: the renderer draws it under the ratio. Its inline box and
  // decoration line are primitives of their own, not run paint.
  const list = decodeRitoReaderPrimitiveList(primitiveListFixture());
  const text = list.commands[11];
  assert.equal(text.text, 'text');
  assert.deepEqual(text.rect, { x: 0, y: 0, width: 20, height: 30 });
  assert.deepEqual(text.paint.font, {
    family: 'Rito Serif',
    sizePx: 16,
    weight: 700,
    style: 'italic',
  });
  assert.equal(text.paint.color.space, 'srgb');
  assert.equal(text.paint.textShadows.length, 1);
  assert.deepEqual(
    [
      text.paint.textShadows[0].offsetX,
      text.paint.textShadows[0].offsetY,
      text.paint.textShadows[0].blur,
    ],
    [1, 2, 3],
  );
  assert.equal(text.lineHeightPx, 18.5);
  assert.equal(text.href, '#note');
  assert.equal(text.sourceText, 'source');
  assert.equal(text.sourceTextOffset, 9n);
  assert.deepEqual(text.clusters, {
    bytes: Uint32Array.of(0, 1, 2, 3),
    origins: Float32Array.of(0, 12.5, 8.5, 12.5, 12.25, 12.5, 16, 12.5),
    joins: Uint8Array.of(0, 1, 0, 0),
  });
});

test('the primitive decoder rejects earlier formats, truncation and trailing bytes', () => {
  const primitives = primitiveListFixture();
  const earlier = Uint8Array.from(primitives);
  for (const version of [1, 2]) {
    new DataView(earlier.buffer).setUint32(7, version, true);
    assert.throws(
      () => decodeRitoReaderPrimitiveList(earlier),
      new RegExp(`unsupported primitive list version: ${String(version)}`),
    );
  }
  for (const end of [0, 7, 11, 19, 23, 25, primitives.length - 1]) {
    assert.throws(() => decodeRitoReaderPrimitiveList(primitives.subarray(0, end)));
  }
  const trailing = new Uint8Array(primitives.length + 1);
  trailing.set(primitives);
  assert.throws(() => decodeRitoReaderPrimitiveList(trailing), /trailing bytes/);
});

test('the primitive decoder rejects a cluster flag other than joins', () => {
  const primitives = primitiveListFixture();
  // The fixture's second cluster: byte 1 at (8.5, 12.5), joining the first.
  const record = new Uint8Array(13);
  const view = new DataView(record.buffer);
  view.setUint32(0, 1, true);
  view.setFloat32(4, 8.5, true);
  view.setFloat32(8, 12.5, true);
  record[12] = 1;
  const at = Buffer.from(primitives).indexOf(record);
  assert.ok(at > 0, 'the fixture carries the joined cluster');
  const corrupt = Uint8Array.from(primitives);
  corrupt[at + 12] = 2;
  assert.throws(() => decodeRitoReaderPrimitiveList(corrupt), /cluster joins boolean tag: 2/);
});
