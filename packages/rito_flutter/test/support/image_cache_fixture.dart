import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:rito_flutter/rito_flutter.dart';
import 'package:rito_flutter/rito_flutter_protocol.dart';

import 'artifact_fixture.dart';

final class TestImageSpec {
  const TestImageSpec({
    required this.code,
    required this.width,
    required this.height,
    this.failDecode = false,
    this.decodedWidth,
    this.decodedHeight,
    this.misdecodeFullSize = false,
  });

  final int code;
  final int width;
  final int height;
  final bool failDecode;

  /// When set, scaled decodes return these dimensions instead of the
  /// requested target — simulating codec rounding. Full-size decodes
  /// stay exact unless [misdecodeFullSize] is also set.
  final int? decodedWidth;
  final int? decodedHeight;
  final bool misdecodeFullSize;
}

final class TestImageDecoder implements RitoImageDecoder {
  TestImageDecoder(Iterable<TestImageSpec> specs)
    : specs = <int, TestImageSpec>{for (final spec in specs) spec.code: spec};

  final Map<int, TestImageSpec> specs;
  final List<int> openedCodes = <int>[];
  final List<int> decodedCodes = <int>[];
  final List<ui.Image> createdImages = <ui.Image>[];
  final Map<int, ({int width, int height})> targets =
      <int, ({int width, int height})>{};
  int disposedSources = 0;

  @override
  Future<RitoImageDecodeSource> open({
    required Uint8List encodedBytes,
    required String mediaType,
  }) async {
    final code = encodedBytes.first;
    final spec = specs[code];
    if (spec == null) {
      throw StateError('Missing test image specification for $code.');
    }
    openedCodes.add(code);
    return _TestImageDecodeSource(this, spec);
  }
}

final class _TestImageDecodeSource implements RitoImageDecodeSource {
  _TestImageDecodeSource(this.owner, this.spec);

  final TestImageDecoder owner;
  final TestImageSpec spec;
  bool _disposed = false;

  @override
  int get width => spec.width;

  @override
  int get height => spec.height;

  @override
  Future<ui.Image> decode({
    required int targetWidth,
    required int targetHeight,
  }) async {
    if (_disposed) {
      throw StateError('Test decode source was disposed.');
    }
    owner.decodedCodes.add(spec.code);
    owner.targets[spec.code] = (width: targetWidth, height: targetHeight);
    if (spec.failDecode) {
      throw StateError('Injected image decode failure.');
    }
    var outWidth = targetWidth;
    var outHeight = targetHeight;
    final fullSize = targetWidth == spec.width && targetHeight == spec.height;
    if (spec.decodedWidth != null && (!fullSize || spec.misdecodeFullSize)) {
      outWidth = spec.decodedWidth!;
      outHeight = spec.decodedHeight!;
    }
    final recorder = ui.PictureRecorder();
    final canvas = ui.Canvas(recorder);
    canvas.drawRect(
      ui.Rect.fromLTWH(0, 0, outWidth.toDouble(), outHeight.toDouble()),
      ui.Paint()..color = const ui.Color(0xff112233),
    );
    final picture = recorder.endRecording();
    try {
      final image = picture.toImageSync(outWidth, outHeight);
      owner.createdImages.add(image);
      return image;
    } finally {
      picture.dispose();
    }
  }

  @override
  void dispose() {
    if (_disposed) {
      return;
    }
    _disposed = true;
    owner.disposedSources += 1;
  }
}

RitoArtifact imageArtifact({
  required int artifactId,
  required List<String> hrefs,
  required List<RitoCommand> commands,
  int sessionId = 91,
  int requestId = 12,
}) {
  final source = const RitoArtifactDecoder().decode(
    artifactFixture(
      sessionId: sessionId,
      requestId: requestId,
      artifactId: artifactId,
      includeFontResource: false,
    ),
  );
  final displayList = RitoDisplayList(formatVersion: 1, commands: commands);
  return RitoArtifact(
    protocolVersion: source.protocolVersion,
    capabilityProfileId: source.capabilityProfileId,
    sessionId: sessionId,
    requestId: requestId,
    revisionId: source.revisionId,
    revisionVersion: source.revisionVersion,
    artifactId: artifactId,
    locator: source.locator,
    matchedBy: source.matchedBy,
    localPageIndex: source.localPageIndex,
    localSpreadIndex: source.localSpreadIndex,
    localPageIndexes: source.localPageIndexes,
    width: source.width,
    height: source.height,
    terminalExtent: source.terminalExtent,
    navigation: source.navigation,
    textProfile: source.textProfile,
    displayList: RitoDisplayListPayload(
      formatVersion: 1,
      commandCount: commands.length,
      semanticDigest: Uint8List(32),
      wireBytes: Uint8List(0),
      displayList: displayList,
    ),
    resources: hrefs
        .map(
          (href) => RitoResourceRef(
            kind: RitoResourceKind.image,
            href: href,
          ),
        )
        .toList(growable: false),
    fonts: const <RitoFontRef>[],
    pages: source.pages,
  );
}

RitoPaintImage directImage(
  String href, {
  double width = 20,
  double height = 20,
}) {
  return RitoPaintImage(
    src: href,
    rect: RitoDisplayRect(x: 0, y: 0, width: width, height: height),
  );
}

RitoPaintBlock coverBackground(
  String href, {
  required double width,
  required double height,
}) {
  return RitoPaintBlock(
    rect: RitoDisplayRect(x: 0, y: 0, width: width, height: height),
    paint: RitoBlockPaint(
      background: RitoBackgroundPaint(
        image: href,
        size: RitoBackgroundSize.cover,
        repeat: RitoBackgroundRepeat.noRepeat,
      ),
      boxShadows: const <RitoBoxShadow>[],
    ),
  );
}

RitoPaintBlock autoBackground(
  String href, {
  required double width,
  required double height,
}) {
  return RitoPaintBlock(
    rect: RitoDisplayRect(x: 0, y: 0, width: width, height: height),
    paint: RitoBlockPaint(
      background: RitoBackgroundPaint(
        image: href,
        size: RitoBackgroundSize.auto,
        repeat: RitoBackgroundRepeat.repeat,
      ),
      boxShadows: const <RitoBoxShadow>[],
    ),
  );
}

RitoResource imageResource({
  required RitoArtifact artifact,
  required RitoResourceRef reference,
  required TestImageSpec spec,
  int? returnedArtifactId,
  String? returnedHref,
  RitoResourceKind? returnedKind,
  int encodedLength = 1,
}) {
  final bytes = Uint8List(encodedLength)..[0] = spec.code;
  return RitoResource(
    artifactId: returnedArtifactId ?? artifact.artifactId,
    kind: returnedKind ?? RitoResourceKind.image,
    href: returnedHref ?? reference.href,
    mediaType: 'image/test',
    bytes: bytes,
    width: spec.width,
    height: spec.height,
  );
}
