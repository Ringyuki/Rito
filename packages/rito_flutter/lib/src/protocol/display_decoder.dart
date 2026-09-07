import 'dart:convert';
import 'dart:typed_data';

import 'binary_reader.dart';
import 'display_color.dart';
import 'display_geometry.dart';
import 'display_models.dart';
import 'display_paint.dart';
import 'primitive_models.dart';

part 'display_decoder_paint.dart';
part 'primitive_decoder.dart';

extension _RitoDisplayGeometryReader on RitoBinaryReader {
  RitoDisplayRect readDisplayRect(String field) {
    return RitoDisplayRect(
      x: float64('$field x'),
      y: float64('$field y'),
      width: float64('$field width'),
      height: float64('$field height'),
    );
  }
}

/// The text run body the text and ruby primitives share.
RitoTextPaintCommand _readTextRun(
  RitoBinaryReader reader, {
  required bool ruby,
}) {
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
  final rubyAlign = reader.option(
    'ruby align',
    () => reader.string('ruby align'),
  );
  final vertical = reader.boolean('text vertical');
  final clusterCount = reader.count('cluster count');
  final clusters = <RitoClusterPosition>[];
  for (var index = 0; index < clusterCount; index += 1) {
    clusters.add(
      RitoClusterPosition(
        byte: reader.uint32('cluster byte'),
        x: reader.float64('cluster x'),
      ),
    );
  }
  if (ruby) {
    return RitoPaintRuby(
      text: text,
      rect: rect,
      paint: paint,
      lineHeightPx: lineHeight,
      href: href,
      sourceText: sourceText,
      sourceTextOffset: sourceOffset,
      rubyAlign: rubyAlign,
      vertical: vertical,
      clusters: clusters,
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
    rubyAlign: rubyAlign,
    vertical: vertical,
    clusters: clusters,
  );
}

T _wireEnum<T>(RitoBinaryReader reader, String field, List<T> values) {
  final tag = reader.uint8('$field tag');
  if (tag == 0 || tag > values.length) {
    reader.fail('unknown $field tag: $tag');
  }
  return values[tag - 1];
}
