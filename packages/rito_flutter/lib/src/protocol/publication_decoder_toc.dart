part of 'publication_decoder.dart';

extension _PublicationTocDecoder on RitoPublicationDecoder {
  List<RitoPublicationTocEntry> _tocEntries(
    RitoBinaryReader reader,
    int depth,
    _PublicationDecodeState state,
  ) {
    final count = reader.count('publication TOC child count');
    if (depth > ritoPublicationMaxTocDepth && count != 0) {
      reader.fail('publication TOC exceeds the depth limit');
    }
    if (state.itemCount + count > ritoPublicationMaxTocItems) {
      reader.fail('publication TOC exceeds the item limit');
    }
    state.itemCount += count;
    return <RitoPublicationTocEntry>[
      for (var index = 0; index < count; index += 1)
        _tocEntry(reader, depth, state),
    ];
  }

  RitoPublicationTocEntry _tocEntry(
    RitoBinaryReader reader,
    int depth,
    _PublicationDecodeState state,
  ) {
    final record = reader.record('publication TOC entry');
    final tocId = record.uint32('publication TOC id');
    if (tocId != state.nextTocId) {
      record.fail('publication TOC IDs must be dense preorder identities');
    }
    state.nextTocId += 1;
    final entry = RitoPublicationTocEntry(
      tocId: tocId,
      label: record.string('publication TOC label'),
      target: _tocTarget(record, state),
      children: _tocEntries(record, depth + 1, state),
    );
    record.finish('publication TOC entry');
    return entry;
  }

  RitoPublicationTocTarget _tocTarget(
    RitoBinaryReader reader,
    _PublicationDecodeState state,
  ) {
    final tag = reader.uint8('publication TOC target tag');
    return switch (tag) {
      0 => _locatorTarget(reader, state),
      1 => _externalTarget(reader),
      2 => _unresolvedTarget(reader),
      _ => reader.fail('unknown publication TOC target tag: $tag'),
    };
  }

  RitoPublicationTocLocatorTarget _locatorTarget(
    RitoBinaryReader reader,
    _PublicationDecodeState state,
  ) {
    final spineIndex = reader.uint32('publication TOC spine index');
    final locator = readRitoLocator(reader);
    if (spineIndex >= state.spine.length) {
      reader.fail('publication TOC spine index is out of bounds');
    }
    final spineItem = state.spine[spineIndex];
    if (locator.href != spineItem.href) {
      reader.fail('publication TOC locator does not match its spine item');
    }
    if (state.duplicateHrefs.contains(locator.href)) {
      reader.fail('publication TOC locator href is ambiguous in the spine');
    }
    if (locator.sourcePoint != null ||
        locator.sourceRange != null ||
        locator.progression != null) {
      reader.fail('publication TOC locator may only contain href and anchorId');
    }
    return RitoPublicationTocLocatorTarget(
      spineIndex: spineIndex,
      locator: locator,
    );
  }

  RitoPublicationTocExternalTarget _externalTarget(
    RitoBinaryReader reader,
  ) {
    final href = reader.string('publication external TOC href');
    if (href.isEmpty || !_isExternalHref(href)) {
      reader.fail('publication external TOC href is invalid');
    }
    return RitoPublicationTocExternalTarget(href: href);
  }

  RitoPublicationTocUnresolvedTarget _unresolvedTarget(
    RitoBinaryReader reader,
  ) {
    final href = reader.string('publication unresolved TOC href');
    if (_isExternalHref(href)) {
      reader.fail('publication external TOC href must use the external target');
    }
    return RitoPublicationTocUnresolvedTarget(href: href);
  }
}
