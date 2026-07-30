import 'dart:typed_data';

import 'package:rito_flutter/rito_flutter_native.dart' show RitoArtifactDecoder;

import 'wire_writer.dart';

Uint8List publicationFixture({
  int protocolVersion = RitoArtifactDecoder.protocolVersion,
  int sessionId = 91,
  int firstSpineIndex = 0,
  int firstLinearIndex = 0,
  int firstTocId = 0,
  int? firstTargetTag,
  int? declaredRootTocCount,
  String firstSpineHref = 'chapter-1.xhtml',
  String? locatorHref,
  bool locatorHasProgression = false,
}) {
  final writer = TestWireWriter.message('RITOPUB1');
  writer
    ..uint32(protocolVersion)
    ..uint64(sessionId);
  _metadata(writer);
  writer.uint32(2);
  _spineItem(
    writer,
    spineIndex: firstSpineIndex,
    linearIndex: firstLinearIndex,
    idref: 'chapter-1',
    href: firstSpineHref,
  );
  _spineItem(
    writer,
    spineIndex: 1,
    linearIndex: 1,
    idref: 'chapter-2',
    href: 'chapter-2.xhtml',
  );
  if (declaredRootTocCount != null) {
    writer.uint32(declaredRootTocCount);
    return writer.finishMessage();
  }
  writer.uint32(2);
  writer.record((entry) {
    entry
      ..uint32(firstTocId)
      ..string('Chapter one');
    final tag = firstTargetTag ?? 0;
    entry.uint8(tag);
    if (tag == 0) {
      entry.uint32(0);
      _locator(
        entry,
        href: locatorHref ?? firstSpineHref,
        anchor: 'start',
        progression: locatorHasProgression ? 0.5 : null,
      );
    }
    entry.uint32(1);
    entry.record((child) {
      child
        ..uint32(1)
        ..string('Reference')
        ..uint8(1)
        ..string('https://example.com/reference')
        ..uint32(0);
    });
  });
  writer.record((entry) {
    entry
      ..uint32(2)
      ..string('Missing')
      ..uint8(2)
      ..string('missing.xhtml#lost')
      ..uint32(0);
  });
  return writer.finishMessage();
}

Uint8List deepPublicationFixture(int depth) {
  final writer = TestWireWriter.message('RITOPUB1');
  writer
    ..uint32(RitoArtifactDecoder.protocolVersion)
    ..uint64(92);
  _metadata(writer);
  writer.uint32(1);
  _spineItem(
    writer,
    spineIndex: 0,
    linearIndex: 0,
    idref: 'chapter',
    href: 'chapter.xhtml',
  );
  writer.uint32(1);
  _tocChain(writer, depth, 0);
  return writer.finishMessage();
}

void _metadata(TestWireWriter writer) {
  writer.record((metadata) {
    metadata
      ..string('Fixture book')
      ..string('en')
      ..string('urn:rito:flutter-publication');
    metadata.option(() => metadata.string('Rito'));
  });
}

void _spineItem(
  TestWireWriter writer, {
  required int spineIndex,
  required int? linearIndex,
  required String idref,
  required String href,
}) {
  writer.record((item) {
    item.uint32(spineIndex);
    item.option(
      linearIndex == null ? null : () => item.uint32(linearIndex),
    );
    item
      ..string(idref)
      ..string(href);
  });
}

void _locator(
  TestWireWriter writer, {
  required String href,
  String? anchor,
  double? progression,
}) {
  writer.record((locator) {
    locator.string(href);
    locator.option(anchor == null ? null : () => locator.string(anchor));
    locator.option(null);
    locator.option(null);
    locator.option(
      progression == null ? null : () => locator.float64(progression),
    );
  });
}

void _tocChain(TestWireWriter writer, int remainingDepth, int tocId) {
  writer.record((entry) {
    entry
      ..uint32(tocId)
      ..string('Level $tocId')
      ..uint8(0)
      ..uint32(0);
    _locator(entry, href: 'chapter.xhtml');
    if (remainingDepth > 1) {
      entry.uint32(1);
      _tocChain(entry, remainingDepth - 1, tocId + 1);
    } else {
      entry.uint32(0);
    }
  });
}
