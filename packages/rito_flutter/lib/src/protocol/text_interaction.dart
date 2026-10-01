import 'dart:convert';
import 'dart:typed_data';

import 'artifact_models.dart';
import 'binary_reader.dart';
import 'exact_source_range.dart';
import 'text_geometry.dart';

/// A point on one of an artifact's pages, in its display-list space —
/// the space [RitoHitEntry.bounds] uses.
final class RitoTextPoint {
  const RitoTextPoint({
    required this.pageIndex,
    required this.x,
    required this.y,
  });

  final int pageIndex;
  final double x;
  final double y;
}

/// Which side of a line break a caret sits on when one text offset is
/// both a line's end and the next line's start.
enum RitoCaretAffinity { upstream, downstream }

/// A caret between two shaped clusters. It addresses the revision behind
/// the artifact it came from: pass it back only with artifacts of that
/// revision.
final class RitoCaretAddress {
  const RitoCaretAddress({
    required this.pageIndex,
    required this.position,
    required this.affinity,
  });

  final int pageIndex;
  final RitoTextPosition position;
  final RitoCaretAffinity affinity;
}

/// A caret's line in display-list space: its top and its height.
final class RitoCaretGeometry {
  const RitoCaretGeometry({
    required this.x,
    required this.y,
    required this.height,
  });

  final double x;
  final double y;
  final double height;
}

final class RitoCaret {
  const RitoCaret({
    required this.address,
    required this.geometry,
    required this.href,
    required this.sourcePoint,
  });

  final RitoCaretAddress address;

  /// Present when the caret's page is one the artifact draws.
  final RitoCaretGeometry? geometry;

  /// Canonical manifest href and source point the caret sits at.
  final String href;
  final RitoSourcePoint sourcePoint;
}

/// A resolved text range. [start] and [end] are [anchor] and [focus] in
/// document order; [rects] cover only the pages the artifact draws.
final class RitoTextSelection {
  RitoTextSelection({
    required this.anchor,
    required this.focus,
    required this.start,
    required this.end,
    required this.selectedText,
    required this.sourceStartHref,
    required this.sourceStart,
    required this.sourceEndHref,
    required this.sourceEnd,
    required List<RitoExactSourceRect> rects,
  }) : rects = List<RitoExactSourceRect>.unmodifiable(rects);

  final RitoCaretAddress anchor;
  final RitoCaretAddress focus;
  final RitoCaretAddress start;
  final RitoCaretAddress end;
  final String selectedText;

  /// Durable source identity of the normalized endpoints. The hrefs
  /// differ only for a range that crosses resources.
  final String sourceStartHref;
  final RitoSourcePoint sourceStart;
  final String sourceEndHref;
  final RitoSourcePoint sourceEnd;
  final List<RitoExactSourceRect> rects;
}

/// How far a range from two points extends past them.
enum RitoSelectionGranularity { word, paragraph }

/// A keyboard-style caret step, in the order the wire tags them.
enum RitoSelectionMovement {
  characterLeft,
  characterRight,
  wordLeft,
  wordRight,
  wordStartRight,
  lineUp,
  lineDown,
  lineStart,
  lineEnd,
  pageUp,
  pageDown,
  paragraphBackward,
  paragraphForward,
  paragraphPreviousStart,
  paragraphNextStart,
  chapterStart,
  chapterEnd,
  documentStart,
  documentEnd,
}

enum RitoSelectionBoundary { start, end }

enum RitoTextInteractionUnavailableReason {
  shapeUnavailable,
  sourceUnavailable,
  unsupportedTransform,
  visualGeometryUnavailable,
  invalidCaret,
  differentChapter,
}

/// One text interaction against an artifact. These are the five queries
/// a browser reader runs, answered by the same engine code.
sealed class RitoTextInteractionQuery {
  const RitoTextInteractionQuery();
}

/// The caret nearest a point.
final class RitoCaretQuery extends RitoTextInteractionQuery {
  const RitoCaretQuery(this.point);

  final RitoTextPoint point;
}

/// The range between two carets, as when a handle is dropped.
final class RitoRangeQuery extends RitoTextInteractionQuery {
  const RitoRangeQuery({required this.anchor, required this.focus});

  final RitoCaretAddress anchor;
  final RitoCaretAddress focus;
}

/// The range from a kept caret to a point, as while a handle or a
/// character-wise drag moves.
final class RitoRangeToPointQuery extends RitoTextInteractionQuery {
  const RitoRangeToPointQuery({required this.anchor, required this.focus});

