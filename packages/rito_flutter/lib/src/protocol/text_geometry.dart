import 'dart:convert';
import 'dart:typed_data';

import 'artifact_models.dart';
import 'binary_reader.dart';
import 'wire_message.dart';

/// A position inside a page's laid-out text, in the same coordinates
/// [RitoPage.textRuns] reports.
final class RitoTextPosition {
  const RitoTextPosition({
    required this.blockIndex,
    required this.lineIndex,
    required this.runIndex,
    required this.charIndex,
  });

  final int blockIndex;
  final int lineIndex;
  final int runIndex;

  /// Offset **in UTF-16 code units**, not characters — the same domain
  /// as [RitoTextRunOffset.start]/[RitoTextRunOffset.end] and as
  /// `RitoPage.text`, so `page.text` can be indexed with it directly.
  /// Dart's `String` is UTF-16, so plain `substring`/`length` agree;
  /// anything that counts user-perceived characters (`characters`,
  /// grapheme clusters) does not, and converting through it lands in
  /// the wrong place on CJK surrogate pairs and emoji.
  final int charIndex;
}

/// Asks where a text range sits on a page.
final class RitoTextRangeRequest {
  const RitoTextRangeRequest({
    required this.sessionId,
    required this.artifactId,
    required this.pageIndex,
    required this.start,
    required this.end,
  });

  final int sessionId;
  final int artifactId;
  final int pageIndex;
  final RitoTextPosition start;
  final RitoTextPosition end;
}

/// One run-aligned rectangle of a resolved text range.
final class RitoTextRect {
  const RitoTextRect({
    required this.bounds,
    required this.blockIndex,
    required this.lineIndex,
    required this.runIndex,
    required this.startCharIndex,
    required this.endCharIndex,
  });

  /// Display-list space, exactly like [RitoHitEntry.bounds]: paint it
  /// straight onto the surface the page was drawn on.
  final RitoRect bounds;
  final int blockIndex;
  final int lineIndex;
  final int runIndex;
  final int startCharIndex;
  final int endCharIndex;
}

final class RitoTextRangeGeometry {
  RitoTextRangeGeometry({
    required this.artifactId,
    required this.pageIndex,
    required List<RitoTextRect> rects,
  }) : rects = List<RitoTextRect>.unmodifiable(rects);

  final int artifactId;
  final int pageIndex;
  final List<RitoTextRect> rects;
}

final class RitoTextGeometryEncoder {
  const RitoTextGeometryEncoder();

  /// Byte length of every RITOTRQ1 message; the shape is fixed.
  static const int requestWireBytes = 72;

  Uint8List encodeRequest(RitoTextRangeRequest request) {
    final writer = RitoFixedMessageWriter('RITOTRQ1');
    writer.externalId(request.sessionId, 'session id');
    writer.externalId(request.artifactId, 'artifact id');
    writer.uint32(request.pageIndex, 'page index');
    _position(writer, request.start, 'start');
    _position(writer, request.end, 'end');
    return writer.finish(magic: 'RITOTRQ1', expectedBytes: requestWireBytes);
  }

  void _position(
    RitoFixedMessageWriter writer,
    RitoTextPosition value,
    String field,
  ) {
    writer.uint32(value.blockIndex, '$field block index');
    writer.uint32(value.lineIndex, '$field line index');
    writer.uint32(value.runIndex, '$field run index');
    writer.uint32(value.charIndex, '$field char index');
  }
}

final class RitoTextGeometryDecoder {
  const RitoTextGeometryDecoder();

  static final List<int> _magic = ascii.encode('RITOTRG1');

  RitoTextRangeGeometry decode(Uint8List bytes) {
    if (bytes.length > ritoMaxWireBytes) {
      throw const FormatException('RITOTRG1 exceeds the byte limit.');
    }
    final reader = RitoBinaryReader(bytes);
    reader.expectMagic(_magic, 'text range geometry magic');
    final version = reader.uint32('text range geometry wire version');
    if (version != 1) {
      reader.fail('unsupported text range geometry wire version: $version');
    }
    final declaredLength = reader.uint64('text range geometry total length');
    if (declaredLength != bytes.length) {
      reader.fail('text range geometry total length does not match input');
    }
    final artifactId = reader.externalId('text range geometry artifact id');
    final pageIndex = reader.uint32('text range geometry page index');
    final count = reader.count('text range rects');
    final rects = <RitoTextRect>[
      for (var index = 0; index < count; index += 1) _rect(reader),
    ];
    final geometry = RitoTextRangeGeometry(
      artifactId: artifactId,
      pageIndex: pageIndex,
      rects: rects,
    );
    reader.finish('text range geometry wire message');
    return geometry;
  }

  RitoTextRect _rect(RitoBinaryReader reader) {
    final record = reader.record('text range rect');
    final rect = RitoTextRect(
      bounds: RitoRect(
        x: record.float64('text rect x'),
        y: record.float64('text rect y'),
        width: record.float64('text rect width'),
        height: record.float64('text rect height'),
      ),
      blockIndex: record.uint32('text rect block index'),
      lineIndex: record.uint32('text rect line index'),
      runIndex: record.uint32('text rect run index'),
      startCharIndex: record.uint32('text rect start char index'),
      endCharIndex: record.uint32('text rect end char index'),
    );
    record.finish('text range rect');
    return rect;
  }
}
