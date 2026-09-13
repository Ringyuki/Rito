import 'artifact_models.dart';

/// What a tap on the painted surface lands on, resolved from the
/// artifact's hit entries — the engine's own account of links, note
/// anchors and images, already in display-list space. Hosts hit-test
/// against this instead of reading semantics off paint commands: the
/// engine classifies note anchors (and reports whether their definition
/// is indexed yet), and a link wrapping an image resolves as the link.
sealed class RitoTapTarget {
  const RitoTapTarget();

  /// The hit entry the tap resolved to.
  RitoHitEntry get hit;
}

/// A link that is not a note anchor: navigate or open externally.
final class RitoTapLink extends RitoTapTarget {
  const RitoTapLink({required this.hit, required this.href, this.label});

  @override
  final RitoHitEntry hit;
  final String href;

  /// The visible text of the whole link — every contiguous run sharing
  /// the href, joined — or null when the link paints no text (an image
  /// or a block-level link box).
  final String? label;
}

/// A note anchor: read the note under [key] with `readFootnote`.
final class RitoTapFootnote extends RitoTapTarget {
  const RitoTapFootnote({
    required this.hit,
    required this.key,
    required this.pending,
    required this.href,
    this.label,
  });

  @override
  final RitoHitEntry hit;

  /// Canonical footnote key, passed to `readFootnote` verbatim.
  final String key;

  /// True while the note's definition is not indexed yet; the same read
  /// succeeds once the publication footnote index completes.
  final bool pending;
  final String href;
  final String? label;
}

/// An image outside any link.
final class RitoTapImage extends RitoTapTarget {
  const RitoTapImage({required this.hit, required this.src, this.alt});

  @override
  final RitoHitEntry hit;
  final String src;
  final String? alt;
}

/// Resolves taps against an artifact's pages.
///
/// Resolution order follows the engine's hit order — text runs, then
/// block-level link boxes, then images — so a tap inside a link's text
/// wins over an image behind it, and only an image outside every link
/// resolves as an image. Coordinates are display-list space, the same
/// space the artifact paints in.
final class RitoHitResolver {
  const RitoHitResolver(this.pages);

  RitoHitResolver.forArtifact(RitoArtifact artifact) : pages = artifact.pages;

  final List<RitoPage> pages;

  /// The target under `(x, y)`, or null when the tap lands on nothing.
  ///
  /// [linkSlack] widens every text link's band by that many pixels on
  /// each side, for pointers coarser than a mouse; images and block
  /// link boxes keep their exact bounds.
  RitoTapTarget? resolve({
    required double x,
    required double y,
    double linkSlack = 0,
  }) {
    for (final page in pages) {
      final hits = page.hits;
      for (var index = 0; index < hits.length; index++) {
        final hit = hits[index];
        final href = hit.href;
        if (href == null || href.isEmpty) continue;
        final slack = hit.imageSrc == null ? linkSlack : 0.0;
        if (!_contains(hit.bounds, x, y, slackX: slack)) continue;
        final label = hit.imageSrc == null
            ? _linkLabel(hits, index, href)
            : null;
        final key = hit.footnoteKey;
        if (key != null) {
          return RitoTapFootnote(
            hit: hit,
            key: key,
            pending: hit.footnotePending,
            href: href,
            label: label,
          );
        }
        return RitoTapLink(hit: hit, href: href, label: label);
      }
    }
    for (final page in pages) {
      for (final hit in page.hits) {
        final src = hit.imageSrc;
        if (src == null || !_contains(hit.bounds, x, y)) continue;
        return RitoTapImage(hit: hit, src: src, alt: hit.imageAlt);
      }
    }
    return null;
  }
}

bool _contains(RitoRect bounds, double x, double y, {double slackX = 0}) {
  return x >= bounds.x - slackX &&
      x <= bounds.x + bounds.width + slackX &&
      y >= bounds.y &&
      y <= bounds.y + bounds.height;
}

/// The text of every contiguous hit sharing [href] around [index].
String? _linkLabel(List<RitoHitEntry> hits, int index, String href) {
  var start = index;
  while (start > 0 && hits[start - 1].href == href) {
    start--;
  }
  var end = index;
  while (end + 1 < hits.length && hits[end + 1].href == href) {
    end++;
  }
  final label = [for (var i = start; i <= end; i++) hits[i].text].join().trim();
  return label.isEmpty ? null : label;
}