  final RitoCaretAddress anchor;
  final RitoTextPoint focus;
}

/// The range two points span, widened to whole words or paragraphs.
final class RitoRangeFromPointsQuery extends RitoTextInteractionQuery {
  const RitoRangeFromPointsQuery({
    required this.anchor,
    required this.focus,
    required this.granularity,
  });

  final RitoTextPoint anchor;
  final RitoTextPoint focus;
  final RitoSelectionGranularity granularity;
}

/// The focus caret moved by a keyboard-style step. Pass back the
/// preferred positions the previous movement returned so vertical steps
/// keep their column.
final class RitoMovementQuery extends RitoTextInteractionQuery {
  const RitoMovementQuery({
    required this.anchor,
    required this.focus,
    required this.movement,
    this.preferredInlinePosition,
    this.preferredBlockPosition,
  });

  final RitoCaretAddress anchor;
  final RitoCaretAddress focus;
  final RitoSelectionMovement movement;
  final double? preferredInlinePosition;
  final double? preferredBlockPosition;
}

final class RitoTextInteractionRequest {
  const RitoTextInteractionRequest({
    required this.sessionId,
    required this.artifactId,
    required this.query,
  });

  final int sessionId;
  final int artifactId;
  final RitoTextInteractionQuery query;
}

sealed class RitoTextInteractionResult {
  const RitoTextInteractionResult();
}

final class RitoCaretResult extends RitoTextInteractionResult {
  const RitoCaretResult(this.caret);

  final RitoCaret caret;
}

/// A resolved range. The carets are present for every query but
/// [RitoRangeQuery], the preferred positions only for [RitoMovementQuery].
final class RitoSelectionResult extends RitoTextInteractionResult {
  const RitoSelectionResult({
    required this.anchorCaret,
    required this.focusCaret,
    required this.selection,
    required this.preferredInlinePosition,
    required this.preferredBlockPosition,
  });

  final RitoCaret? anchorCaret;
  final RitoCaret? focusCaret;
  final RitoTextSelection selection;
  final double? preferredInlinePosition;
  final double? preferredBlockPosition;
}

/// The point is not over text.
final class RitoMissResult extends RitoTextInteractionResult {
  const RitoMissResult();
}

/// The movement leaves this revision through [boundary].
final class RitoBoundaryResult extends RitoTextInteractionResult {
  const RitoBoundaryResult(this.boundary);

  final RitoSelectionBoundary boundary;
}

/// The movement needs pages past [boundary] that are not laid out yet.
final class RitoPendingResult extends RitoTextInteractionResult {
  const RitoPendingResult(this.boundary);

  final RitoSelectionBoundary boundary;
}

final class RitoUnavailableResult extends RitoTextInteractionResult {
  const RitoUnavailableResult(this.reason);

  final RitoTextInteractionUnavailableReason reason;
}

final class RitoTextInteractionResponse {
  const RitoTextInteractionResponse({
    required this.artifactId,
    required this.result,
  });

  final int artifactId;
  final RitoTextInteractionResult result;
}

/// Decodes a RITOTIR1 message. Enum tags are declaration order, the
/// contract the engine's tag tables share.
final class RitoTextInteractionDecoder {
  const RitoTextInteractionDecoder();

  static final List<int> _magic = ascii.encode('RITOTIR1');

  RitoTextInteractionResponse decode(Uint8List bytes) {
    if (bytes.length > ritoMaxWireBytes) {
      throw const FormatException('RITOTIR1 exceeds the byte limit.');
    }
    final reader = RitoBinaryReader(bytes);
    reader.expectMagic(_magic, 'text interaction magic');
    final version = reader.uint32('text interaction wire version');
    if (version != 1) {
      reader.fail('unsupported text interaction wire version: $version');
    }
    if (reader.uint64('text interaction total length') != bytes.length) {
      reader.fail('text interaction total length does not match input');
    }
    final artifactId = reader.externalId('text interaction artifact id');
    final tag = reader.uint8('text interaction result tag');
    final RitoTextInteractionResult result = switch (tag) {
      0 => RitoCaretResult(_caret(reader)),
      1 => _selectionResult(reader),
      2 => const RitoMissResult(),
      3 => RitoBoundaryResult(_tag(reader, RitoSelectionBoundary.values)),
      4 => RitoPendingResult(_tag(reader, RitoSelectionBoundary.values)),
      5 => RitoUnavailableResult(
        _tag(reader, RitoTextInteractionUnavailableReason.values),
      ),
      _ => reader.fail('unknown text interaction result tag: $tag'),
    };
    reader.finish('text interaction wire message');
    return RitoTextInteractionResponse(artifactId: artifactId, result: result);
  }

