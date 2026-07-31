import 'dart:typed_data';

import 'package:crypto/crypto.dart' as crypto;

/// Generic CSS family role occupied by one pinned fallback face
/// (runtime pinned-font policy schema v1).
/// Which generic keyword a pinned face stands in for.
///
/// The role is **not** a filter at paint time. It is a sort key: the
/// engine orders every pinned face by (role, language, sha256) with
/// `serif` first, `sansSerif` second, `monospace` last, and then
/// inserts *all* of them, in that order, ahead of the first generic
/// keyword in a run's family stack. A run asking for `sans-serif`
/// therefore still meets the serif-role face first. See
/// [RitoPinnedFontPolicy] for what that means in practice.
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

  /// Weight this face stands in for. Policy v1 pins one Regular per
  /// generic role, so the default is 400 and a bold run synthesizes.
  /// A host that pins a real bold declares it here, and runs at that
  /// weight paint the face as designed instead of emboldening it.
  final int declaredWeight;

  /// Optional ASCII BCP47-style selector (e.g. `ja`, `zh-hant`);
  /// absent means the `und` default.
  final String? language;
}

/// Version-one pinned fallback face set supplied on session open.
/// The measurement and paint fallback faces a host pins for a session.
///
/// This reads like "a set of faces divided up by role", and it is not.
/// It is one fallback chain, and three rules govern it:
///
/// 1. **The order you pass faces in is discarded.** The engine sorts by
///    (genericRole, language, sha256), and [RitoPinnedFontGenericRole]
///    orders serif before sansSerif before monospace. Reordering
///    [faces] changes nothing.
/// 2. **Roles do not filter.** Every alias is spliced in ahead of the
///    first generic keyword of a run's stack, whatever that keyword is.
///    What actually paints a glyph is the first face in the sorted
///    chain that covers it, regardless of whether the book asked for
///    `serif` or `sans-serif`.
/// 3. **Therefore:** pin one face and it owns every generic keyword in
///    the book; pin several and the earlier role wins, with later ones
///    reached only for glyphs the earlier face lacks.
///
/// The practical consequence, and the thing that costs an afternoon if
/// you learn it the hard way: to change the reader's default body face,
/// change *which single face you pin* — not the order, and not the
/// role. A role change alone produces no visible difference and no
/// error.
final class RitoPinnedFontPolicy {
  RitoPinnedFontPolicy({required List<RitoPinnedFontFace> faces})
    : faces = List<RitoPinnedFontFace>.unmodifiable(faces) {
    if (faces.isEmpty) {
      throw ArgumentError('pinned font policy must contain at least one face');
    }
  }

  final List<RitoPinnedFontFace> faces;
}
