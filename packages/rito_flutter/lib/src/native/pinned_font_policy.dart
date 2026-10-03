import 'dart:typed_data';

import 'package:crypto/crypto.dart' as crypto;

/// The generic CSS family a host face serves.
///
/// A `serif`, `sans-serif` or `monospace` in a run's family list resolves
/// to the faces of that role: the language-neutral ones first, then those
/// tagged for a language, the content's own language ahead of the rest.
/// After the list, every other host face follows as the fallback, serif
/// first, so a role without a face of its own still paints with a host
/// face. Most EPUBs declare no `font-family` at all and their text
/// resolves to `serif`, so `serif` is the role to pin first.
enum RitoPinnedFontGenericRole { serif, sansSerif, monospace }

/// One face the host supplies to the engine. Layout shapes with these
/// bytes (plus the publication's own embedded faces), and paint draws every
/// run with the exact face that shaped it, so the session registers each
/// face with Flutter under its [familyAlias].
final class RitoPinnedFontFace {
  RitoPinnedFontFace({
    required this.bytes,
    required this.genericRole,
    this.declaredWeight = 400,
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

  /// The family name a run drawn from this face paints with. Must stay
  /// in lockstep with the core's `RuntimePinnedFontFace::family_alias`
  /// (`__RitoPinned_<sha256>`, contract-tested on the Rust side).
  String get familyAlias => '__RitoPinned_$sha256Hex';

  /// Raw TTF/OTF face bytes. Variable fonts are rejected by the core.
  final Uint8List bytes;

  /// Lowercase hex SHA-256 of [bytes]; computed automatically when not
  /// supplied. The core re-derives and rejects mismatches.
  final String sha256Hex;

  final RitoPinnedFontGenericRole genericRole;

  /// The face's own weight. A bold run on a Regular face synthesizes; a
  /// host that supplies a real bold declares it here, and runs at that
  /// weight paint the face as designed instead of emboldening it.
  final int declaredWeight;

  /// Optional ASCII BCP47-style selector (e.g. `ja`, `zh-hant`);
  /// absent means the `und` default.
  final String? language;
}

/// The host faces a session opens with.
///
/// The engine orders them canonically by (genericRole, language, sha256),
/// so the order passed in changes nothing; faces added later with
/// `RitoReaderSession.addFontFaces` follow in the order added. A face is
/// named in a `font-family` list by the family its name table declares,
/// and serves the generic of its [RitoPinnedFontFace.genericRole]; see
/// [RitoPinnedFontGenericRole] for how a generic resolves.
final class RitoPinnedFontPolicy {
  RitoPinnedFontPolicy({required List<RitoPinnedFontFace> faces})
    : faces = List<RitoPinnedFontFace>.unmodifiable(faces) {
    if (faces.isEmpty) {
      throw ArgumentError('pinned font policy must contain at least one face');
    }
  }

  final List<RitoPinnedFontFace> faces;
}
