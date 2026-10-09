import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter_protocol.dart';

// The bytes are the Rust encoder's output, read from the Rust test that
// pins them, so this mirror can never drift onto bytes only it produces.
final String _rustFixtures = File(
  '../../crates/rito-core/src/runtime/reader_session/layout_tests.rs',
).readAsStringSync();

Uint8List _rustHex(String name, [String? source]) {
  final match = RegExp(
    'const $name: &str =\\s*concat!\\(([^)]*)\\)',
  ).firstMatch(source ?? _rustFixtures);
  if (match == null) {
    throw StateError('Rust fixture $name is missing');
  }
  final hex = RegExp(
    '"([0-9a-f]*)"',
  ).allMatches(match.group(1)!).map((part) => part.group(1)!).join();
  return Uint8List.fromList(<int>[
    for (var index = 0; index < hex.length; index += 2)
      int.parse(hex.substring(index, index + 2), radix: 16),
  ]);
}

void main() {
  const encoder = RitoRequestEncoder();
  const decoder = RitoNavigationDecoder();

  test('the layout query and the spread request encode to the Rust bytes', () {
    expect(
      encoder.encodeNavigation(
        const RitoNavigationRequest(
          sessionId: 7,
          query: RitoLayoutQuery(artifactId: 9),
        ),
      ),
      equals(_rustHex('LAYOUT_REQUEST_HEX')),
    );
    expect(
      encoder.encodeSpread(
        const RitoSpreadRequest(
          sessionId: 7,
          requestId: 12,
          fromArtifactId: 9,
          spreadIndex: 258,
        ),
      ),
      equals(_rustHex('SPREAD_REQUEST_HEX')),
    );
    expect(
      () => encoder.encodeSpread(
        const RitoSpreadRequest(
          sessionId: 7,
          requestId: 12,
          fromArtifactId: 0,
          spreadIndex: 0,
        ),
      ),
      throwsFormatException,
    );
  });

  test('an artifact request encodes to the Rust bytes, force flags included', () {
    final expected = _rustHex(
      'ARTIFACT_REQUEST_HEX',
      File(
        '../../crates/rito-core/src/runtime/reader_session/typography_tests.rs',
      ).readAsStringSync(),
    );
    const layout = RitoLayoutRequest(
      viewportWidth: 393,
      viewportHeight: 760,
      marginTop: 24,
      marginRight: 20,
      marginBottom: 24,
      marginLeft: 20,
      spreadMode: RitoSpreadMode.double,
      firstPageAlone: true,
      spreadGap: 20,
      rootFontSize: 18,
      lineHeightOverride: 1.5,
      fontFamilyOverride: 'serif',
      lineHeightForce: false,
      renderRatio: 3,
    );
    expect(
      encoder.encode(
        const RitoArtifactRequest(
          sessionId: 7,
          requestId: 12,
          layout: layout,
          locator: RitoLocator(
            href: 'OEBPS/chapter-2.xhtml',
            progression: 0.25,
          ),
        ),
      ),
      equals(expected),
    );
    // A layout that does not say forces both overrides.
    expect(layout.fontFamilyForce, isTrue);
    expect(layout.withRenderRatio(2).lineHeightForce, isFalse);
  });

  test('a revision layout decodes from the Rust bytes', () {
    final result =
        decoder.decode(_rustHex('LAYOUT_RESULT_HEX')) as RitoLayoutResult;
    final layout = result.layout;
    expect(layout.pageCount, 5);
    expect(
      <(int, int?)>[
        for (final spread in layout.spreads)
          (spread.leftPageIndex, spread.rightPageIndex),
      ],
      <(int, int?)>[(0, null), (1, 2), (3, 4)],
    );
    expect(
      <(int, int, int)>[
        for (final chapter in layout.chapters)
          (chapter.spineIndex, chapter.startPage, chapter.endPage),
      ],
      <(int, int, int)>[(1, 0, 2), (3, 3, 4)],
    );
    expect(
      <(int, int)>[
        for (final target in layout.tocTargets)
          (target.tocId, target.pageIndex),
      ],
      <(int, int)>[(2, 0), (6, 3)],
    );
    expect(layout.activeTocEntryByPage, <int?>[null, 2, 2, 6, 6]);
  });

  test('a revision layout rejects truncation and trailing bytes', () {
    final bytes = _rustHex('LAYOUT_RESULT_HEX');
    for (var end = 0; end < bytes.length; end += 1) {
      expect(
        () => decoder.decode(Uint8List.sublistView(bytes, 0, end)),
        throwsA(isA<FormatException>()),
        reason: 'a $end byte prefix must not decode',
      );
    }
    // A message that declares its own length correctly but carries a
    // byte no field reads.
    final longer = Uint8List(bytes.length + 1)..setAll(0, bytes);
    ByteData.sublistView(longer).setUint64(12, longer.length, Endian.little);
    expect(() => decoder.decode(longer), throwsA(isA<FormatException>()));
  });
}
