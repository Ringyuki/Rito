import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart';

// Pinned byte for byte by the Rust encoder's tests
// (crates/rito-core/src/runtime/reader_session/wire/fonts.rs).
const _catalogHex =
    '5249544f464e5431010000006a00000000000000020000000500000054696e6f'
    '7300000000010000000103000000756e64010000009001060000006e6f726d61'
    '6c0102000000616204000000426f6f6b01000000000000000001000000bc0206'
    '0000006974616c696300';
const _namesHex =
    '5249544f464e4e31010000003300000000000000020000000c0000004e6f2053'
    '75636820466163650700000047656f72676961';

Uint8List _bytes(String hex) => Uint8List.fromList(<int>[
  for (var index = 0; index < hex.length; index += 2)
    int.parse(hex.substring(index, index + 2), radix: 16),
]);

void main() {
  test('the font catalog decodes from the core wire', () {
    final catalog = const RitoFontDecoder().decodeCatalog(_bytes(_catalogHex));
    final host = catalog.families[0];
    expect(host.name, 'Tinos');
    expect(host.source, RitoFontSource.host);
    expect(host.genericRole, RitoPinnedFontGenericRole.serif);
    expect(host.language, 'und');
    expect(host.faces.single.weight, 400);
    expect(host.faces.single.style, 'normal');
    expect(host.faces.single.sha256, 'ab');
    final book = catalog.families[1];
    expect(book.name, 'Book');
    expect(book.source, RitoFontSource.publication);
    expect(book.genericRole, isNull);
    expect(book.language, isNull);
    expect(book.faces.single.weight, 700);
    expect(book.faces.single.style, 'italic');
    expect(book.faces.single.sha256, isNull);
  });

  test('font names decode from the core wire', () {
    expect(const RitoFontDecoder().decodeNames(_bytes(_namesHex)), <String>[
      'No Such Face',
      'Georgia',
    ]);
  });

  test('a truncated catalog is refused', () {
    final bytes = _bytes(_catalogHex);
    expect(
      () => const RitoFontDecoder().decodeCatalog(
        Uint8List.sublistView(bytes, 0, bytes.length - 1),
      ),
      throwsFormatException,
    );
  });
}
