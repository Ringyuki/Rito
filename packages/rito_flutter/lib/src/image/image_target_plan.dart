part of 'artifact_image_cache.dart';

final class _ImageDecodeDimensions {
  const _ImageDecodeDimensions({required this.width, required this.height});

  final int width;
  final int height;

  int get pixels => width * height;
}

/// Image paint requirements collected from one immutable display list.
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

  static _ImageTargetPlan collect(
    RitoArtifact artifact, {
    required double pixelRatio,
  }) {
    if (!pixelRatio.isFinite || pixelRatio <= 0) {
      throw ArgumentError.value(pixelRatio, 'pixelRatio', 'must be positive');
    }
    final collector = _RitoImageTargetCollector(pixelRatio);
    collector.collect(artifact.displayList.displayList);
    return _ImageTargetPlan._(collector.usesByHref);
  }
}

final class _RitoImageTargetCollector {
  _RitoImageTargetCollector(this.pixelRatio);

  final double pixelRatio;
  final Map<String, List<_RitoImageUse>> usesByHref =
      <String, List<_RitoImageUse>>{};
  final List<_RitoLinearTransform> _stack = <_RitoLinearTransform>[
    const _RitoLinearTransform.identity(),
  ];

  _RitoLinearTransform get _transform => _stack.last;

  void collect(RitoDisplayList displayList) {
    for (final command in displayList.commands) {
      switch (command) {
        case RitoPushState():
          _stack.add(_transform);
        case RitoPopState():
          if (_stack.length == 1) {
            throw const FormatException('Display list restore is unbalanced.');
          }
          _stack.removeLast();
        case RitoTranslate(:final dx, :final dy):
          _requireFinite(dx, 'translation x');
          _requireFinite(dy, 'translation y');
        case RitoTransform():
          _applyTransform(command);
        case RitoPaintImage():
          _addDirect(command.src, command.rect);
        case RitoPaintBlock():
          _addBackground(command);
        default:
          break;
      }
    }
    if (_stack.length != 1) {
      throw const FormatException('Display list save is unbalanced.');
    }
  }

  void _applyTransform(RitoTransform command) {
    _requireFinite(command.origin.x, 'transform origin x');
    _requireFinite(command.origin.y, 'transform origin y');
    _requireFinite(command.boxSize.width, 'transform box width');
    _requireFinite(command.boxSize.height, 'transform box height');
    var next = _transform;
    for (final operation in command.transforms) {
      switch (operation) {
        case RitoRotateTransform(:final radians):
          _requireFinite(radians, 'rotation');
          next = next.rotate(radians);
        case RitoScaleTransform(:final sx, :final sy):
          _requireFinite(sx, 'scale x');
          _requireFinite(sy, 'scale y');
          next = next.scale(sx, sy);
        case RitoTranslateTransform(:final x, :final y):
          _validateLength(x, command.boxSize.width);
          _validateLength(y, command.boxSize.height);
      }
    }
    _stack[_stack.length - 1] = next;
  }

  void _addDirect(String href, RitoDisplayRect rect) {
    _requireHref(href);
    _requireRect(rect, href);
    _add(
      href,
      _RitoDirectImageUse(
        targetWidth: rect.width * _transform.xScale * pixelRatio,
        targetHeight: rect.height * _transform.yScale * pixelRatio,
      ),
    );
  }

  void _addBackground(RitoPaintBlock command) {
    final background = command.paint.background;
    final href = background?.image;
    if (background == null || href == null) {
      return;
    }
    _requireHref(href);
    _requireRect(command.rect, href);
    _add(
      href,
      _RitoBackgroundImageUse(
        boxWidth: command.rect.width,
        boxHeight: command.rect.height,
        physicalScaleX: _transform.xScale * pixelRatio,
        physicalScaleY: _transform.yScale * pixelRatio,
        size: background.size ?? RitoBackgroundSize.auto,
        repeat: background.repeat ?? RitoBackgroundRepeat.repeat,
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

  void _validateLength(RitoLength length, double basis) {
    _requireFinite(length.value, 'transform translation');
    _requireFinite(basis, 'transform translation basis');
  }

  void _requireFinite(double value, String field) {
    if (!value.isFinite) {
      throw FormatException('Display list $field is not finite.');
    }
  }
}

sealed class _RitoImageUse {
  const _RitoImageUse();

  double decodeScale(int sourceWidth, int sourceHeight);
}

final class _RitoDirectImageUse extends _RitoImageUse {
  const _RitoDirectImageUse({
    required this.targetWidth,
    required this.targetHeight,
  });

  final double targetWidth;
  final double targetHeight;

  @override
  double decodeScale(int sourceWidth, int sourceHeight) {
    // drawImageRect may stretch either axis. Preserve source aspect ratio while
    // retaining enough decoded samples for the more demanding destination axis.
    return math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  }
}

final class _RitoBackgroundImageUse extends _RitoImageUse {
  const _RitoBackgroundImageUse({
    required this.boxWidth,
    required this.boxHeight,
    required this.physicalScaleX,
    required this.physicalScaleY,
    required this.size,
    required this.repeat,
  });

  final double boxWidth;
  final double boxHeight;
  final double physicalScaleX;
  final double physicalScaleY;
  final RitoBackgroundSize size;
  final RitoBackgroundRepeat repeat;

  @override
  double decodeScale(int sourceWidth, int sourceHeight) {
    if (size == RitoBackgroundSize.auto) {
      // Flutter paints the decoded image's dimensions as the CSS intrinsic
      // tile size. Downsampling here would change background geometry, not
      // merely raster quality, so auto must retain the source dimensions.
      return 1;
    }
    var width = sourceWidth.toDouble();
    var height = sourceHeight.toDouble();
    final widthScale = boxWidth / sourceWidth;
    final heightScale = boxHeight / sourceHeight;
    final cssScale = size == RitoBackgroundSize.cover
        ? math.max(widthScale, heightScale)
        : math.min(widthScale, heightScale);
    width *= cssScale;
    height *= cssScale;
    if (repeat == RitoBackgroundRepeat.round) {
      width = boxWidth / math.max(1, (boxWidth / width).round());
      height = boxHeight / math.max(1, (boxHeight / height).round());
    }
    // Non-uniform transforms may stretch one tile axis more than the other.
    // The decode remains aspect preserving, so cover the larger sampling need.
    return math.max(
      width * physicalScaleX / sourceWidth,
      height * physicalScaleY / sourceHeight,
    );
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
