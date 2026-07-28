import 'dart:typed_data';

import 'font_family_stack.dart';

/// Per-family font metrics the browser pen reads off Chromium's canvas,
/// re-derived from the same sfnt tables so both pens stay
/// platform-independent (SkParagraph only exposes hhea-based line
/// metrics, which match neither anchor).
///
/// Two distinct sources, probed against pinned Chromium:
/// - `textBaseline: 'top'` (ruby, the text-shadow scratch pass) drops
///   from the anchor by the OS/2 `sTypoAscender` — the em-box top — and
///   the raster still snaps the resulting baseline to a device row.
/// - canvas `fontBoundingBoxAscent`/`Descent` (the inline background
///   envelope) are `usWinAscent`/`usWinDescent` scaled and rounded to
///   whole pixels.
final class RitoFontEnvelope {
  const RitoFontEnvelope({
    required this.typoAscender,
    required this.typoDescender,
    required this.winAscent,
    required this.winDescent,
    required this.unitsPerEm,
  });

  final int typoAscender;
  final int typoDescender;
  final int winAscent;
  final int winDescent;
  final int unitsPerEm;

  /// Unrounded em-box ascent: the 'top' anchor descends by this before
  /// the raster's whole-row baseline snap.
  double topAnchorAscentPx(double sizePx) => typoAscender * sizePx / unitsPerEm;

  /// Chromium's canvas fontBoundingBoxAscent (grid-fit).
  double boundingAscentPx(double sizePx) =>
      (winAscent * sizePx / unitsPerEm).roundToDouble();

  /// Chromium's canvas fontBoundingBoxDescent (grid-fit).
  double boundingDescentPx(double sizePx) =>
      (winDescent * sizePx / unitsPerEm).roundToDouble();
}

final class RitoFontEnvelopeStore {
  RitoFontEnvelopeStore();

  /// Process-wide store, mirroring Flutter's process-wide font
  /// registration: faces cannot be unloaded, so their envelopes are
  /// kept for the process lifetime too. [RitoArtifactFontCache] fills
  /// it as artifact fonts register; the page painter reads it.
  static final RitoFontEnvelopeStore shared = RitoFontEnvelopeStore();

  final Map<String, RitoFontEnvelope> _byFamily = <String, RitoFontEnvelope>{};

  /// Registers a face's envelope for [family] from raw sfnt bytes
  /// (TTF or CFF-flavoured OTF). Non-sfnt payloads are ignored.
  void register(String family, Uint8List bytes) {
    final envelope = _parse(bytes);
    if (envelope != null) {
      _byFamily[family] = envelope;
    }
  }

  RitoFontEnvelope? lookup(String family) => _byFamily[family];

  /// Resolves a run's comma-joined CSS family stack to the first
  /// registered face's envelope — the same face Flutter's fallback
  /// chain will paint with.
  RitoFontEnvelope? lookupFamilyStack(String stack) {
    for (final family in ritoSplitFontFamilyStack(stack)) {
      final envelope = _byFamily[family];
      if (envelope != null) {
        return envelope;
      }
    }
    return null;
  }

  static RitoFontEnvelope? _parse(Uint8List bytes) {
    final data = ByteData.sublistView(bytes);
    if (bytes.length < 12) return null;
    final version = data.getUint32(0);
    // 0x00010000 TrueType, 'OTTO' CFF, 'true' legacy Apple TrueType.
    if (version != 0x00010000 &&
        version != 0x4f54544f &&
        version != 0x74727565) {
      return null;
    }
    final numTables = data.getUint16(4);
    int? os2Offset;
    int? headOffset;
    for (var i = 0; i < numTables; i += 1) {
      final record = 12 + i * 16;
      if (record + 16 > bytes.length) return null;
      final tag = data.getUint32(record);
      final offset = data.getUint32(record + 8);
      if (tag == 0x4f532f32) os2Offset = offset; // 'OS/2'
      if (tag == 0x68656164) headOffset = offset; // 'head'
    }
    if (os2Offset == null || headOffset == null) return null;
    if (os2Offset + 78 > bytes.length || headOffset + 20 > bytes.length) {
      return null;
    }
    return RitoFontEnvelope(
      typoAscender: data.getInt16(os2Offset + 68),
      typoDescender: data.getInt16(os2Offset + 70),
      winAscent: data.getUint16(os2Offset + 74),
      winDescent: data.getUint16(os2Offset + 76),
      unitsPerEm: data.getUint16(headOffset + 18),
    );
  }
}
