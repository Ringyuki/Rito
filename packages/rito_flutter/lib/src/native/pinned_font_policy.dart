import 'dart:typed_data';

import 'package:crypto/crypto.dart' as crypto;

/// Generic CSS family role occupied by one pinned fallback face
/// (runtime pinned-font policy schema v1).
/// Which generic keyword a pinned face serves.
///
/// The role **is a filter**: a run whose family list resolves to
/// `serif` is only offered faces pinned as [serif], and a face pinned
/// as [sansSerif] never appears in it. Getting this wrong is silent —
/// the run falls through to whatever the platform supplies, which is
/// exactly what pinning exists to prevent — so a host that pins one
/// face must pin it for the role its books actually use.
///
/// Most EPUBs declare no `font-family` at all and their text resolves
/// to `serif`, so `serif` is the role to pin first.
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
/// Three rules govern it:
///
/// 1. **The order you pass faces in is discarded.** The engine sorts by
///    (genericRole, language, sha256). Reordering [faces] changes
///    nothing.
/// 2. **The role selects which runs a face serves.** A run resolving to
///    `serif` is offered only serif-role faces; a sans-serif-role face
///    is invisible to it. Language narrows this further: a face tagged
///    for a language is preferred inside that language and still
///    reachable outside it, within the same role.
/// 3. **A generic with no pinned face for its role is not pinned at
///    all.** That run falls through to whatever the platform has, which
///    differs across iOS, Android and the browser — the determinism
///    pinning exists for is lost for those runs, silently.
///
/// The practical consequence: to change the reader's body face, pin the
/// new face **under the role the book's text actually resolves to**.
/// Most EPUBs declare no `font-family`, so that role is `serif`. Pinning
/// a single sans-serif face for such a book changes nothing and reports
/// nothing.
final class RitoPinnedFontPolicy {
  RitoPinnedFontPolicy({required List<RitoPinnedFontFace> faces})
    : faces = List<RitoPinnedFontFace>.unmodifiable(faces) {
    if (faces.isEmpty) {
      throw ArgumentError('pinned font policy must contain at least one face');
    }
  }

  final List<RitoPinnedFontFace> faces;
}
