import 'dart:typed_data';

import 'display_models.dart';

enum RitoLocatorMatch { sourceRange, sourcePoint, anchor, progression, href }

enum RitoTextProfile { platformStringRuns, positionedGlyphRuns }

enum RitoResourceKind { image, font, stylesheet }

final class RitoAdjacentAvailability {
  const RitoAdjacentAvailability._(this.name);

  final String name;

  static const RitoAdjacentAvailability available = RitoAdjacentAvailability._(
    'available',
  );
  static const RitoAdjacentAvailability pending = RitoAdjacentAvailability._(
    'pending',
  );
  static const RitoAdjacentAvailability chapterBoundary =
      RitoAdjacentAvailability._('chapter-boundary');
  static const RitoAdjacentAvailability terminal = RitoAdjacentAvailability._(
    'terminal',
  );
  static const RitoAdjacentAvailability blocked = RitoAdjacentAvailability._(
    'blocked',
  );
}

final class RitoNavigation {
  const RitoNavigation({required this.previous, required this.next});

  final RitoAdjacentAvailability previous;
  final RitoAdjacentAvailability next;
}

enum RitoSemanticRole {
  heading,
  paragraph,
  list,
  listItem,
  image,
  link,
  blockquote,
  table,
  generic,
}

final class RitoSourcePoint {
  RitoSourcePoint({required List<int> nodePath, required this.textOffset})
    : nodePath = List<int>.unmodifiable(nodePath);

  final List<int> nodePath;
  final int textOffset;
}

final class RitoSourceRange {
  const RitoSourceRange({required this.start, required this.end});

  final RitoSourcePoint start;
  final RitoSourcePoint end;
}

final class RitoLocator {
  const RitoLocator({
    required this.href,
    this.anchorId,
    this.sourcePoint,
    this.sourceRange,
    this.progression,
  });

  final String href;
  final String? anchorId;
  final RitoSourcePoint? sourcePoint;
  final RitoSourceRange? sourceRange;
  final double? progression;
}

final class RitoRect {
  const RitoRect({
    required this.x,
    required this.y,
    required this.width,
    required this.height,
  });

  final double x;
  final double y;
  final double width;
  final double height;
}

final class RitoDisplayListPayload {
  RitoDisplayListPayload({
    required this.formatVersion,
    required this.commandCount,
    required Uint8List semanticDigest,
    required Uint8List wireBytes,
    required this.displayList,
  }) : semanticDigest = semanticDigest.asUnmodifiableView(),
       wireBytes = wireBytes.asUnmodifiableView();

  final int formatVersion;
  final int commandCount;
  final Uint8List semanticDigest;
  final Uint8List wireBytes;
  final RitoDisplayList displayList;
}

final class RitoResourceRef {
  const RitoResourceRef({required this.kind, required this.href});

  final RitoResourceKind kind;
  final String href;
}

final class RitoResource {
  RitoResource({
    required this.artifactId,
    required this.kind,
    required this.href,
    required this.mediaType,
    required Uint8List bytes,
    this.width,
    this.height,
  }) : bytes = bytes.asUnmodifiableView();

  final int artifactId;
  final RitoResourceKind kind;
  final String href;
  final String mediaType;
  final Uint8List bytes;
  final int? width;
  final int? height;
}

final class RitoFontRef {
  const RitoFontRef({
    required this.family,
    required this.href,
    required this.style,
    required this.weight,
    required this.shapeFingerprint,
    required this.byteLength,
  });

  final String family;
  final String href;
  final String style;
  final int weight;
  final String shapeFingerprint;
  final int byteLength;
}

final class RitoHitEntry {
  const RitoHitEntry({
    required this.pageIndex,
    required this.bounds,
    required this.text,
    this.href,
    this.sourcePoint,
    this.imageSrc,
    this.imageAlt,
    this.footnoteKey,
    this.footnotePending = false,
  });

  final int pageIndex;
  final RitoRect bounds;
  final String text;
  final String? href;
  final RitoSourcePoint? sourcePoint;
  final String? imageSrc;
  final String? imageAlt;