  RitoSelectionResult _selectionResult(RitoBinaryReader reader) {
    final anchorCaret = reader.option('anchor caret', () => _caret(reader));
    final focusCaret = reader.option('focus caret', () => _caret(reader));
    final selection = _selection(reader);
    return RitoSelectionResult(
      anchorCaret: anchorCaret,
      focusCaret: focusCaret,
      selection: selection,
      preferredInlinePosition: reader.option(
        'preferred inline position',
        () => reader.float64('preferred inline position'),
      ),
      preferredBlockPosition: reader.option(
        'preferred block position',
        () => reader.float64('preferred block position'),
      ),
    );
  }

  RitoCaret _caret(RitoBinaryReader reader) {
    final record = reader.record('caret');
    final caret = RitoCaret(
      address: _address(record),
      geometry: record.option(
        'caret geometry',
        () => RitoCaretGeometry(
          x: record.float64('caret x'),
          y: record.float64('caret y'),
          height: record.float64('caret height'),
        ),
      ),
      href: record.string('caret href'),
      sourcePoint: _sourcePoint(record),
    );
    record.finish('caret');
    return caret;
  }

  RitoTextSelection _selection(RitoBinaryReader reader) {
    final record = reader.record('selection');
    final anchor = _address(record);
    final focus = _address(record);
    final start = _address(record);
    final end = _address(record);
    final selectedText = record.string('selected text');
    final startHref = record.string('selection start href');
    final sourceStart = _sourcePoint(record);
    final endHref = record.string('selection end href');
    final sourceEnd = _sourcePoint(record);
    final count = record.count('selection rects');
    final selection = RitoTextSelection(
      anchor: anchor,
      focus: focus,
      start: start,
      end: end,
      selectedText: selectedText,
      sourceStartHref: startHref,
      sourceStart: sourceStart,
      sourceEndHref: endHref,
      sourceEnd: sourceEnd,
      rects: [for (var index = 0; index < count; index += 1) _rect(record)],
    );
    record.finish('selection');
    return selection;
  }

  RitoCaretAddress _address(RitoBinaryReader reader) {
    final record = reader.record('caret address');
    final address = RitoCaretAddress(
      pageIndex: record.uint32('caret page index'),
      position: RitoTextPosition(
        blockIndex: record.uint32('caret block index'),
        lineIndex: record.uint32('caret line index'),
        runIndex: record.uint32('caret run index'),
        charIndex: record.uint32('caret char index'),
      ),
      affinity: _tag(record, RitoCaretAffinity.values),
    );
    record.finish('caret address');
    return address;
  }

  RitoSourcePoint _sourcePoint(RitoBinaryReader reader) {
    final record = reader.record('source point');
    final count = record.count('source point path');
    final point = RitoSourcePoint(
      nodePath: [
        for (var index = 0; index < count; index += 1)
          record.uint32('source point path segment'),
      ],
      textOffset: record.uint64('source point text offset'),
    );
    record.finish('source point');
    return point;
  }

  RitoExactSourceRect _rect(RitoBinaryReader reader) {
    final record = reader.record('selection rect');
    final rect = RitoExactSourceRect(
      pageIndex: record.uint32('selection rect page index'),
      bounds: RitoRect(
        x: record.float64('selection rect x'),
        y: record.float64('selection rect y'),
        width: record.float64('selection rect width'),
        height: record.float64('selection rect height'),
      ),
      blockIndex: record.uint32('selection rect block index'),
      lineIndex: record.uint32('selection rect line index'),
      runIndex: record.uint32('selection rect run index'),
      startCharIndex: record.uint32('selection rect start char index'),
      endCharIndex: record.uint32('selection rect end char index'),
    );
    record.finish('selection rect');
    return rect;
  }

  T _tag<T>(RitoBinaryReader reader, List<T> values) {
    final tag = reader.uint8('enum tag');
    if (tag >= values.length) {
      reader.fail('unknown ${T.toString()} tag: $tag');
    }
    return values[tag];
  }
}
