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

/// A text or ruby run as its primitive carries it: its rect and optional
/// fields, and where its text, paint and clusters sit in the tables after
/// the primitives.
final class _RitoTextReference {
  _RitoTextReference({
    required this.ruby,
    required this.unitStart,
    required this.unitLength,
    required this.rect,
    required this.paintIndex,
    required this.lineHeightPx,
    required this.href,
    required this.sourceText,
    required this.sourceTextOffset,
    required this.clusterStart,
    required this.clusterCount,
  });

  final bool ruby;
  final int unitStart;
  final int unitLength;
  final RitoDisplayRect rect;
  final int paintIndex;
  final double? lineHeightPx;
  final String? href;
  final String? sourceText;
  final int? sourceTextOffset;
  final int clusterStart;
  final int clusterCount;
}

_RitoTextReference _readTextReference(
  RitoBinaryReader reader, {
  required bool ruby,
}) {
  // The run's byte range in the text table, which a UTF-16 reader skips.
  reader.uint32('text byte start');
  reader.uint32('text byte length');
  return _RitoTextReference(
    ruby: ruby,
    unitStart: reader.uint32('text start'),
    unitLength: reader.uint32('text length'),
    rect: reader.readDisplayRect('text rect'),
    paintIndex: reader.uint32('text paint'),
    lineHeightPx: reader.option(
      'text line height',
      () => reader.float64('text line height'),
    ),
    href: reader.option('text href', () => reader.string('text href')),
    sourceText: reader.option(
      'source text',
      () => reader.string('source text'),
    ),
    sourceTextOffset: reader.option(
      'source text offset',
      () => reader.uint64('source text offset'),
    ),
    clusterStart: reader.uint32('text cluster start'),
    clusterCount: reader.uint32('text cluster count'),
  );
}

/// The tables the runs index into: every cluster's byte, origin and joins
/// flag as typed views of the message itself, the text decoded once and
/// each distinct paint decoded once. A table the message does not hold on
/// a four-byte boundary is copied out once, as a whole.
final class _RitoTextTables {
  _RitoTextTables({
    required this.count,
    required this.bytes,
    required this.origins,
    required this.joins,
    required this.text,
    required this.paints,
  });

  final int count;
  final Uint32List bytes;
  final Float32List origins;
  final Uint8List joins;
  final String text;
  final List<RitoRunPaint> paints;
}

_RitoTextTables _readTextTables(RitoBinaryReader reader) {
  final count = reader.count('cluster table count');
  while (reader.offset % 4 != 0) {
    if (reader.uint8('cluster table padding') != 0) {
      reader.fail('cluster table padding is not zero');
    }
  }
  final table = reader.take(count * 13, 'cluster table');
  final joins = Uint8List.sublistView(table, count * 12);
  for (var index = 0; index < count; index += 1) {
    if (joins[index] > 1) {
      reader.fail('unknown cluster joins boolean tag: ${joins[index]}');
    }
  }
  final (bytes, origins) = _clusterTable(table, count);
  final text = reader.string('text table');
  final paintCount = reader.count('paint count');
  final paints = <RitoRunPaint>[
    for (var index = 0; index < paintCount; index += 1) reader.readRunPaint(),
  ];
  return _RitoTextTables(
    count: count,
    bytes: bytes,
    origins: origins,
    joins: joins,
    text: text,
    paints: paints,
  );
}

(Uint32List, Float32List) _clusterTable(Uint8List table, int count) {
  final little = Endian.host == Endian.little;
  if (little && table.offsetInBytes % 4 == 0) {
    return (
      table.buffer.asUint32List(table.offsetInBytes, count),
      table.buffer.asFloat32List(table.offsetInBytes + count * 4, count * 2),
    );
  }
  if (little) {
    return _clusterTable(Uint8List.fromList(table), count);
  }
  final data = ByteData.sublistView(table);
  final bytes = Uint32List(count);
  final origins = Float32List(count * 2);
  for (var index = 0; index < count; index += 1) {
    bytes[index] = data.getUint32(index * 4, Endian.little);
    origins[index * 2] = data.getFloat32(count * 4 + index * 8, Endian.little);
    origins[index * 2 + 1] = data.getFloat32(
      count * 4 + index * 8 + 4,
      Endian.little,
    );
  }
  return (bytes, origins);
}

/// A run as a painter reads it, from its reference into the tables.
RitoTextPaintCommand _resolveTextRun(
  RitoBinaryReader reader,
  _RitoTextReference run,
  _RitoTextTables tables,
) {
  final end = run.clusterStart + run.clusterCount;
  if (run.paintIndex >= tables.paints.length ||
      run.unitStart + run.unitLength > tables.text.length ||
      end > tables.count) {
    reader.fail('text run reaches past the tables');
  }
  final text = tables.text.substring(
    run.unitStart,
    run.unitStart + run.unitLength,
  );
  final paint = tables.paints[run.paintIndex];
  final clusters = RitoClusters(
    bytes: Uint32List.sublistView(tables.bytes, run.clusterStart, end),
    origins: Float32List.sublistView(
      tables.origins,
      run.clusterStart * 2,
      end * 2,
    ),
    joins: Uint8List.sublistView(tables.joins, run.clusterStart, end),
  );
  if (run.ruby) {
    return RitoPaintRuby(
      text: text,
      rect: run.rect,
      paint: paint,
      lineHeightPx: run.lineHeightPx,
      href: run.href,
      sourceText: run.sourceText,
      sourceTextOffset: run.sourceTextOffset,
      clusters: clusters,
    );
  }
  return RitoPaintText(
    text: text,
    rect: run.rect,
    paint: paint,
    lineHeightPx: run.lineHeightPx,
    href: run.href,
    sourceText: run.sourceText,
    sourceTextOffset: run.sourceTextOffset,
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
