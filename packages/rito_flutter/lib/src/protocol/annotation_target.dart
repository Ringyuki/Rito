import 'dart:convert';
import 'dart:typed_data';

import 'artifact_models.dart';
import 'binary_reader.dart';

/// The one persisted annotation format, built and read only by the
/// engine: a highlight stored by any Rito host resolves the same way on
/// every other. Persist [json] — the engine's canonical bytes — as it is,
/// and hand it back through [RitoResolveAnnotationQuery] to locate it.
///
/// The other fields are the target's contents as the engine decoded
/// them, so a host never parses the JSON itself. Offsets are UTF-16 code
/// units; [start], [end] and [chapterLength] count into the chapter's
/// canonical text (its raw parsed tree), so they never depend on layout.
final class RitoAnnotationTarget {
  const RitoAnnotationTarget({
    required this.json,
    required this.href,
    required this.sourceRange,
    required this.exact,
    required this.prefix,
    required this.suffix,
    required this.start,
    required this.end,
    required this.chapterLength,
  });

  /// The engine's canonical serialization; what a host stores.
  final String json;

  /// Canonical manifest href of the chapter.
  final String href;
  final RitoSourceRange sourceRange;

  /// The highlighted text and up to 32 UTF-16 units of context on each side.
  final String exact;
  final String prefix;
  final String suffix;
  final int start;
  final int end;
  final int chapterLength;

  @override
  bool operator ==(Object other) =>
      other is RitoAnnotationTarget && other.json == json;

  @override
  int get hashCode => json.hashCode;
}

/// Builds or locates an annotation target. Targets depend only on the
/// publication source, so no artifact is involved.
sealed class RitoAnnotationQuery {
  const RitoAnnotationQuery();
}

/// Builds the target for a source range, normally a selection's.
final class RitoCreateAnnotationQuery extends RitoAnnotationQuery {
  const RitoCreateAnnotationQuery({required this.href, required this.range});

  final String href;
  final RitoSourceRange range;
}

/// Finds a stored target in the publication as it is now. [targetJson]
/// is the [RitoAnnotationTarget.json] a host persisted, byte for byte.
final class RitoResolveAnnotationQuery extends RitoAnnotationQuery {
  const RitoResolveAnnotationQuery(this.targetJson);

  final String targetJson;
}

final class RitoAnnotationRequest {
  const RitoAnnotationRequest({required this.sessionId, required this.query});

  final int sessionId;
  final RitoAnnotationQuery query;
}

/// Which level of the engine's cascade located a target, in wire order.
enum RitoAnnotationLevel {
  /// A target [RitoCreateAnnotationQuery] built.
  created,

  /// The source range still maps and still covers the quoted text.
  exact,

  /// The quoted text was found elsewhere in the chapter.
  quote,

  /// Neither matched; the stored offsets still fit the chapter.
  position,

  /// Only the proportional position survived: one character there.
  progression,

  /// The chapter is gone.
  orphanedHrefNotFound,

  /// The chapter holds no text.
  orphanedEmptyChapter,
}

/// A built target, or a stored one re-anchored where the cascade found
/// it. [target] is null only for the orphaned levels.
final class RitoAnnotationResponse {
  const RitoAnnotationResponse({required this.level, required this.target});

  final RitoAnnotationLevel level;
  final RitoAnnotationTarget? target;

  bool get isOrphaned =>
      level == RitoAnnotationLevel.orphanedHrefNotFound ||
      level == RitoAnnotationLevel.orphanedEmptyChapter;
}

/// Decodes a RITOANR1 message.
final class RitoAnnotationDecoder {
  const RitoAnnotationDecoder();

  static final List<int> _magic = ascii.encode('RITOANR1');

  RitoAnnotationResponse decode(Uint8List bytes) {
    if (bytes.length > ritoMaxWireBytes) {
      throw const FormatException('RITOANR1 exceeds the byte limit.');
    }
    final reader = RitoBinaryReader(bytes);
    reader.expectMagic(_magic, 'annotation magic');
    final version = reader.uint32('annotation wire version');
    if (version != 1) {
      reader.fail('unsupported annotation wire version: $version');
    }
    if (reader.uint64('annotation total length') != bytes.length) {
      reader.fail('annotation total length does not match input');
    }
    final tag = reader.uint8('annotation level');
    if (tag >= RitoAnnotationLevel.values.length) {
      reader.fail('unknown annotation level: $tag');
    }
    final level = RitoAnnotationLevel.values[tag];
    final target = reader.option('annotation target', () => _target(reader));
    reader.finish('annotation wire message');
    final response = RitoAnnotationResponse(level: level, target: target);
    if (response.isOrphaned != (response.target == null)) {
      throw const FormatException(
        'an annotation carries a target exactly when it is not orphaned',
      );
    }
    return response;
  }

  RitoAnnotationTarget _target(RitoBinaryReader reader) {
    final record = reader.record('annotation target');
    final target = RitoAnnotationTarget(
      json: record.string('annotation target json'),
      href: record.string('annotation href'),
      sourceRange: _range(record),
      exact: record.string('annotation exact'),
      prefix: record.string('annotation prefix'),
      suffix: record.string('annotation suffix'),
      start: record.uint64('annotation start'),
      end: record.uint64('annotation end'),
      chapterLength: record.uint64('annotation chapter length'),
    );
    record.finish('annotation target');
    return target;
  }

  RitoSourceRange _range(RitoBinaryReader reader) {
    final record = reader.record('annotation source range');
    final range = RitoSourceRange(start: _point(record), end: _point(record));
    record.finish('annotation source range');
    return range;
  }

  RitoSourcePoint _point(RitoBinaryReader reader) {
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
}
