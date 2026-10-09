import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter_protocol.dart';

import 'support/rust_fixture.dart';

/// The request bytes are read from the Rust test that pins them
/// (`wire/query_tests.rs`). The resolution below was produced by the
/// Rust encoder from `exact_source_range_resolution_fixture` in
/// `wire/tests.rs`: a mirror that only ever reads bytes it wrote itself
/// keeps passing while it rejects real ones, which is how the
/// publication decoder once stayed pinned to a version the encoder had
/// left behind. Regenerate it from Rust whenever the message changes
/// shape.
const String _resolutionHex =
    '5249544f4553523101000000bd000000000000000900000000000000000000000103000000'
    '100000007468652071756f74656420776f7264730200000038000000000000000300000000'
    '000000000029400000000000004440000000000010564000000000000032400200000001'
    '000000000000000400000014000000380000000000000004000000000000000000000000'
    '000000000028400000000000003e4000000000000032400300000000000000000000000000'
    '000006000000';

Uint8List _bytes(String hex) {
  final normalized = hex.replaceAll(RegExp(r'\s'), '');
  return Uint8List.fromList(<int>[
    for (var index = 0; index < normalized.length; index += 2)
      int.parse(normalized.substring(index, index + 2), radix: 16),
  ]);
}

RitoExactSourceRangeRequest _request() => RitoExactSourceRangeRequest(
  sessionId: 7,
  artifactId: 9,
  href: 'OEBPS/chapter-2.xhtml',
  range: RitoSourceRange(
    start: RitoSourcePoint(nodePath: <int>[1, 0, 4], textOffset: 12),
    end: RitoSourcePoint(nodePath: <int>[1, 0, 4], textOffset: 31),
  ),
  everyPage: true,
);

void main() {
  test('RITOESQ1 encodes the bytes the engine decodes', () {
    final encoded = const RitoRequestEncoder().encodeExactSourceRange(
      _request(),
    );

    expect(
      encoded,
      equals(
        rustFixtureBytes(
          'wire/query_tests.rs',
          'EXACT_SOURCE_RANGE_REQUEST_HEX',
        ),
      ),
    );
  });

  test('RITOESR1 decodes a resolution the engine encoded', () {
    final resolution = const RitoExactSourceRangeDecoder().decode(
      _bytes(_resolutionHex),
    );

    expect(resolution.artifactId, 9);
    expect(resolution.status, RitoExactSourceRangeStatus.resolved);
    expect(resolution.firstPageIndex, 3);
    expect(resolution.selectedText, 'the quoted words');
    expect(resolution.rects, hasLength(2));

    final first = resolution.rects.first;
    expect(first.pageIndex, 3);
    expect(first.bounds.x, 12.5);
    expect(first.bounds.y, 40.0);
    expect(first.bounds.width, 88.25);
    expect(first.bounds.height, 18.0);
    expect(first.blockIndex, 2);
    expect(first.lineIndex, 1);
    expect(first.runIndex, 0);
    expect(first.startCharIndex, 4);
    expect(first.endCharIndex, 20);

    // A range that spills onto the spread's second page keeps its own
    // page index, so a host paints each rect on the page it belongs to.
    final second = resolution.rects.last;
    expect(second.pageIndex, 4);
    expect(second.bounds.x, 0.0);
    expect(second.startCharIndex, 0);
    expect(second.endCharIndex, 6);
  });

  test('RITOESR1 rejects truncation, a bad length and an unknown status', () {
    const decoder = RitoExactSourceRangeDecoder();
    final bytes = _bytes(_resolutionHex);
    for (var end = 0; end < bytes.length; end += 1) {
      expect(
        () => decoder.decode(Uint8List.sublistView(bytes, 0, end)),
        throwsA(isA<FormatException>()),
        reason: 'a $end byte prefix must not decode',
      );
    }

    // The status tag sits after the 20-byte header and the artifact id.
    final unknownStatus = Uint8List.fromList(bytes);
    unknownStatus[20 + 8] = 9;
    expect(
      () => decoder.decode(unknownStatus),
      throwsA(isA<FormatException>()),
    );
  });
}
