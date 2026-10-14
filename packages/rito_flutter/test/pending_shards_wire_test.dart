import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter_protocol.dart';

/// The bytes Core's encoder writes, read from the Rust fixture itself so the
/// Dart decoder can never drift from the encoder unnoticed.
Uint8List _rustFixture(String name) {
  final source = File(
    '../../crates/rito-core/src/runtime/reader_session/wire/query_tests.rs',
  ).readAsStringSync();
  final match = RegExp(
    'const $name: &str = concat!\\(([^)]*)\\);',
  ).firstMatch(source);
  expect(match, isNotNull, reason: '$name is pinned in the Rust tests');
  final hex = RegExp(
    '"([0-9a-f]*)"',
  ).allMatches(match!.group(1)!).map((part) => part.group(1)!).join();
  return Uint8List.fromList(<int>[
    for (var index = 0; index < hex.length; index += 2)
      int.parse(hex.substring(index, index + 2), radix: 16),
  ]);
}

void main() {
  test('decodes the RITOPSH1 bytes Core writes', () {
    final pending = const RitoPendingShardsDecoder().decode(
      _rustFixture('PENDING_SHARDS_HEX'),
    );
    expect(pending.shardIds, <int>[2, 5]);
    expect(pending.message, 'chapter two waits');
  });

  test('rejects a trailing byte and an unordered shard list', () {
    final bytes = _rustFixture('PENDING_SHARDS_HEX');
    final trailing = Uint8List.fromList(<int>[...bytes, 0]);
    expect(
      () => const RitoPendingShardsDecoder().decode(trailing),
      throwsFormatException,
    );
    final unordered = Uint8List.fromList(bytes);
    // Swap the two ids (2, 5) that follow the 20-byte header and the count.
    unordered[24] = 5;
    unordered[28] = 2;
    expect(
      () => const RitoPendingShardsDecoder().decode(unordered),
      throwsFormatException,
    );
  });
}
