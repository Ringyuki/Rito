// Decodes the artifact the live Rust encoder wrote
// (packages/rito-core-wasm/tests/fixtures/reader-session-artifact.hex, kept
// in step by crates/rito-core's
// cross_language_artifact_fixture_matches_the_encoder test). A hand-built
// fixture can agree with a stale reading of the wire; these bytes cannot.
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter_protocol.dart';

Uint8List _fixture() {
  final hex = File(
    '../../packages/rito-core-wasm/tests/fixtures/reader-session-artifact.hex',
  ).readAsStringSync().trim();
  return Uint8List.fromList(<int>[
    for (var index = 0; index < hex.length; index += 2)
      int.parse(hex.substring(index, index + 2), radix: 16),
  ]);
}

void main() {
  test('decodes the artifact the Rust encoder writes, every hit field', () {
    final artifact = RitoArtifactDecoder().decode(_fixture());

    expect(artifact.localSpreadIndex, 5);
    expect(artifact.localPageIndexes, <int>[9, 10]);
    expect(artifact.bookPageIndex, 140);
    expect(artifact.bookPageCount, 312);
    final hit = artifact.pages.single.hits.single;
    expect(hit.pageIndex, 9);
    expect(hit.kind, RitoHitKind.footnotePending);
    expect(hit.footnotePending, isTrue);
    expect(hit.text, '次へ');
    expect(hit.href, 'chapter-02.xhtml');
    expect(hit.sourcePoint?.nodePath, <int>[1, 2, 3]);
    expect(hit.targetLocator?.href, 'Text/chapter-02.xhtml');
    expect(hit.targetLocator?.anchorId, 'fn7');
    expect(hit.destinationLabel, '第二章');
    expect(hit.imageSrc, 'images/next.png');
    expect(hit.imageAlt, '次章');
    expect(hit.footnoteKey, 'Text/chapter-02.xhtml#fn7');
  });

  test('an artifact rejects truncation', () {
    final bytes = _fixture();
    for (final end in <int>[0, 8, 20, 64, 200, bytes.length - 1]) {
      expect(
        () =>
            RitoArtifactDecoder().decode(Uint8List.sublistView(bytes, 0, end)),
        throwsA(isA<FormatException>()),
      );
    }
  });
}
