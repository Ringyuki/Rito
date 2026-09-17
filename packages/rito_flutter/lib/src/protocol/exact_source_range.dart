import 'dart:convert';
import 'dart:typed_data';

import 'artifact_models.dart';
import 'binary_reader.dart';

/// Asks where a durable source range lands on the pages an artifact
/// draws, so a stored annotation can be painted.
///
/// A host cannot work this out from [RitoArtifact.pages]. A run's
/// mapping back to its source node is piecewise — collapsed whitespace
/// leaves gaps, and a run split at a space shares its seam offset with
/// the next run — so the engine owns the projection. It also checks the
/// text it landed on against the range's own source text, so an anchor
/// whose text has since changed reports
/// [RitoExactSourceRangeStatus.unavailable] rather than painting over
/// whatever now occupies those offsets.
final class RitoExactSourceRangeRequest {
  const RitoExactSourceRangeRequest({
    required this.sessionId,
    required this.artifactId,
    required this.href,
    required this.range,
  });

  final int sessionId;
  final int artifactId;

  /// Manifest href of the resource the range was taken from, the same
  /// identity [RitoLocator.href] carries.
  final String href;
  final RitoSourceRange range;
}

/// What became of a durable source range.
enum RitoExactSourceRangeStatus {
  resolved,

  /// The range's chapter is not laid out yet. Ask again once the
  /// session covers it; the range itself is still good.
  pending,

  /// The range does not project onto this layout: the href is not in
  /// the publication, an endpoint has no source mapping, or the text
  /// the range was taken from is no longer there.
  unavailable,
}

/// One run-aligned rectangle of a resolved source range.
final class RitoExactSourceRect {
  const RitoExactSourceRect({
    required this.pageIndex,
    required this.bounds,
    required this.blockIndex,
    required this.lineIndex,
    required this.runIndex,
    required this.startCharIndex,
    required this.endCharIndex,
  });

  final int pageIndex;

  /// Display-list space, exactly like [RitoHitEntry.bounds]: paint it
  /// straight onto the surface the page was drawn on.
  final RitoRect bounds;
  final int blockIndex;
  final int lineIndex;
  final int runIndex;
  final int startCharIndex;
  final int endCharIndex;
}

/// Where a durable source range sits.
final class RitoExactSourceRangeResolution {
  RitoExactSourceRangeResolution({
    required this.artifactId,
    required this.status,
    required this.firstPageIndex,
    required this.selectedText,
    required List<RitoExactSourceRect> rects,
  }) : rects = List<RitoExactSourceRect>.unmodifiable(rects);

  final int artifactId;
  final RitoExactSourceRangeStatus status;

  /// The page the range starts on, present whenever it resolved. When
  /// [rects] is empty this is the page to navigate to: the range landed
  /// somewhere this artifact does not draw.
  final int? firstPageIndex;

  /// The text the range covers as the engine laid it out. Empty unless
  /// the status is [RitoExactSourceRangeStatus.resolved].
  final String selectedText;

  /// Only the pages this artifact draws, in its display-list space.
  final List<RitoExactSourceRect> rects;
}

final class RitoExactSourceRangeDecoder {
  const RitoExactSourceRangeDecoder();

  static final List<int> _magic = ascii.encode('RITOESR1');

  RitoExactSourceRangeResolution decode(Uint8List bytes) {
    if (bytes.length > ritoMaxWireBytes) {
      throw const FormatException('RITOESR1 exceeds the byte limit.');
    }
    final reader = RitoBinaryReader(bytes);
    reader.expectMagic(_magic, 'exact source range magic');
    final version = reader.uint32('exact source range wire version');
    if (version != 1) {
      reader.fail('unsupported exact source range wire version: $version');
    }
    final declaredLength = reader.uint64('exact source range total length');
    if (declaredLength != bytes.length) {
      reader.fail('exact source range total length does not match input');
    }
    final artifactId = reader.externalId('exact source range artifact id');
    final status = _status(reader);
    final firstPageIndex = reader.option(
      'exact source range first page',
      () => reader.uint32('exact source range first page index'),
    );
    final selectedText = reader.string('exact source range text');
    final count = reader.count('exact source rects');
    final rects = <RitoExactSourceRect>[
      for (var index = 0; index < count; index += 1) _rect(reader),
    ];
    final resolution = RitoExactSourceRangeResolution(
      artifactId: artifactId,
      status: status,
      firstPageIndex: firstPageIndex,
      selectedText: selectedText,
      rects: rects,
    );
    reader.finish('exact source range wire message');
    return resolution;
  }

  RitoExactSourceRangeStatus _status(RitoBinaryReader reader) {
    final tag = reader.uint32('exact source range status');
    return switch (tag) {
      0 => RitoExactSourceRangeStatus.resolved,
      1 => RitoExactSourceRangeStatus.pending,
      2 => RitoExactSourceRangeStatus.unavailable,
      _ => reader.fail('unknown exact source range status: $tag'),
    };
  }

  RitoExactSourceRect _rect(RitoBinaryReader reader) {
    final record = reader.record('exact source rect');
    final rect = RitoExactSourceRect(
      pageIndex: record.uint32('exact source rect page index'),
      bounds: RitoRect(
        x: record.float64('exact source rect x'),
        y: record.float64('exact source rect y'),
        width: record.float64('exact source rect width'),
        height: record.float64('exact source rect height'),
      ),
      blockIndex: record.uint32('exact source rect block index'),
      lineIndex: record.uint32('exact source rect line index'),
      runIndex: record.uint32('exact source rect run index'),
      startCharIndex: record.uint32('exact source rect start char index'),
      endCharIndex: record.uint32('exact source rect end char index'),
    );
    record.finish('exact source rect');
    return rect;
  }
}
