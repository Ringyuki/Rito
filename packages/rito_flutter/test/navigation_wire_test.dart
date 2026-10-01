import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter_protocol.dart';

/// Produced by the Rust encoder from the fixtures in
/// `reader_session/interaction_tests.rs`, which pins the same strings.
const String _locateHex =
    '5249544f4e565131010000005c00000000000000070000000000000002090000'
    '00000000002f00000000000000150000004f454250532f636861707465722d32'
    '2e7868746d6c01060000006e6f74652d34000001000000000000d03f';

const String _compareHex =
    '5249544f4e565131010000008700000000000000070000000000000003150000'
    '004f454250532f636861707465722d322e7868746d6c18000000000000000300'
    '00000100000000000000040000000c00000000000000150000004f454250532f'
    '636861707465722d332e7868746d6c1000000000000000010000000000000000'
    '00000000000000';

const String _locationHex =
    '5249544f4e565231010000001c000000000000000100050000000102';

const String _tocHex = '5249544f4e565231010000001a00000000000000000103000000';

Uint8List _bytes(String hex) => Uint8List.fromList(<int>[
  for (var index = 0; index < hex.length; index += 2)
    int.parse(hex.substring(index, index + 2), radix: 16),
]);

void main() {
  const encoder = RitoRequestEncoder();
  const decoder = RitoNavigationDecoder();

  test('RITONVQ1 encodes the bytes the engine decodes', () {
    final locate = encoder.encodeNavigation(
      const RitoNavigationRequest(
        sessionId: 7,
        query: RitoLocateQuery(
          artifactId: 9,
          locator: RitoLocator(
            href: 'OEBPS/chapter-2.xhtml',
            anchorId: 'note-4',
            progression: 0.25,
          ),
        ),
      ),
    );
    expect(locate, equals(_bytes(_locateHex)));

    final compare = encoder.encodeNavigation(
      RitoNavigationRequest(
        sessionId: 7,
        query: RitoCompareQuery(
          firstHref: 'OEBPS/chapter-2.xhtml',
          first: RitoSourcePoint(nodePath: <int>[1, 0, 4], textOffset: 12),
          secondHref: 'OEBPS/chapter-3.xhtml',
          second: RitoSourcePoint(nodePath: <int>[0], textOffset: 0),
        ),
      ),
    );
    expect(compare, equals(_bytes(_compareHex)));
  });

  test('RITONVR1 decodes the results the engine encoded', () {
    final location = decoder.decode(_bytes(_locationHex)) as RitoLocationResult;
    final page = location.location as RitoLocatedPage;
    expect(page.pageIndex, 5);
    expect(page.drawn, isTrue);
    expect(page.matchedBy, RitoLocatorMatch.anchor);

    final toc = decoder.decode(_bytes(_tocHex)) as RitoTocEntryResult;
    expect(toc.tocId, 3);
  });

  test('RITONVR1 rejects every truncated prefix', () {
    for (final hex in <String>[_locationHex, _tocHex]) {
      final bytes = _bytes(hex);
      for (var end = 0; end < bytes.length; end += 1) {
        expect(
          () => decoder.decode(Uint8List.sublistView(bytes, 0, end)),
          throwsA(isA<FormatException>()),
          reason: 'a $end byte prefix must not decode',
        );
      }
    }
  });
}
