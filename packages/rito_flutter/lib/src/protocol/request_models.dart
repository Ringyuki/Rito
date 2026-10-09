import 'artifact_models.dart';

enum RitoSpreadMode { single, double }

final class RitoLayoutRequest {
  const RitoLayoutRequest({
    required this.viewportWidth,
    required this.viewportHeight,
    required this.marginTop,
    required this.marginRight,
    required this.marginBottom,
    required this.marginLeft,
    required this.spreadMode,
    required this.firstPageAlone,
    required this.spreadGap,
    required this.rootFontSize,
    this.lineHeightOverride,
    this.fontFamilyOverride,
    this.renderRatio,
  });

  final double viewportWidth;
  final double viewportHeight;
  final double marginTop;
  final double marginRight;
  final double marginBottom;
  final double marginLeft;
  final RitoSpreadMode spreadMode;
  final bool firstPageAlone;
  final double spreadGap;
  final double rootFontSize;

  /// Reader line-height, applied as a UA `line-height: <value>
  /// !important` over the whole publication. It is a **unitless CSS
  /// scale relative to font size** — 1.5 means 1.5x, not 1.5px — so it
  /// is the "line height scale" a reader setting exposes. Null leaves
  /// the book's own line heights alone.
  final double? lineHeightOverride;

  /// Device pixels per CSS pixel the artifact is rasterized at. Every
  /// raster snap in the display list lands on that grid; pagination is
  /// identical at every ratio. Null means the session's pixel ratio
  /// (`RitoReaderSession.open`'s `imagePixelRatio`), which is what a
  /// host painting 1:1 on its device wants.
  final double? renderRatio;

  /// This layout at [renderRatio].
  RitoLayoutRequest withRenderRatio(double renderRatio) => RitoLayoutRequest(
    viewportWidth: viewportWidth,
    viewportHeight: viewportHeight,
    marginTop: marginTop,
    marginRight: marginRight,
    marginBottom: marginBottom,
    marginLeft: marginLeft,
    spreadMode: spreadMode,
    firstPageAlone: firstPageAlone,
    spreadGap: spreadGap,
    rootFontSize: rootFontSize,
    lineHeightOverride: lineHeightOverride,
    fontFamilyOverride: fontFamilyOverride,
    renderRatio: renderRatio,
  );

  /// Reader font family, applied as `font-family: <list> !important` over
  /// the whole publication, so it replaces the book's own families rather
  /// than sitting behind them. The value is a **CSS font-family list**:
  /// `'Noto Serif JP, serif'` is valid and preferred.
  ///
  /// Each name resolves like a browser resolves it against installed
  /// fonts: to the publication's `@font-face` family of that name, else to
  /// the host face of that name (the session's pinned faces and those
  /// added with [RitoReaderSession.addFontFaces]). A generic resolves to
  /// the host faces of its role. A name nothing answers to is skipped —
  /// check a reader's choice with [RitoReaderSession.unresolvedFontFamilies]
  /// and build choices from [RitoReaderSession.fontCatalog].
  final String? fontFamilyOverride;
}

final class RitoAdjacentDirection {
  const RitoAdjacentDirection._(this.name);

  final String name;

  static const RitoAdjacentDirection previous = RitoAdjacentDirection._(
    'previous',
  );
  static const RitoAdjacentDirection next = RitoAdjacentDirection._('next');
}

final class RitoAdjacentRequest {
  const RitoAdjacentRequest({
    required this.sessionId,
    required this.requestId,
    required this.fromArtifactId,
    required this.direction,
  });

  final int sessionId;
  final int requestId;
  final int fromArtifactId;
  final RitoAdjacentDirection direction;
}

/// One spread of the revision behind an artifact, addressed by its
/// position in that revision's layout.
final class RitoSpreadRequest {
  const RitoSpreadRequest({
    required this.sessionId,
    required this.requestId,
    required this.fromArtifactId,
    required this.spreadIndex,
  });

  final int sessionId;
  final int requestId;
  final int fromArtifactId;
  final int spreadIndex;
}

final class RitoArtifactRequest {
  const RitoArtifactRequest({
    required this.sessionId,
    required this.requestId,
    required this.layout,
    required this.locator,
    this.textProfile = RitoTextProfile.platformStringRuns,
  });

  final int sessionId;
  final int requestId;
  final RitoLayoutRequest layout;
  final RitoLocator locator;
  final RitoTextProfile textProfile;

  /// This request with [layout] in place of its own.
  RitoArtifactRequest withLayout(RitoLayoutRequest layout) =>
      RitoArtifactRequest(
        sessionId: sessionId,
        requestId: requestId,
        layout: layout,
        locator: locator,
        textProfile: textProfile,
      );

  /// This request under [requestId] in place of its own.
  RitoArtifactRequest withRequestId(int requestId) => RitoArtifactRequest(
    sessionId: sessionId,
    requestId: requestId,
    layout: layout,
    locator: locator,
    textProfile: textProfile,
  );
}
