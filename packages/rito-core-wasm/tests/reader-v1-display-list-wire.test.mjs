// Decodes bytes the live Rust encoders wrote (tests/fixtures/*.hex, kept
// in step by crates/rito-core's cross_language_wire_fixtures_match_the_encoders
// test). A hand-built fixture can agree with a stale reading of the wire;
// these cannot.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { decodeRitoReaderDisplayListV1 } from '../src/reader-v1-display-decoder-runtime.js';
import {
  READER_V1_PRIMITIVE_LIST_FORMAT_VERSION,
  decodeRitoReaderPrimitiveListV1,
} from '../src/reader-v1-primitive-decoder-runtime.js';

function fixture(name) {
  const hex = readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8').trim();
  return Uint8Array.from(hex.match(/../g), (pair) => Number.parseInt(pair, 16));
}

test('decodes every display command the Rust encoder writes, optional tails included', () => {
  const list = decodeRitoReaderDisplayListV1(fixture('reader-v1-display-list.hex'));
  assert.equal(list.formatVersion, 1);
  assert.equal(list.commandCount, 14);
  assert.deepEqual(
    list.commands.map((command) => command.opcode),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 9, 8],
  );

  const text = list.commands[12];
  assert.equal(text.kind, 'paint-text');
  assert.equal(text.text, 'run');
  assert.deepEqual(text.rect, { x: 1.5, y: 2, width: 10, height: 20 });
  assert.equal(text.paint.font.weight, 700);
  assert.equal(text.paint.font.style, 'italic');
  assert.equal(text.paint.backgroundColor.space, 'display-p3');
  assert.equal(text.paint.decoration.kind, 'line-through');
  assert.equal(text.paint.border.start.widthPx, 2);
  assert.equal(text.paint.border.start.paint.style, 'dotted');
  assert.deepEqual(text.paint.boxOffsets, { top: -2, bottom: 22 });
  assert.equal(text.paint.boxStart, false);
  assert.equal(text.paint.boxEnd, true);
  assert.equal(text.lineHeightPx, 24);
  assert.equal(text.href, '#note');
  assert.equal(text.sourceTextOffset, 9n);
  assert.equal(text.rubyAlign, 'center');

  const block = list.commands[13];
  assert.equal(block.kind, 'paint-block');
  assert.deepEqual(block.paint.background.size, { x: { unit: 'px', value: 10 }, y: undefined });
  assert.equal(block.paint.background.repeat, 'repeat-x');
  assert.deepEqual(block.paint.background.position, {
    x: { unit: 'percent', value: 50 },
    y: { unit: 'px', value: 4 },
  });
  assert.equal(block.paint.border.left.style, 'double');
  assert.deepEqual(block.paint.radius, { unit: 'corners', corners: [1, 2, 3, 4] });
  assert.equal(block.paint.boxShadows.length, 2);
  assert.equal(block.paint.boxShadows[0].inset, true);
  assert.equal(block.paint.boxShadows[1].offsetX, -1);
  assert.deepEqual(block.borderBox, { topWidth: 1, rightWidth: 2, bottomWidth: 3, leftWidth: 4 });
});

test('decodes every primitive the Rust encoder writes', () => {
  const list = decodeRitoReaderPrimitiveListV1(fixture('reader-v1-primitive-list.hex'));
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
      'block',
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
  assert.equal(fill.color.component2, 0.75);
  assert.equal(list.commands[7].rule, 'evenodd');
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
  const text = list.commands[11];
  assert.equal(text.text, 'text');
  assert.equal(text.paint.font.family, 'Rito Serif');
  assert.equal(text.lineHeightPx, 37);
  assert.equal(text.sourceTextOffset, 9n);
  assert.equal(list.commands[12].kind, 'ruby');
  const block = list.commands[13];
  assert.equal(block.paint.background.image, 'images/background.png');
  assert.deepEqual(block.paint.radius, { unit: 'px', value: 6 });
  assert.equal(block.paint.boxShadows[0].blur, 6);
  assert.deepEqual(block.borderBox, { topWidth: 2, rightWidth: 0, bottomWidth: 0, leftWidth: 0 });
});

test('the primitive decoder rejects format 1, truncation and trailing bytes', () => {
  const display = fixture('reader-v1-display-list.hex');
  assert.throws(
    () => decodeRitoReaderPrimitiveListV1(display),
    /unsupported primitive list version: 1/,
  );
  const primitives = fixture('reader-v1-primitive-list.hex');
  assert.throws(
    () => decodeRitoReaderDisplayListV1(primitives),
    /unsupported display list version: 2/,
  );
  for (const end of [0, 7, 11, 19, 23, 25, primitives.length - 1]) {
    assert.throws(() => decodeRitoReaderPrimitiveListV1(primitives.subarray(0, end)));
  }
  const trailing = new Uint8Array(primitives.length + 1);
  trailing.set(primitives);
  assert.throws(() => decodeRitoReaderPrimitiveListV1(trailing), /trailing bytes/);
});
