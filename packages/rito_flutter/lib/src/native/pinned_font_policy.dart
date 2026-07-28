import 'dart:typed_data';

import 'package:crypto/crypto.dart' as crypto;

/// Generic CSS family role occupied by one pinned fallback face
/// (runtime pinned-font policy schema v1).
enum RitoPinnedFontGenericRole { serif, sansSerif, monospace }

/// One host-pinned measurement fallback face.
///
/// Pinning a policy is what switches on the core's required-font-face
/// catalog: layout measures text against these bytes (plus the
/// publication's own embedded faces) and every artifact then declares
/// the embedded faces its layout used, so the font cache can register
/// them before paint. Without a policy `artifact.fonts` stays empty and
/// embedded EPUB fonts never render.
final class RitoPinnedFontFace {
  RitoPinnedFontFace({
    required this.bytes,
    required this.genericRole,
    this.language,
    String? sha256Hex,
  }) : sha256Hex = (sha256Hex ?? crypto.sha256.convert(bytes).toString())
           .toLowerCase() {
    if (bytes.isEmpty) {
      throw ArgumentError('pinned font face bytes must not be empty');
    }
    if (this.sha256Hex.length != 64) {
      throw ArgumentError.value(
        sha256Hex,
        'sha256Hex',
        'must contain 64 hexadecimal digits',
      );
    }
  }

  /// Stable family alias the engine paints this face under — pinned
  /// aliases appear in every run's family stack ahead of the generic
  /// tail. Must stay in lockstep with the core's
  /// `RuntimePinnedFontFace::family_alias` (`__RitoPinned_<sha256>`,
  /// contract-tested on the Rust side).
  String get familyAlias => '__RitoPinned_$sha256Hex';

  /// Raw TTF/OTF face bytes. Variable fonts are rejected by the core.
  final Uint8List bytes;

  /// Lowercase hex SHA-256 of [bytes]; computed automatically when not
  /// supplied. The core re-derives and rejects mismatches.
  final String sha256Hex;

  final RitoPinnedFontGenericRole genericRole;

  /// Optional ASCII BCP47-style selector (e.g. `ja`, `zh-hant`);
  /// absent means the `und` default.
  final String? language;
}

/// Version-one pinned fallback face set supplied on session open.
final class RitoPinnedFontPolicy {
  RitoPinnedFontPolicy({required List<RitoPinnedFontFace> faces})
    : faces = List<RitoPinnedFontFace>.unmodifiable(faces) {
    if (faces.isEmpty) {
      throw ArgumentError('pinned font policy must contain at least one face');
    }
  }

  final List<RitoPinnedFontFace> faces;
}
