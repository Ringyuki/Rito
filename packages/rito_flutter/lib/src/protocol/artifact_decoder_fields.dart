part of 'artifact_decoder.dart';

extension _ArtifactFields on RitoArtifactDecoder {
  RitoLocator _locator(RitoBinaryReader reader) {
    final record = reader.record('locator');
    final result = RitoLocator(
      href: record.string('locator href'),
      anchorId: record.option(
        'locator anchor',
        () => record.string('locator anchor'),
      ),
      sourcePoint: record.option('source point', () => _sourcePoint(record)),
      sourceRange: record.option('source range', () => _sourceRange(record)),
      progression: record.option(
        'locator progression',
        () => record.float64('locator progression'),
      ),
    );
    record.finish('locator');
    return result;
  }

  RitoSourcePoint _sourcePoint(RitoBinaryReader reader) {
    final record = reader.record('source point');
    final result = RitoSourcePoint(
      nodePath: _uint32Collection(record, 'source point path'),
      textOffset: record.uint64('source text offset'),
    );
    record.finish('source point');
    return result;
  }

  RitoSourceRange _sourceRange(RitoBinaryReader reader) {
    final record = reader.record('source range');
    final result = RitoSourceRange(
      start: _sourcePoint(record),
      end: _sourcePoint(record),
    );
    record.finish('source range');
    return result;
  }

  RitoLocatorMatch _locatorMatch(RitoBinaryReader reader) {
    final value = reader.uint32('locator match');
    return switch (value) {
      0 => RitoLocatorMatch.sourceRange,
      1 => RitoLocatorMatch.sourcePoint,
      2 => RitoLocatorMatch.anchor,
      3 => RitoLocatorMatch.progression,
      4 => RitoLocatorMatch.href,
      _ => reader.fail('unknown locator match: $value'),
    };
  }

  RitoTextProfile _textProfile(RitoBinaryReader reader) {
    final value = reader.uint32('text profile');
    return switch (value) {
      0 => RitoTextProfile.platformStringRuns,
      1 => RitoTextProfile.positionedGlyphRuns,
      _ => reader.fail('unknown text profile: $value'),
    };
  }

  RitoAdjacentAvailability _adjacentAvailability(RitoBinaryReader reader) {
    final value = reader.uint32('adjacent availability');
    return switch (value) {
      0 => RitoAdjacentAvailability.available,
      1 => RitoAdjacentAvailability.pending,
      2 => RitoAdjacentAvailability.chapterBoundary,
      3 => RitoAdjacentAvailability.terminal,
      4 => RitoAdjacentAvailability.blocked,
      _ => reader.fail('unknown adjacent availability: $value'),
    };
  }

  RitoResourceKind _resourceKind(RitoBinaryReader reader) {
    final value = reader.uint32('resource kind');
    return switch (value) {
      0 => RitoResourceKind.image,
      1 => RitoResourceKind.font,
      2 => RitoResourceKind.stylesheet,
      _ => reader.fail('unknown resource kind: $value'),
    };
  }

  RitoSemanticRole _semanticRole(RitoBinaryReader reader) {
    final value = reader.uint32('semantic role');
    return switch (value) {
      0 => RitoSemanticRole.heading,
      1 => RitoSemanticRole.paragraph,
      2 => RitoSemanticRole.list,
      3 => RitoSemanticRole.listItem,
      4 => RitoSemanticRole.image,
      5 => RitoSemanticRole.link,
      6 => RitoSemanticRole.blockquote,
      7 => RitoSemanticRole.table,
      8 => RitoSemanticRole.generic,
      _ => reader.fail('unknown semantic role: $value'),
    };
  }

  RitoRect _rect(RitoBinaryReader reader) {
    return RitoRect(
      x: reader.float64('rectangle x'),
      y: reader.float64('rectangle y'),
      width: reader.float64('rectangle width'),
      height: reader.float64('rectangle height'),
    );
  }

  String? _optionalString(RitoBinaryReader reader, String field) {
    return reader.option(field, () => reader.string(field));
  }
}
