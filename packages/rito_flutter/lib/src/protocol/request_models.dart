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

  /// Reader font family, applied as a UA `font-family: <list>
  /// !important` over the whole publication, so it replaces the book's
  /// own families rather than sitting behind them. The value is a
  /// **CSS font-family list**, not one name: `'Noto Serif JP, serif'`
  /// is valid and preferred, because the generic tail is what the
  /// pinned faces attach to.
  ///
  /// This is orthogonal to the pinned font policy passed to
  /// [RitoReaderSession.open], and does not override it: the override
  /// decides *which families are requested*, the policy supplies *the
  /// bytes those families resolve to*. A family the override names is
  /// used when the publication embeds it or the host registered it;
  /// otherwise resolution falls through the list to the generic tail
  /// (`serif` / `sans-serif` / `monospace`), which is exactly what the
  /// pinned policy backs. Naming a family nothing can supply therefore
  /// degrades to the pinned generic face rather than failing.
  final String? fontFamilyOverride;
}

final class RitoWorkBudget {
  const RitoWorkBudget({
    required this.maxTopLevelNodesPerQuantum,
    required this.maxForegroundQuanta,
    required this.localPageCap,
  });

  final int maxTopLevelNodesPerQuantum;
  final int maxForegroundQuanta;
  final int localPageCap;
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
    required this.work,
  });

  final int sessionId;
  final int requestId;
  final int fromArtifactId;
  final RitoAdjacentDirection direction;
  final RitoWorkBudget work;
}

final class RitoArtifactRequest {
  const RitoArtifactRequest({
    required this.sessionId,
    required this.requestId,
    required this.layout,
    required this.locator,
    required this.work,
    this.textProfile = RitoTextProfile.platformStringRuns,
  });

  final int sessionId;
  final int requestId;
  final RitoLayoutRequest layout;
  final RitoLocator locator;
  final RitoWorkBudget work;
  final RitoTextProfile textProfile;
}
