import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart' show RitoTextPosition;
import 'package:rito_flutter/rito_flutter_protocol.dart';

/// Every byte string below was produced by the Rust encoder from the
/// fixtures in `reader_session/interaction_tests.rs`, which pins the same
/// strings. A mirror that only reads bytes it wrote itself keeps passing
/// while it rejects real ones; regenerate these from Rust whenever a
/// message changes shape.
const String _movementHex =
    '5249544f54495131010000006a00000000000000070000000000000009000000'
    '0000000004150000000000000003000000020000000100000000000000040000'
    '0001150000000000000004000000000000000000000001000000060000000006'
    '010000000000205e4000';

const String _pointsHex =
    '5249544f54495131010000005e00000000000000070000000000000009000000'
    '0000000003140000000000000003000000000000000000294000000000000044'
    '401400000000000000030000000000000000003440000000000080444001';

const String _selectionHex =
    '5249544f5449523101000000ee01000000000000090000000000000001016f00'
    '0000000000001500000000000000030000000200000001000000000000000400'
    '0000010100000000000029400000000000004440000000000000324015000000'
    '4f454250532f636861707465722d322e7868746d6c1800000000000000030000'
    '000100000000000000040000000c00000000000000003e010000000000001500'
    '0000000000000300000002000000010000000000000004000000011500000000'
    '0000000300000002000000010000000000000014000000001500000000000000'
    '0300000002000000010000000000000004000000011500000000000000030000'
    '000200000001000000000000001400000000100000007468652071756f746564'
    '20776f726473150000004f454250532f636861707465722d322e7868746d6c18'
    '00000000000000030000000100000000000000040000000c0000000000000015'
    '0000004f454250532f636861707465722d322e7868746d6c1800000000000000'
    '030000000100000000000000040000001c000000000000000100000038000000'
    '0000000003000000000000000000294000000000000044400000000000105640'
    '0000000000003240020000000100000000000000040000001400000001000000'
    '0000205e40010000000000c47240';

const String _createHex =
    '5249544f414e5131010000007e00000000000000070000000000000000150000'
    '004f454250532f636861707465722d322e7868746d6c40000000000000001800'
    '000000000000030000000100000000000000040000000c000000000000001800'
    '000000000000030000000100000000000000040000001c00000000000000';

const String _quoteHex =
    '5249544f414e523101000000d6010000000000000201b8010000000000001201'
    '00007b2276657273696f6e223a312c2268726566223a224f454250532f636861'
    '707465722d322e7868746d6c222c22736f7572636552616e6765223a7b227374'
    '617274223a7b226e6f646550617468223a5b312c302c345d2c22746578744f66'
    '66736574223a31327d2c22656e64223a7b226e6f646550617468223a5b312c30'
    '2c345d2c22746578744f6666736574223a32387d7d2c2271756f7465223a7b22'
    '6578616374223a227468652071756f74656420776f726473222c227072656669'
    '78223a224265666f726520222c22737566666978223a22206166746572227d2c'
    '22706f736974696f6e223a7b227374617274223a31322c22656e64223a32382c'
    '22636861707465724c656e677468223a33347d7d150000004f454250532f6368'
    '61707465722d322e7868746d6c40000000000000001800000000000000030000'
    '000100000000000000040000000c000000000000001800000000000000030000'
    '000100000000000000040000001c00000000000000100000007468652071756f'
    '74656420776f726473070000004265666f726520060000002061667465720c00'
    '0000000000001c000000000000002200000000000000';

/// The engine's canonical target for the fixtures above.
const String _canonicalTarget =
    r'{"version":1,"href":"OEBPS/chapter-2.xhtml","sourceRange":{"start":{"nodePath":[1,0,4],"textOffset":12},"end":{"nodePath":[1,0,4],"textOffset":28}},"quote":{"exact":"the quoted words","prefix":"Before ","suffix":" after"},"position":{"start":12,"end":28,"chapterLength":34}}';

Uint8List _bytes(String hex) => Uint8List.fromList(<int>[
  for (var index = 0; index < hex.length; index += 2)
    int.parse(hex.substring(index, index + 2), radix: 16),
]);

RitoCaretAddress _address(
  int page,
  int block,
  int line,
  int run,
  int char,
  RitoCaretAffinity affinity,
) => RitoCaretAddress(
  pageIndex: page,
  position: RitoTextPosition(
    blockIndex: block,
    lineIndex: line,
    runIndex: run,
    charIndex: char,
  ),
  affinity: affinity,
);

