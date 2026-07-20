import 'package:flutter/widgets.dart';

import '../font/artifact_font_cache.dart';
import '../protocol/artifact_models.dart' show RitoTextProfile;
import 'canvas_target.dart';
import 'replayer.dart';
import 'resources.dart';

export 'resources.dart' show RitoImageResolver;

final class RitoPageSurface extends StatelessWidget {
  const RitoPageSurface({
    required this.artifact,
    this.resolveImage,
    super.key,
  });

  final RitoPreparedArtifact artifact;
  final RitoImageResolver? resolveImage;

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
        ),
      ),
    );
  }
}

final class RitoArtifactPainter extends CustomPainter {
  const RitoArtifactPainter({
    required this.artifact,
    required this.resolveImage,
  });

  final RitoPreparedArtifact artifact;
  final RitoImageResolver resolveImage;

  @override
  void paint(Canvas canvas, Size size) {
    final value = artifact.artifact;
    if (value.textProfile != RitoTextProfile.platformStringRuns) {
      throw UnsupportedError('Positioned glyph runs are not available in v1.');
    }
    final target = RitoCanvasPaintTarget(canvas, resolveImage: resolveImage)
      ..preflightPaintCapabilities(value.displayList.displayList);
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
        artifact.artifactId != oldDelegate.artifact.artifactId;
  }

  @override
  bool shouldRebuildSemantics(covariant RitoArtifactPainter oldDelegate) {
    return shouldRepaint(oldDelegate);
  }
}
