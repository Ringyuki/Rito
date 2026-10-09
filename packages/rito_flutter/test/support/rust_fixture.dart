import 'dart:io';
import 'dart:typed_data';

/// The bytes a Rust test pins under `const NAME: &str = concat!(...)`.
///
/// Reading them from the Rust source keeps a Dart mirror on bytes the
/// engine's encoder wrote: a copy pasted into a Dart test stays green
/// after the encoder moves on.
Uint8List rustFixtureBytes(String path, String name) {
  final source = File(
    '../../crates/rito-core/src/runtime/reader_session/$path',
  ).readAsStringSync();
  final match = RegExp(
    'const $name: &str =\\s*concat!\\(([^)]*)\\)',
  ).firstMatch(source);
  if (match == null) {
    throw StateError('Rust fixture $name is missing from $path');
  }
  final hex = RegExp(
    '"([0-9a-f]*)"',
  ).allMatches(match.group(1)!).map((part) => part.group(1)!).join();
  return Uint8List.fromList(<int>[
    for (var index = 0; index < hex.length; index += 2)
      int.parse(hex.substring(index, index + 2), radix: 16),
  ]);
}