  /// Canonical footnote key when this hit is a semantic noteref — the
  /// engine's own `href#fragment` form. Pass it to
  /// [RitoReaderSession.readFootnote] verbatim; a host must not
  /// normalize the link [href] itself. Null means an ordinary link.
  final String? footnoteKey;

  /// True while this key's definition has not been indexed yet. The key
  /// is already valid; reading it fails until background indexing
  /// reaches the definition, so a host can show the popup with a
  /// loading state and retry.
  final bool footnotePending;
}

final class RitoSemanticNode {
  RitoSemanticNode({
    required this.role,
    required this.bounds,
    required List<RitoSemanticNode> children,
    this.level,
    this.text,
    this.alt,
    this.href,
  }) : children = List<RitoSemanticNode>.unmodifiable(children);

  final RitoSemanticRole role;
  final int? level;
  final String? text;
  final String? alt;
  final String? href;
  final RitoRect bounds;
  final List<RitoSemanticNode> children;
}

final class RitoTextRunOffset {
  const RitoTextRunOffset({
    required this.start,
    required this.end,
    required this.blockIndex,
    required this.lineIndex,
    required this.runIndex,
  });

  final int start;
  final int end;
  final int blockIndex;
  final int lineIndex;
  final int runIndex;
}

final class RitoPage {
  RitoPage({
    required this.pageIndex,
    required this.width,
    required this.height,
    required List<RitoHitEntry> hits,
    required List<RitoSemanticNode> semantics,
    required this.text,
    required this.textLength,
    required List<RitoTextRunOffset> textRuns,
  }) : hits = List<RitoHitEntry>.unmodifiable(hits),
       semantics = List<RitoSemanticNode>.unmodifiable(semantics),
       textRuns = List<RitoTextRunOffset>.unmodifiable(textRuns);

  final int pageIndex;
  final double width;
  final double height;
  final List<RitoHitEntry> hits;
  final List<RitoSemanticNode> semantics;
  final String text;
  final int textLength;
  final List<RitoTextRunOffset> textRuns;
}

final class RitoArtifact {
  RitoArtifact({
    required this.protocolVersion,
    required this.capabilityProfileId,
    required this.sessionId,
    required this.requestId,
    required this.revisionId,
    required this.revisionVersion,
    required this.artifactId,
    required this.locator,
    required this.matchedBy,
    required this.localPageIndex,
    required this.localSpreadIndex,
    required List<int> localPageIndexes,
    required this.width,
    required this.height,
    required this.terminalExtent,
    this.bookPageIndex,
    this.bookPageCount,
    required this.navigation,
    required this.textProfile,
    required this.displayList,
    required List<RitoResourceRef> resources,
    required List<RitoFontRef> fonts,
    required List<RitoPage> pages,
  }) : localPageIndexes = List<int>.unmodifiable(localPageIndexes),
       resources = List<RitoResourceRef>.unmodifiable(resources),
       fonts = List<RitoFontRef>.unmodifiable(fonts),
       pages = List<RitoPage>.unmodifiable(pages);

  final int protocolVersion;
  final int capabilityProfileId;
  final int sessionId;
  final int requestId;
  final int revisionId;
  final int revisionVersion;
  final int artifactId;
  final RitoLocator locator;
  final RitoLocatorMatch matchedBy;
  final int localPageIndex;
  final int localSpreadIndex;
  final List<int> localPageIndexes;
  final double width;
  final double height;
  final bool terminalExtent;

  /// Zero-based page number within the whole book. Null until the
  /// whole-book layout backs this artifact (before that, only
  /// [localPageIndex] exists and it is a rollover-window ordinal, not a
  /// page number). Hosts should hide page numbering rather than show 0.
  final int? bookPageIndex;

  /// Total pages in the book, present only once whole-book pagination
  /// is complete. It appears strictly after [bookPageIndex] does, so a
  /// host can render "page N" immediately and cross-fade in "of M".
  final int? bookPageCount;
  final RitoNavigation navigation;
  final RitoTextProfile textProfile;
  final RitoDisplayListPayload displayList;
  final List<RitoResourceRef> resources;
  final List<RitoFontRef> fonts;
  final List<RitoPage> pages;
}
