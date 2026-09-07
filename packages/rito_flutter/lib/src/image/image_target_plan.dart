part of 'artifact_image_cache.dart';

final class _ImageDecodeDimensions {
  const _ImageDecodeDimensions({required this.width, required this.height});

  final int width;
  final int height;

  int get pixels => width * height;
}

/// The decode target every image in a primitive list needs: each draw
/// names the device rect it lands in (a tiled draw, its tile), so the
/// scale a bitmap is decoded at follows from that rect and the device
/// transforms in force — no pixel ratio applies, the list is already on
/// the device grid.
final class _ImageTargetPlan {
  _ImageTargetPlan._(this._usesByHref);

  final Map<String, List<_RitoImageUse>> _usesByHref;

  Iterable<String> get hrefs => _usesByHref.keys;

  _ImageDecodeDimensions targetFor({
    required String href,
    required int sourceWidth,
    required int sourceHeight,
    required int bucketSize,
  }) {
    final uses = _usesByHref[href];
    if (uses == null || uses.isEmpty) {
      throw StateError('Image is not required by this display list: $href');
    }
    var scale = 0.0;
    for (final use in uses) {
      scale = math.max(scale, use.decodeScale(sourceWidth, sourceHeight));
    }
    if (!scale.isFinite || scale <= 0) {
      throw FormatException('Image $href has an invalid paint target.');
    }
    final boundedScale = math.min(1.0, scale);
    final sourceDominant = math.max(sourceWidth, sourceHeight);
    final requestedDominant = sourceDominant * boundedScale;
    final bucketedDominant = math.min(
      sourceDominant,
      (requestedDominant / bucketSize).ceil() * bucketSize,
    );
    final bucketedScale = bucketedDominant / sourceDominant;
    return _ImageDecodeDimensions(
      width: math.max(1, (sourceWidth * bucketedScale).round()),
      height: math.max(1, (sourceHeight * bucketedScale).round()),
    );
  }

  static _ImageTargetPlan collect(RitoArtifact artifact) {
    final collector = _RitoImageTargetCollector();
    collector.collect(artifact.displayList.displayList);
    return _ImageTargetPlan._(collector.usesByHref);
  }
}

final class _RitoImageTargetCollector {
  final Map<String, List<_RitoImageUse>> usesByHref =
      <String, List<_RitoImageUse>>{};
  final List<_RitoLinearTransform> _stack = <_RitoLinearTransform>[
    const _RitoLinearTransform.identity(),
  ];

  _RitoLinearTransform get _transform => _stack.last;

  void collect(RitoPrimitiveList list) {
    for (final primitive in list.commands) {
      switch (primitive) {
        case RitoPrimitivePushState():
          _stack.add(_transform);
        case RitoPrimitivePopState():
          if (_stack.length == 1) {
            throw const FormatException('Display list restore is unbalanced.');
          }
          _stack.removeLast();
        case RitoPrimitiveTranslate(:final dx, :final dy):
          _requireFinite(dx, 'translation x');
          _requireFinite(dy, 'translation y');
        case RitoPrimitiveTransform():
          _applyTransform(primitive);
        case RitoPrimitiveDrawImage():
          _addDraw(primitive.src, primitive.dest);
        default:
          break;
      }
    }
    if (_stack.length != 1) {
      throw const FormatException('Display list save is unbalanced.');
    }
  }

  void _applyTransform(RitoPrimitiveTransform primitive) {
    _requireFinite(primitive.origin.x, 'transform origin x');
    _requireFinite(primitive.origin.y, 'transform origin y');
    var next = _transform;
    for (final operation in primitive.transforms) {
      switch (operation) {
        case RitoDeviceRotate(:final radians):
          _requireFinite(radians, 'rotation');
          next = next.rotate(radians);
        case RitoDeviceScale(:final sx, :final sy):
          _requireFinite(sx, 'scale x');
          _requireFinite(sy, 'scale y');
          next = next.scale(sx, sy);
        case RitoDeviceTranslate(:final dx, :final dy):
          _requireFinite(dx, 'transform translation x');
          _requireFinite(dy, 'transform translation y');
      }
    }
    _stack[_stack.length - 1] = next;
  }

  void _addDraw(String href, RitoDisplayRect dest) {
    _requireHref(href);
    _requireRect(dest, href);
    _add(
      href,
      _RitoImageUse(
        targetWidth: dest.width * _transform.xScale,
        targetHeight: dest.height * _transform.yScale,
      ),
    );
  }

  void _add(String href, _RitoImageUse use) {
    usesByHref.putIfAbsent(href, () => <_RitoImageUse>[]).add(use);
  }

  void _requireHref(String href) {
    if (href.isEmpty) {
      throw const FormatException('Display list image href is empty.');
    }
  }

  void _requireRect(RitoDisplayRect rect, String href) {
    for (final value in <double>[rect.x, rect.y, rect.width, rect.height]) {
      _requireFinite(value, 'image rectangle for $href');
    }
    if (rect.width <= 0 || rect.height <= 0) {
      throw FormatException('Image $href has an empty paint rectangle.');
    }
  }

  void _requireFinite(double value, String field) {
    if (!value.isFinite) {
      throw FormatException('Display list $field is not finite.');
    }
  }
}

final class _RitoImageUse {
  const _RitoImageUse({required this.targetWidth, required this.targetHeight});

  final double targetWidth;
  final double targetHeight;

  double decodeScale(int sourceWidth, int sourceHeight) {
    // drawImageRect may stretch either axis. Preserve source aspect ratio
    // while retaining enough decoded samples for the more demanding
    // destination axis.
    return math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  }
}

final class _RitoLinearTransform {
  const _RitoLinearTransform(this.a, this.b, this.c, this.d);

  const _RitoLinearTransform.identity() : this(1, 0, 0, 1);

  final double a;
  final double b;
  final double c;
  final double d;

  double get xScale => math.sqrt(a * a + b * b);
  double get yScale => math.sqrt(c * c + d * d);

  _RitoLinearTransform scale(double sx, double sy) {
    return _RitoLinearTransform(a * sx, b * sx, c * sy, d * sy);
  }

  _RitoLinearTransform rotate(double radians) {
    final cosine = math.cos(radians);
    final sine = math.sin(radians);
    return _RitoLinearTransform(
      a * cosine + c * sine,
      b * cosine + d * sine,
      -a * sine + c * cosine,
      -b * sine + d * cosine,
    );
  }
}
