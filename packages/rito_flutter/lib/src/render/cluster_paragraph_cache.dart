import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';

/// What a cluster paragraph is laid out from: the cluster's text, the
/// run's family stack, size, weight and slope, and the ink it paints in.
typedef RitoClusterParagraphKey = (String, String, double, double, bool, int);

/// Laid-out cluster paragraphs kept across paints and pages, the least
/// recently used dropped once more than [capacity] are kept.
///
/// One process-wide cache serves every page and session: the families a
/// page paints are named after their font file (`__RitoFace_<hash>`,
/// `__RitoPinned_<hash>`), registered before any page that uses them can
/// be painted, and never unloaded, so a key lays out the same paragraph
/// wherever it comes from. Text paints in CSS pixels under the list's
/// ratio, so the ratio is no part of the key.
final class RitoClusterParagraphCache {
  RitoClusterParagraphCache({this.capacity = defaultCapacity})
    : assert(capacity > 0);

  /// Some twelve megabytes at the six kilobytes a one-character paragraph
  /// measured under flutter_tester: the body text of a CJK book, two
  /// thousand-odd characters, fits.
  static const int defaultCapacity = 2048;

  static final RitoClusterParagraphCache shared = RitoClusterParagraphCache();

  final int capacity;

  // Insertion-ordered: the first key is the least recently used.
  final Map<RitoClusterParagraphKey, ui.Paragraph> _paragraphs =
      <RitoClusterParagraphKey, ui.Paragraph>{};
  int _builds = 0;

  /// How many paragraphs [build] has laid out.
  @visibleForTesting
  int get builds => _builds;

  /// The paragraph kept for [key], laid out by [build] if none is.
  ///
  /// A paragraph dropped from the cache is not disposed: a page recorded
  /// with it may not have been rasterized yet. The garbage collector
  /// frees it.
  ui.Paragraph lookup(
    RitoClusterParagraphKey key,
    ui.Paragraph Function() build,
  ) {
    final kept = _paragraphs.remove(key);
    if (kept != null) {
      _paragraphs[key] = kept;
      return kept;
    }
    final built = build();
    _builds += 1;
    _paragraphs[key] = built;
    if (_paragraphs.length > capacity) {
      _paragraphs.remove(_paragraphs.keys.first);
    }
    return built;
  }
}
