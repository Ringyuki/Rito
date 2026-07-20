import 'dart:convert';
import 'dart:typed_data';

import 'binary_reader.dart';
import 'display_color.dart';
import 'display_geometry.dart';
import 'display_models.dart';
import 'display_paint.dart';

part 'display_decoder_paint.dart';

/// Strict little-endian decoder for Core's typed `RITODL1` V1 contract.
final class RitoDisplayListDecoder {
  const RitoDisplayListDecoder();

  static const int formatVersion = 1;
  static final List<int> _magic = ascii.encode('RITODL1');

  RitoDisplayList decode(Uint8List bytes) {
    if (bytes.length > ritoMaxWireBytes) {
      throw const FormatException('RITODL1 exceeds the byte limit.');
    }
    final reader = RitoBinaryReader(bytes);
    reader.expectMagic(_magic, 'display list magic');
    final version = reader.uint32('display list version');
    if (version != formatVersion) {
      reader.fail('unsupported display list version: $version');
    }
    final count = reader.count('display command count');
    final commands = <RitoCommand>[];
    for (var index = 0; index < count; index += 1) {
      commands.add(_command(reader));
    }
    reader.finish('display list');
    return RitoDisplayList(formatVersion: version, commands: commands);
  }

  RitoCommand _command(RitoBinaryReader reader) {
    final opcode = reader.uint16('display command opcode');
    return switch (opcode) {
      1 => const RitoPushState(),
      2 => const RitoPopState(),
      3 => RitoTranslate(
        dx: reader.float64('translate dx'),
        dy: reader.float64('translate dy'),
      ),
      4 => RitoOpacity(reader.float64('opacity')),
      5 => _transform(reader),
      6 => RitoClipRect(
        rect: reader.readDisplayRect('clip rect'),
        radius: reader.option(
          'clip radius',
          () => RitoCornerRadius(
            rx: reader.float64('clip radius rx'),
            ry: reader.float64('clip radius ry'),
          ),
        ),
      ),
      7 => RitoPaintPage(
        rect: reader.readDisplayRect('page rect'),
        paint: reader.readPagePaint(),
      ),
      8 => RitoPaintBlock(
        rect: reader.readDisplayRect('block rect'),
        paint: reader.readBlockPaint(),
        borderBox: reader.option('block border box', reader.readBorderBox),
      ),
      9 => _text(reader, ruby: false),
      10 => _text(reader, ruby: true),
      11 => RitoPaintImage(
        src: reader.string('image source'),
        rect: reader.readDisplayRect('image rect'),
        alt: reader.option(
          'image alternative',
          () => reader.string('image alternative'),
        ),
        href: reader.option('image href', () => reader.string('image href')),
      ),
      12 => RitoPaintHorizontalRule(
        rect: reader.readDisplayRect('horizontal rule rect'),
        paint: reader.readHorizontalRulePaint(),
      ),
      _ => reader.fail('unknown display command opcode: $opcode'),
    };
  }

  RitoTransform _transform(RitoBinaryReader reader) {
    final origin = RitoDisplayPoint(
      x: reader.float64('transform origin x'),
      y: reader.float64('transform origin y'),
    );
    final boxSize = RitoDisplaySize(
      width: reader.float64('transform box width'),
      height: reader.float64('transform box height'),
    );
    final count = reader.count('transform count');
    final transforms = <RitoTransformOperation>[];
    for (var index = 0; index < count; index += 1) {
      transforms.add(_transformOperation(reader));
    }
    return RitoTransform(
      origin: origin,
      boxSize: boxSize,
      transforms: transforms,
    );
  }

  RitoTransformOperation _transformOperation(RitoBinaryReader reader) {
    final tag = reader.uint8('transform tag');
    return switch (tag) {
      1 => RitoRotateTransform(reader.float64('transform rotation')),
      2 => RitoScaleTransform(
        sx: reader.float64('transform scale x'),
        sy: reader.float64('transform scale y'),
      ),
      3 => RitoTranslateTransform(
        x: reader.readLength('transform translation x'),
        y: reader.readLength('transform translation y'),
      ),
      _ => reader.fail('unknown transform tag: $tag'),
    };
  }

  RitoCommand _text(RitoBinaryReader reader, {required bool ruby}) {
    final text = reader.string('text');
    final rect = reader.readDisplayRect('text rect');
    final paint = reader.readRunPaint();
    final lineHeight = reader.option(
      'text line height',
      () => reader.float64('text line height'),
    );
    final href = reader.option('text href', () => reader.string('text href'));
    final sourceText = reader.option(
      'source text',
      () => reader.string('source text'),
    );
    final sourceOffset = reader.option(
      'source text offset',
      () => reader.uint64('source text offset'),
    );
    if (ruby) {
      return RitoPaintRuby(
        text: text,
        rect: rect,
        paint: paint,
        lineHeightPx: lineHeight,
        href: href,
        sourceText: sourceText,
        sourceTextOffset: sourceOffset,
      );
    }
    return RitoPaintText(
      text: text,
      rect: rect,
      paint: paint,
      lineHeightPx: lineHeight,
      href: href,
      sourceText: sourceText,
      sourceTextOffset: sourceOffset,
    );
  }
}

extension _RitoDisplayGeometryReader on RitoBinaryReader {
  RitoDisplayRect readDisplayRect(String field) {
    return RitoDisplayRect(
      x: float64('$field x'),
      y: float64('$field y'),
      width: float64('$field width'),
      height: float64('$field height'),
    );
  }

  RitoLength readLength(String field) {
    final tag = uint8('$field unit');
    return switch (tag) {
      1 => RitoPxLength(float64('$field value')),
      2 => RitoPercentLength(float64('$field value')),
      _ => fail('unknown $field unit tag: $tag'),
    };
  }
}

T _wireEnum<T>(RitoBinaryReader reader, String field, List<T> values) {
  final tag = reader.uint8('$field tag');
  if (tag == 0 || tag > values.length) {
    reader.fail('unknown $field tag: $tag');
  }
  return values[tag - 1];
}
