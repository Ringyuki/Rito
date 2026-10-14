import 'dart:convert';
import 'dart:typed_data';

import '../native/pinned_font_policy.dart';
import 'binary_reader.dart';

/// Where a nameable family comes from.
enum RitoFontSource {
  /// A face the host registered: the pinned policy and later additions.
  host,

  /// An `@font-face` binding of the publication.
  publication,
}

/// One face of a nameable family.
final class RitoFontFamilyFace {
  const RitoFontFamilyFace({
    required this.weight,
    required this.style,
    this.sha256,
  });

  final int weight;

  /// `normal`, `italic` or `oblique`.
  final String style;

  /// A host face's SHA-256, the handle it is removed by; null for a
  /// publication face.
  final String? sha256;
}

/// A family a `font-family` list can name.
final class RitoFontFamily {
  const RitoFontFamily({
    required this.name,
    required this.source,
    required this.faces,
    this.genericRole,
    this.language,
  });

  final String name;
  final RitoFontSource source;

  /// The generic family a host family serves; null for a publication's.
  final RitoPinnedFontGenericRole? genericRole;

  /// A host family's language (`und` serves every language); null for a
  /// publication's.
  final String? language;
  final List<RitoFontFamilyFace> faces;
}

/// Every family a `font-family` list can name in an open session: the
/// host's, by the family their name tables declare, then the
/// publication's `@font-face` families.
final class RitoFontCatalog {
  const RitoFontCatalog({required this.families});

  final List<RitoFontFamily> families;
}

/// Decodes the session's `RITOFNT1` font catalog and `RITOFNN1` name list.
final class RitoFontDecoder {
  const RitoFontDecoder();

  static final List<int> _catalogMagic = ascii.encode('RITOFNT1');
  static final List<int> _namesMagic = ascii.encode('RITOFNN1');

  RitoFontCatalog decodeCatalog(Uint8List bytes) {
    final reader = _message(bytes, _catalogMagic, 'font catalog');
    final families = List<RitoFontFamily>.generate(
      reader.count('font families'),
      (_) => _family(reader),
    );
    reader.finish('font catalog wire message');
    return RitoFontCatalog(
      families: List<RitoFontFamily>.unmodifiable(families),
    );
  }

  List<String> decodeNames(Uint8List bytes) {
    final reader = _message(bytes, _namesMagic, 'font names');
    final names = List<String>.generate(
      reader.count('font names'),
      (_) => reader.string('font name'),
    );
    reader.finish('font names wire message');
    return List<String>.unmodifiable(names);
  }

  RitoBinaryReader _message(Uint8List bytes, List<int> magic, String what) {
    if (bytes.length > ritoMaxWireBytes) {
      throw FormatException('$what exceeds the byte limit.');
    }
    final reader = RitoBinaryReader(bytes);
    reader.expectMagic(magic, '$what magic');
    final version = reader.uint32('$what wire version');
    if (version != 1) {
      reader.fail('unsupported $what wire version: $version');
    }
    if (reader.uint64('$what total length') != bytes.length) {
      reader.fail('$what total length does not match input');
    }
    return reader;
  }

  RitoFontFamily _family(RitoBinaryReader reader) {
    final name = reader.string('font family name');
    final source = switch (reader.uint32('font source')) {
      0 => RitoFontSource.host,
      1 => RitoFontSource.publication,
      final tag => reader.fail('unknown font source: $tag'),
    };
    final genericRole = switch (reader.uint32('generic role')) {
      0 => null,
      1 => RitoPinnedFontGenericRole.serif,
      2 => RitoPinnedFontGenericRole.sansSerif,
      3 => RitoPinnedFontGenericRole.monospace,
      final tag => reader.fail('unknown generic role: $tag'),
    };
    final language = reader.option(
      'font family language',
      () => reader.string('font family language'),
    );
    final faces = List<RitoFontFamilyFace>.generate(
      reader.count('font faces'),
      (_) => RitoFontFamilyFace(
        weight: reader.uint16('font face weight'),
        style: reader.string('font face style'),
        sha256: reader.option(
          'font face sha256',
          () => reader.string('font face sha256'),
        ),
      ),
    );
    return RitoFontFamily(
      name: name,
      source: source,
      genericRole: genericRole,
      language: language,
      faces: List<RitoFontFamilyFace>.unmodifiable(faces),
    );
  }
}
