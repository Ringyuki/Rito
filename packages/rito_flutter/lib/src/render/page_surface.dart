import 'package:flutter/widgets.dart';

import '../font/artifact_font_cache.dart';
import '../protocol/artifact_models.dart' show RitoTextProfile;
import 'canvas_target.dart';
import 'color_override.dart';
import 'font_envelope.dart';
import 'replayer.dart';
import 'resources.dart';

export 'color_override.dart' show RitoCanvasColorOverride;
export 'resources.dart' show RitoImageResolver;

final class RitoPageSurface extends StatelessWidget {
  const RitoPageSurface({
    required this.artifact,
    this.resolveImage,
    this.colorOverride,
    super.key,
  });

  final RitoPreparedArtifact artifact;
  final RitoImageResolver? resolveImage;

  /// Optional host theme (dark/sepia). See [RitoCanvasColorOverride].
  final RitoCanvasColorOverride? colorOverride;

  @override
  Widget build(BuildContext context) {
    return RepaintBoundary(
      child: CustomPaint(
        size: Size(artifact.artifact.width, artifact.artifact.height),
        isComplex: true,
        willChange: false,
        painter: RitoArtifactPainter(
          artifact: artifact,
          resolveImage: resolveImage ?? artifact.resolveImage,
          colorOverride: colorOverride,
        ),
      ),
    );
  }
}

final class RitoArtifactPainter extends CustomPainter {
  const RitoArtifactPainter({
    required this.artifact,
    required this.resolveImage,
    this.colorOverride,
  });

  final RitoPreparedArtifact artifact;
  final RitoImageResolver resolveImage;
  final RitoCanvasColorOverride? colorOverride;

  @override
  void paint(Canvas canvas, Size size) {
    final value = artifact.artifact;
    if (value.textProfile != RitoTextProfile.platformStringRuns) {
      throw UnsupportedError('Positioned glyph runs are not available in v1.');
    }
    final target = RitoCanvasPaintTarget(
      canvas,
      resolveImage: resolveImage,
      fontEnvelopes: RitoFontEnvelopeStore.shared,
      colorOverride: colorOverride,
    )..preflightPaintCapabilities(value.displayList.displayList);
    canvas.save();
    try {
      const RitoDisplayListReplayer().replay(
        value.displayList.displayList,
        target,
      );
    } finally {
      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(covariant RitoArtifactPainter oldDelegate) {
    return artifact.sessionId != oldDelegate.artifact.sessionId ||
        artifact.artifactId != oldDelegate.artifact.artifactId ||
        colorOverride?.foreground != oldDelegate.colorOverride?.foreground ||
        colorOverride?.background != oldDelegate.colorOverride?.background;
  }

  @override
  bool shouldRebuildSemantics(covariant RitoArtifactPainter oldDelegate) {
    return shouldRepaint(oldDelegate);
  }
}
