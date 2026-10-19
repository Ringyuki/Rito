import 'dart:typed_data';

import 'package:rito_flutter/rito_flutter_protocol.dart'
    show RitoPrimitiveListDecoder;

import 'wire_writer.dart';

const String testRelativeImageHref = '../Images/cover.png';

/// A hand-written `RITODL1` primitive list in the current format: one of every
/// primitive, every optional field present, with the typed enum tags the
/// decoder tests vary. Thirteen primitives, opcodes 1 through 13 in order.
Uint8List primitiveFixture({
  int? unknownOpcode,
  int version = RitoPrimitiveListDecoder.formatVersion,
  double ratio = 1,
  int transformTag = 1,
  int pathOpTag = 1,
  int groundTag = 2,
  int fillRuleTag = 2,
  int strokeCapTag = 2,
  int fillColorSpaceTag = 1,
  int fillColorFlags = 0,
  double fillColorRed = .2,
  int fontStyleTag = 1,
  double translateDx = 1,
}) {
  final writer = TestWireWriter.raw();
  writer.bytes.addAll('RITODL1'.codeUnits);
  writer
    ..uint32(version)
    ..float64(ratio)
    ..uint32(13)
    ..uint16(1)
    ..uint16(2)
    ..uint16(unknownOpcode ?? 3)
    ..float64(translateDx)
    ..float64(2)
    ..uint16(4)
    ..float64(.75);
  _transform(writer, transformTag);
  writer.uint16(6);
  _path(writer, firstTag: pathOpTag);
  writer.uint16(7);
  _rect(writer);
  _color(
    writer,
    spaceTag: fillColorSpaceTag,
    red: fillColorRed,
    flags: fillColorFlags,
  );
  _ground(writer, groundTag);
  writer.uint16(8);
  _path(writer);
  writer.uint8(fillRuleTag);
  _color(writer);
  _ground(writer, 3);
  writer.uint16(9);
  _path(writer);
  writer.float64(1.5);
  _color(writer);
  writer.uint8(strokeCapTag);
  writer.option(() {
    writer
      ..float64(3)
      ..float64(2);
  });
  writer.uint16(10);
  _path(writer);
  writer
    ..float64(1.5)
    ..float64(1)
    ..float64(2);
  _color(writer, alpha: .5);
  writer.option(() => _path(writer));
  writer
    ..uint16(11)
    ..string(testRelativeImageHref);
  _rect(writer);
  writer.option(() => _rect(writer));
  writer.option(() {
    writer
      ..float64(0)
      ..float64(0)
      ..float64(16)
      ..float64(16)
      ..uint32(2)
      ..uint32(3);
  });
  // The text run indexes the first two clusters, the first paint and
  // `body` in the text table; the annotation no clusters, the second paint
  // and `ruby`.
  _text(
    writer,
    12,
    'body',
    byteStart: 0,
    paint: 0,
    clusterStart: 0,
    clusters: 2,
  );
  _text(
    writer,
    13,
    'ruby',
    byteStart: 4,
    paint: 1,
    clusterStart: 2,
    clusters: 0,
  );
  _tables(writer, fontStyleTag: fontStyleTag);
  return Uint8List.fromList(writer.bytes);
}

void _transform(TestWireWriter writer, int firstTag) {
  writer
    ..uint16(5)
    ..float64(0)
    ..float64(0)
    ..uint32(3)
    ..uint8(firstTag);
  // A rotate carries one angle; a scale or translate carries two lengths.
  if (firstTag == 1) {
    writer.float64(.5);
  } else if (firstTag == 2 || firstTag == 3) {
    writer
      ..float64(2)
      ..float64(3);
  }
  writer
    ..uint8(2)
    ..float64(2)
    ..float64(3)
    ..uint8(3)
    ..float64(4)
    ..float64(5);
}

void _path(TestWireWriter writer, {int firstTag = 1}) {
  writer
    ..uint32(6)
    ..uint8(firstTag);
  // Move/line carry a point, an arc six lengths, an ellipse or rect four,
  // close nothing.
  final lengths = switch (firstTag) {
    1 || 2 => 2,
    3 => 6,
    4 || 5 => 4,
    _ => 0,
  };
  for (var index = 0; index < lengths; index += 1) {
    writer.float64(index + 1);
  }
  writer
    ..uint8(2)
    ..float64(3)
    ..float64(4)
    ..uint8(3)
    ..float64(5)
    ..float64(6)
    ..float64(7)
    ..float64(8)
    ..float64(0)
    ..float64(1.5)
    ..uint8(4)
    ..float64(9)
    ..float64(10)
    ..float64(2)
    ..float64(3)
    ..uint8(5);
  _rect(writer);
  writer.uint8(6);
}

void _ground(TestWireWriter writer, int tag) {
  writer.uint8(tag);
  if (tag == 3) {
    _rect(writer);
  }
}

void _text(
  TestWireWriter writer,
  int opcode,
  String text, {
  required int byteStart,
  required int paint,
  required int clusterStart,
  required int clusters,
}) {
  // Both texts are four ASCII characters: bytes and UTF-16 units agree.
  writer
    ..uint16(opcode)
    ..uint32(byteStart)
    ..uint32(4)
    ..uint32(byteStart)
    ..uint32(4);
  _rect(writer);
  writer.uint32(paint);
  writer.option(() => writer.float64(18));
  writer.option(() => writer.string('#note'));
  writer.option(() => writer.string('source $text'));
  writer.option(() => writer.uint64(9));
  writer
    ..uint32(clusterStart)
    ..uint32(clusters);
}

/// The tables after the primitives: two clusters, the second joining the
/// first; the two runs' text; the text run's paint and the annotation's.
void _tables(TestWireWriter writer, {required int fontStyleTag}) {
  writer.uint32(2);
  while (writer.bytes.length % 4 != 0) {
    writer.uint8(0);
  }
  writer
    ..uint32(0)
    ..uint32(2)
    ..float32(0)
    ..float32(12.5)
    ..float32(8.5)
    ..float32(12.5)
    ..uint8(0)
    ..uint8(1)
    ..string('bodyruby')
    ..uint32(2);
  _paint(writer, fontStyleTag);
  _paint(writer, 1);
}

void _paint(TestWireWriter writer, int fontStyleTag) {
  writer
    ..string('Rito Serif')
    ..float64(16)
    ..float64(400)
    ..uint8(fontStyleTag);
  _color(writer, red: .1, green: .2, blue: .3);
  writer
    ..uint32(1)
    ..float64(1)
    ..float64(1)
    ..float64(2);
  _color(writer, alpha: .4);
}

void _color(
  TestWireWriter writer, {
  int spaceTag = 1,
  double red = .2,
  double green = .4,
  double blue = .6,
  double alpha = 1,
  int flags = 0,
}) {
  writer
    ..uint8(spaceTag)
    ..float32(red)
    ..float32(green)
    ..float32(blue)
    ..float32(alpha)
    ..uint8(flags);
}

void _rect(TestWireWriter writer) {
  writer
    ..float64(4)
    ..float64(5)
    ..float64(20)
    ..float64(30);
}
