import 'dart:convert';
import 'dart:typed_data';

import 'artifact_models.dart';
import 'binary_reader.dart';

/// EPUB semantic role of a footnote definition, taken from the
/// publication's own `epub:type`. Hosts title the popup with it — a
/// footnote and an endnote are read differently.
enum RitoFootnoteKind { footnote, endnote, rearnote, note }

/// A resolved footnote definition.
final class RitoFootnote {
  const RitoFootnote({
    required this.artifactId,
    required this.key,
    required this.kind,
    required this.text,
    required this.html,
  });

  final int artifactId;

  /// The canonical key this definition was read under — the same string
  /// the hit carried in [RitoHitEntry.footnoteKey].
  final String key;
  final RitoFootnoteKind kind;

  /// Plain reading text, newline-joined.
  final String text;

  /// The same content as an allowlist-sanitized HTML fragment that
  /// preserves safe structure (emphasis, links, lists).
  final String html;
}

final class RitoFootnoteDecoder {
  const RitoFootnoteDecoder();

  static final List<int> _magic = ascii.encode('RITOFTN1');

  RitoFootnote decode(Uint8List bytes) {
    if (bytes.length > ritoMaxWireBytes) {
      throw const FormatException('RITOFTN1 exceeds the byte limit.');
    }
    final reader = RitoBinaryReader(bytes);
    reader.expectMagic(_magic, 'footnote magic');
    final version = reader.uint32('footnote wire version');
    if (version != 1) {
      reader.fail('unsupported footnote wire version: $version');
    }
    final declaredLength = reader.uint64('footnote total length');
    if (declaredLength != bytes.length) {
      reader.fail('footnote total length does not match input');
    }
    final footnote = RitoFootnote(
      artifactId: reader.externalId('footnote artifact id'),
      key: reader.string('footnote key'),
      kind: _kind(reader),
      text: reader.string('footnote text'),
      html: reader.string('footnote html'),
    );
    reader.finish('footnote wire message');
    return footnote;
  }

  RitoFootnoteKind _kind(RitoBinaryReader reader) {
    final tag = reader.uint32('footnote kind');
    if (tag >= RitoFootnoteKind.values.length) {
      reader.fail('unknown footnote kind: $tag');
    }
    return RitoFootnoteKind.values[tag];
  }
}
