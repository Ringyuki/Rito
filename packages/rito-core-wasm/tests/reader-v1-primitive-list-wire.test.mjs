// Decodes bytes the live Rust encoder wrote (tests/fixtures/*.hex, kept in
// step by crates/rito-core's cross_language_wire_fixture_matches_the_encoder
// test). A hand-built fixture can agree with a stale reading of the wire;
// these cannot.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  READER_V1_PRIMITIVE_LIST_FORMAT_VERSION,
  decodeRitoReaderPrimitiveListV1,
} from '../src/reader-v1-primitive-decoder-runtime.js';

export function primitiveListFixture() {
  const hex = readFileSync(
    new URL('./fixtures/reader-v1-primitive-list.hex', import.meta.url),
    'utf8',
  ).trim();
  return Uint8Array.from(hex.match(/../g), (pair) => Number.parseInt(pair, 16));
}

test('decodes every primitive the Rust encoder writes', () => {
  const list = decodeRitoReaderPrimitiveListV1(primitiveListFixture());
  assert.equal(list.formatVersion, READER_V1_PRIMITIVE_LIST_FORMAT_VERSION);
  assert.equal(list.ratio, 2);
  assert.equal(list.commandCount, 13);
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
    ],
  );
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
  // The fixture's run is lowered at ratio 2: every CSS length doubled.
  const list = decodeRitoReaderPrimitiveListV1(primitiveListFixture());
  const text = list.commands[11];
  assert.equal(text.text, 'text');
  assert.deepEqual(text.rect, { x: 0, y: 0, width: 40, height: 60 });
  assert.deepEqual(text.paint.font, {
    family: 'Rito Serif',
    sizePx: 32,
    weight: 700,
    style: 'italic',
  });
  assert.equal(text.paint.color.space, 'srgb');
  assert.equal(text.paint.wordSpacingPx, 2);
  assert.equal(text.paint.letterSpacingPx, 1);
  assert.equal(text.paint.backgroundColor.space, 'display-p3');
  assert.equal(text.paint.backgroundColor.alpha, 0.5);
  assert.equal(text.paint.backgroundRadius, 4);
  assert.equal(text.paint.textShadows.length, 1);
  assert.deepEqual(
    [
      text.paint.textShadows[0].offsetX,
      text.paint.textShadows[0].offsetY,
      text.paint.textShadows[0].blur,
    ],
    [2, 4, 6],
  );
  assert.equal(text.paint.decoration.kind, 'line-through');
  assert.equal(text.paint.decoration.y, 36);
  assert.equal(text.paint.decoration.thickness, 2);
  assert.deepEqual(text.paint.padding, { top: 2, right: 4, bottom: 6, left: 8 });
  assert.equal(text.paint.border.top.widthPx, 2);
  assert.equal(text.paint.border.top.paint.style, 'solid');
  assert.equal(text.paint.border.start.widthPx, 4);
  assert.equal(text.paint.border.start.paint.style, 'dotted');
  assert.equal(text.paint.border.bottom, undefined);
  assert.equal(text.paint.border.end, undefined);
  assert.deepEqual(text.paint.boxOffsets, { top: -4, bottom: 44 });
  assert.equal(text.paint.boxStart, false);
  assert.equal(text.paint.boxEnd, true);
  assert.equal(text.lineHeightPx, 37);
  assert.equal(text.href, '#note');
  assert.equal(text.sourceText, 'source');
  assert.equal(text.sourceTextOffset, 9n);
  assert.equal(text.rubyAlign, 'center');
  assert.equal(text.alignRight, true);
  assert.equal(text.vertical, false);
});

test('the primitive decoder rejects format 1, truncation and trailing bytes', () => {
  const primitives = primitiveListFixture();
  const formatOne = Uint8Array.from(primitives);
  new DataView(formatOne.buffer).setUint32(7, 1, true);
  assert.throws(
    () => decodeRitoReaderPrimitiveListV1(formatOne),
    /unsupported primitive list version: 1/,
  );
  for (const end of [0, 7, 11, 19, 23, 25, primitives.length - 1]) {
    assert.throws(() => decodeRitoReaderPrimitiveListV1(primitives.subarray(0, end)));
  }
  const trailing = new Uint8Array(primitives.length + 1);
  trailing.set(primitives);
  assert.throws(() => decodeRitoReaderPrimitiveListV1(trailing), /trailing bytes/);
});
