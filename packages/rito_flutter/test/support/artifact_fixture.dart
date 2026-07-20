import 'dart:typed_data';

import 'display_fixture.dart';
import 'wire_writer.dart';

Uint8List artifactFixture({
  int sessionId = 91,
  int requestId = 12,
  int revisionId = 44,
  int artifactId = 7001,
  int previousAvailability = 0,
  int nextAvailability = 1,
  String fontFamily = 'Rito Serif',
  String fontHref = 'fonts/serif.woff2',
  String fontFingerprint = 'shape-v1',
  int fontByteLength = 8192,
  bool includeFontResource = true,
  String locatorHref = 'chapter-4.xhtml',
  int localPageIndex = 7,
}) {
  final display = displayFixture();
  final writer = TestWireWriter.message('RITOART1');
  writer
    ..uint32(1)
    ..uint32(1)
    ..uint64(sessionId)
    ..uint64(requestId)
    ..uint64(revisionId)
    ..uint32(3)
    ..uint64(artifactId);
  _locator(writer, locatorHref);
  writer
    ..uint32(1)
    ..uint32(localPageIndex)
    ..uint32(3)
    ..uint32(1)
    ..uint32(localPageIndex)
    ..float64(360)
    ..float64(640)
    ..boolean(false)
    ..uint32(previousAvailability)
    ..uint32(nextAvailability)
    ..uint32(0);
  writer.record((record) {
    record
      ..uint32(1)
      ..uint32(12)
      ..fixed(List<int>.filled(32, 0x5a))
      ..blob(display);
  });
  _resources(writer, fontHref, includeFontResource: includeFontResource);
  _fonts(
    writer,
    family: fontFamily,
    href: fontHref,
    fingerprint: fontFingerprint,
    byteLength: fontByteLength,
  );
  _pages(writer, localPageIndex);
  return writer.finishMessage();
}

Uint8List resourceFixture({
  int artifactId = 7001,
  int kind = 0,
  String href = 'images/cover.png',
  String mediaType = 'image/png',
  List<int> bytes = const <int>[1, 2, 3, 4],
}) {
  final writer = TestWireWriter.message('RITORES1');
  writer
    ..uint64(artifactId)
    ..uint32(kind)
    ..string(href)
    ..string(mediaType)
    ..blob(bytes);
  writer.option(() => writer.uint32(320));
  writer.option(() => writer.uint32(480));
  return writer.finishMessage();
}

void _locator(TestWireWriter writer, String href) {
  writer.record((record) {
    record.string(href);
    record.option(() => record.string('paragraph-9'));
    record.option(() => _sourcePoint(record, <int>[1, 9, 2], 47));
    record.option(null);
    record.option(() => record.float64(.63));
  });
}

void _sourcePoint(TestWireWriter writer, List<int> path, int offset) {
  writer.record((record) {
    record.uint32(path.length);
    for (final part in path) {
      record.uint32(part);
    }
    record.uint64(offset);
  });
}

void _resources(
  TestWireWriter writer,
  String fontHref, {
  required bool includeFontResource,
}) {
  writer.uint32(includeFontResource ? 2 : 1);
  writer.record((record) {
    record
      ..uint32(0)
      ..string('../Images/cover.png');
  });
  if (includeFontResource) {
    writer.record((record) {
      record
        ..uint32(1)
        ..string(fontHref);
    });
  }
}

void _fonts(
  TestWireWriter writer, {
  required String family,
  required String href,
  required String fingerprint,
  required int byteLength,
}) {
  writer.uint32(1);
  writer.record((record) {
    record
      ..string(family)
      ..string(href)
      ..string('normal')
      ..uint16(400)
      ..string(fingerprint)
      ..uint64(byteLength);
  });
}

void _pages(TestWireWriter writer, int pageIndex) {
  writer.uint32(1);
  writer.record((page) {
    page
      ..uint32(pageIndex)
      ..float64(360)
      ..float64(640)
      ..uint32(1);
    page.record((hit) {
      hit.uint32(pageIndex);
      _rect(hit, 4, 5, 20, 30);
      hit.string('body');
      hit.option(() => hit.string('#note'));
      hit.option(() => _sourcePoint(hit, <int>[1, 9, 2], 47));
      hit.option(null);
      hit.option(null);
    });
    page.uint32(1);
    page.record((semantic) {
      semantic.uint32(0);
      semantic.option(() => semantic.uint8(2));
      semantic.option(() => semantic.string('Chapter four'));
      semantic.option(null);
      semantic.option(null);
      _rect(semantic, 0, 0, 360, 40);
      semantic.uint32(0);
    });
    page
      ..string('body')
      ..uint64(4)
      ..uint32(1);
    page.record((run) {
      run
        ..uint64(0)
        ..uint64(4)
        ..uint32(0)
        ..uint32(0)
        ..uint32(0);
    });
  });
}

void _rect(
  TestWireWriter writer,
  double x,
  double y,
  double width,
  double height,
) {
  writer
    ..float64(x)
    ..float64(y)
    ..float64(width)
    ..float64(height);
}