void main() {
  const encoder = RitoRequestEncoder();

  test('RITOTIQ1 encodes the bytes the engine decodes', () {
    final movement = encoder.encodeTextInteraction(
      RitoTextInteractionRequest(
        sessionId: 7,
        artifactId: 9,
        query: RitoMovementQuery(
          anchor: _address(3, 2, 1, 0, 4, RitoCaretAffinity.downstream),
          focus: _address(4, 0, 0, 1, 6, RitoCaretAffinity.upstream),
          movement: RitoSelectionMovement.lineDown,
          preferredInlinePosition: 120.5,
        ),
      ),
    );
    expect(movement, equals(_bytes(_movementHex)));

    final points = encoder.encodeTextInteraction(
      const RitoTextInteractionRequest(
        sessionId: 7,
        artifactId: 9,
        query: RitoRangeFromPointsQuery(
          anchor: RitoTextPoint(pageIndex: 3, x: 12.5, y: 40),
          focus: RitoTextPoint(pageIndex: 3, x: 20, y: 41),
          granularity: RitoSelectionGranularity.paragraph,
        ),
      ),
    );
    expect(points, equals(_bytes(_pointsHex)));
  });

  test('RITOTIR1 decodes a selection the engine encoded', () {
    final response = const RitoTextInteractionDecoder().decode(
      _bytes(_selectionHex),
    );
    expect(response.artifactId, 9);
    final result = response.result as RitoSelectionResult;
    final anchor = result.anchorCaret!;
    expect(anchor.address.pageIndex, 3);
    expect(anchor.address.position.charIndex, 4);
    expect(anchor.address.affinity, RitoCaretAffinity.downstream);
    expect(anchor.geometry!.height, 18.0);
    expect(anchor.href, 'OEBPS/chapter-2.xhtml');
    expect(anchor.sourcePoint.nodePath, <int>[1, 0, 4]);
    expect(result.focusCaret, isNull);
    expect(result.selection.selectedText, 'the quoted words');
    expect(result.selection.focus.affinity, RitoCaretAffinity.upstream);
    expect(result.selection.sourceEnd.textOffset, 28);
    expect(result.selection.rects.single.bounds.width, 88.25);
    expect(result.preferredInlinePosition, 120.5);
    expect(result.preferredBlockPosition, 300.25);
  });

  test('RITOTIR1 rejects every truncated prefix and an unknown tag', () {
    const decoder = RitoTextInteractionDecoder();
    final bytes = _bytes(_selectionHex);
    for (var end = 0; end < bytes.length; end += 1) {
      expect(
        () => decoder.decode(Uint8List.sublistView(bytes, 0, end)),
        throwsA(isA<FormatException>()),
        reason: 'a $end byte prefix must not decode',
      );
    }
    // The result tag sits after the 20-byte header and the artifact id.
    final unknown = Uint8List.fromList(bytes)..[28] = 9;
    expect(() => decoder.decode(unknown), throwsA(isA<FormatException>()));
  });

  test('RITOANQ1 and RITOANR1 match the engine bytes', () {
    final create = encoder.encodeAnnotation(
      RitoAnnotationRequest(
        sessionId: 7,
        query: RitoCreateAnnotationQuery(
          href: 'OEBPS/chapter-2.xhtml',
          range: RitoSourceRange(
            start: RitoSourcePoint(nodePath: <int>[1, 0, 4], textOffset: 12),
            end: RitoSourcePoint(nodePath: <int>[1, 0, 4], textOffset: 28),
          ),
        ),
      ),
    );
    expect(create, equals(_bytes(_createHex)));

    final response = const RitoAnnotationDecoder().decode(_bytes(_quoteHex));
    expect(response.level, RitoAnnotationLevel.quote);
    final target = response.target!;
    expect(target.json, _canonicalTarget);
    expect(target.href, 'OEBPS/chapter-2.xhtml');
    expect(target.sourceRange.end.textOffset, 28);
    expect(target.exact, 'the quoted words');
    expect(target.prefix, 'Before ');
    expect(target.suffix, ' after');
    expect(target.start, 12);
    expect(target.end, 28);
    expect(target.chapterLength, 34);
  });

  test('RITOANR1 carries a target exactly when it is not orphaned', () {
    const decoder = RitoAnnotationDecoder();
    final bytes = _bytes(_quoteHex);
    for (var end = 0; end < bytes.length; end += 1) {
      expect(
        () => decoder.decode(Uint8List.sublistView(bytes, 0, end)),
        throwsA(isA<FormatException>()),
        reason: 'a $end byte prefix must not decode',
      );
    }
    // The level tag sits right after the 20-byte header.
    final orphanedWithTarget = Uint8List.fromList(bytes)..[20] = 5;
    expect(
      () => decoder.decode(orphanedWithTarget),
      throwsA(isA<FormatException>()),
    );
  });
}
