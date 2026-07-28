import 'dart:typed_data';

import 'wire_writer.dart';

const String testRelativeImageHref = '../Images/cover.png';

Uint8List displayFixture({
  int? unknownOpcode,
  int transformTag = 1,
  int transformLengthTag = 1,
  int pageColorOptionTag = 1,
  int pageColorSpaceTag = 1,
  int pageColorFlags = 0,
  double pageColorRed = .2,
  int backgroundSizeTag = 2,
  int backgroundRepeatTag = 2,
  int blockRadiusTag = 1,
  int shadowInsetTag = 0,
  int fontStyleTag = 1,
  int decorationKindTag = 1,
  int horizontalRuleStyleTag = 5,
  double translateDx = 1,
}) {
  final writer = TestWireWriter.raw();
  writer.bytes.addAll('RITODL1'.codeUnits);
  writer
    ..uint32(1)
    ..uint32(12)
    ..uint16(1)
    ..uint16(2)
    ..uint16(unknownOpcode ?? 3)
    ..float64(translateDx)
    ..float64(2)
    ..uint16(4)
    ..float64(.75);
  _transform(writer, transformTag, transformLengthTag);
  writer.uint16(6);
  _rect(writer);
  writer.option(() {
    writer
      ..float64(2)
      ..float64(3);
  });
  writer.uint16(7);
  _rect(writer);
  writer.uint8(pageColorOptionTag);
  if (pageColorOptionTag == 1) {
    _color(
      writer,
      spaceTag: pageColorSpaceTag,
      red: pageColorRed,
      flags: pageColorFlags,
    );
  }
  writer.uint16(8);
  _rect(writer);
  _blockPaint(
    writer,
    backgroundSizeTag: backgroundSizeTag,
    backgroundRepeatTag: backgroundRepeatTag,
    blockRadiusTag: blockRadiusTag,
    shadowInsetTag: shadowInsetTag,
  );
  writer.option(() {
    writer
      ..float64(1)
      ..float64(0)
      ..float64(1)
      ..float64(0);
  });
  _text(
    writer,
    9,
    'body',
    fontStyleTag: fontStyleTag,
    decorationKindTag: decorationKindTag,
  );
  _text(writer, 10, 'ruby');
  writer
    ..uint16(11)
    ..string(testRelativeImageHref);
  _rect(writer);
  writer.option(() => writer.string('cover'));
  writer.option(null);
  writer.option(() => _rect(writer));
  writer.uint16(12);
  _rect(writer);
  _color(writer, red: 0, green: 0, blue: 0);
  writer.uint8(horizontalRuleStyleTag);
  return Uint8List.fromList(writer.bytes);
}

void _transform(TestWireWriter writer, int firstTag, int lengthTag) {
  writer
    ..uint16(5)
    ..float64(0)
    ..float64(0)
    ..float64(20)
    ..float64(30)
    ..uint32(3)
    ..uint8(firstTag);
  if (firstTag == 1) {
    writer.float64(.5);
  }
  writer
    ..uint8(2)
    ..float64(2)
    ..float64(3)
    ..uint8(3)
    ..uint8(lengthTag)
    ..float64(4)
    ..uint8(2)
    ..float64(50);
}

void _blockPaint(
  TestWireWriter writer, {
  required int backgroundSizeTag,
  required int backgroundRepeatTag,
  required int blockRadiusTag,
  required int shadowInsetTag,
}) {
  writer.option(() {
    writer.option(() => _color(writer));
    writer.option(() => writer.string(testRelativeImageHref));
    writer.option(() => writer.uint8(backgroundSizeTag));
    writer.option(() => writer.uint8(backgroundRepeatTag));
    writer.option(() {
      writer
        ..uint8(2)
        ..float64(50)
        ..uint8(1)
        ..float64(0);
    });
  });
  writer.option(() {
    writer.option(() => _borderEdge(writer));
    writer.option(null);
    writer.option(() => _borderEdge(writer, styleTag: 4));
    writer.option(null);
  });
  writer.option(() {
    writer
      ..uint8(blockRadiusTag);
    if (blockRadiusTag == 3) {
      writer
        ..float64(4)
        ..float64(3)
        ..float64(2);
    }
    writer
      ..float64(3);
  });
  writer
    ..uint32(1)
    ..float64(1)
    ..float64(2)
    ..float64(3)
    ..float64(0);
  _color(writer, alpha: .5);
  writer.uint8(shadowInsetTag);
}

void _text(
  TestWireWriter writer,
  int opcode,
  String text, {
  int fontStyleTag = 1,
  int decorationKindTag = 1,
}) {
  writer
    ..uint16(opcode)
    ..string(text);
  _rect(writer);
  writer
    ..string('Rito Serif')
    ..float64(16)
    ..float64(400)
    ..uint8(fontStyleTag);
  _color(writer, red: .1, green: .2, blue: .3);
  writer.option(() => writer.float64(1));
  writer.option(() => writer.float64(.5));
  writer.option(() => _color(writer, red: .9, green: .9, blue: .9));
  writer.option(() => writer.float64(2));
  writer
    ..uint32(1)
    ..float64(1)
    ..float64(1)
    ..float64(2);
  _color(writer, alpha: .4);
  writer.option(() {
    writer
      ..uint8(decorationKindTag)
      ..float64(14)
      ..float64(1);
    _color(writer, red: .2, green: .3, blue: .4);
  });
  writer.option(() {
    writer
      ..float64(1)
      ..float64(2)
      ..float64(1)
      ..float64(2);
  });
  writer.option(() {
    writer.option(() {
      writer.float64(1);
      _borderEdge(writer);
    });
    writer.option(null);
    writer.option(() {
      writer.float64(1);
      _borderEdge(writer);
    });
    writer.option(null);
  });
  writer.option(() => writer.float64(18));
  writer.option(() => writer.string('#note'));
  writer.option(() => writer.string('source $text'));
  writer.option(() => writer.uint64(9));
}

void _borderEdge(TestWireWriter writer, {int styleTag = 5}) {
  _color(writer, red: .25, green: .3, blue: .35);
  writer.uint8(styleTag);
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
