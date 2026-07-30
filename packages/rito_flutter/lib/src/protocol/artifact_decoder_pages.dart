part of 'artifact_decoder.dart';

extension _ArtifactPages on RitoArtifactDecoder {
  RitoDisplayListPayload _displayList(RitoBinaryReader reader) {
    final record = reader.record('display list');
    final version = record.uint32('display list format version');
    final commandCount = record.uint32('display list command count');
    final digest = record.fixedBytes(32, 'display list digest');
    final bytes = record.blob('display list bytes');
    record.finish('display list');
    final decoded = displayListDecoder.decode(bytes);
    if (version != decoded.formatVersion ||
        commandCount != decoded.commandCount) {
      reader.fail('display list metadata does not match RITODL1 bytes');
    }
    return RitoDisplayListPayload(
      formatVersion: version,
      commandCount: commandCount,
      semanticDigest: digest,
      wireBytes: bytes,
      displayList: decoded,
    );
  }

  List<RitoResourceRef> _resources(RitoBinaryReader reader) {
    final count = reader.count('resources');
    return [for (var index = 0; index < count; index += 1) _resource(reader)];
  }

  RitoResourceRef _resource(RitoBinaryReader reader) {
    final record = reader.record('resource');
    final result = RitoResourceRef(
      kind: _resourceKind(record),
      href: record.string('resource href'),
    );
    record.finish('resource');
    return result;
  }

  List<RitoFontRef> _fonts(RitoBinaryReader reader) {
    final count = reader.count('fonts');
    return [for (var index = 0; index < count; index += 1) _font(reader)];
  }

  RitoFontRef _font(RitoBinaryReader reader) {
    final record = reader.record('font');
    final result = RitoFontRef(
      family: record.string('font family'),
      href: record.string('font href'),
      style: record.string('font style'),
      weight: record.uint16('font weight'),
      shapeFingerprint: record.string('font shape fingerprint'),
      byteLength: record.uint64('font byte length'),
    );
    record.finish('font');
    return result;
  }

  List<RitoPage> _pages(RitoBinaryReader reader) {
    final count = reader.count('pages');
    return [for (var index = 0; index < count; index += 1) _page(reader)];
  }

  RitoPage _page(RitoBinaryReader reader) {
    final record = reader.record('page');
    final result = RitoPage(
      pageIndex: record.uint32('page index'),
      width: record.float64('page width'),
      height: record.float64('page height'),
      hits: _hits(record),
      semantics: _semantics(record, 0),
      text: record.string('page text'),
      textLength: record.uint64('page text length'),
      textRuns: _textRuns(record),
    );
    record.finish('page');
    return result;
  }

  List<RitoHitEntry> _hits(RitoBinaryReader reader) {
    final count = reader.count('page hits');
    return [for (var index = 0; index < count; index += 1) _hit(reader)];
  }

  RitoHitEntry _hit(RitoBinaryReader reader) {
    final record = reader.record('hit');
    final result = RitoHitEntry(
      pageIndex: record.uint32('hit page index'),
      bounds: _rect(record),
      text: record.string('hit text'),
      href: _optionalString(record, 'hit href'),
      sourcePoint: record.option(
        'hit source point',
        () => _sourcePoint(record),
      ),
      imageSrc: _optionalString(record, 'hit image source'),
      imageAlt: _optionalString(record, 'hit image alternative'),
      footnoteKey: _optionalString(record, 'hit footnote key'),
      footnotePending: record.boolean('hit footnote pending'),
    );
    record.finish('hit');
    return result;
  }

  List<RitoSemanticNode> _semantics(RitoBinaryReader reader, int depth) {
    final count = reader.count('page semantics');
    return [
      for (var index = 0; index < count; index += 1)
        _semanticNode(reader, depth),
    ];
  }

  RitoSemanticNode _semanticNode(RitoBinaryReader reader, int depth) {
    if (depth > RitoArtifactDecoder._maxSemanticDepth) {
      reader.fail('semantic tree exceeds the depth limit');
    }
    final record = reader.record('semantic node');
    final result = RitoSemanticNode(
      role: _semanticRole(record),
      level: record.option('semantic level', () => record.uint8('level')),
      text: _optionalString(record, 'semantic text'),
      alt: _optionalString(record, 'semantic alternative'),
      href: _optionalString(record, 'semantic href'),
      bounds: _rect(record),
      children: _semantics(record, depth + 1),
    );
    record.finish('semantic node');
    return result;
  }

  List<RitoTextRunOffset> _textRuns(RitoBinaryReader reader) {
    final count = reader.count('page text runs');
    return [for (var index = 0; index < count; index += 1) _textRun(reader)];
  }

  RitoTextRunOffset _textRun(RitoBinaryReader reader) {
    final record = reader.record('text run');
    final result = RitoTextRunOffset(
      start: record.uint64('text run start'),
      end: record.uint64('text run end'),
      blockIndex: record.uint32('text block index'),
      lineIndex: record.uint32('text line index'),
      runIndex: record.uint32('text run index'),
    );
    record.finish('text run');
    return result;
  }
}
