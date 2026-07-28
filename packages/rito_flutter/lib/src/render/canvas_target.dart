import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/painting.dart';

import '../protocol/display_color.dart';
import '../protocol/display_geometry.dart';
import '../protocol/display_models.dart';
import '../protocol/display_paint.dart';
import '../protocol/wire_exception.dart';
import 'background_tile_plan.dart';
import 'canvas_paint_math.dart';
import 'font_envelope.dart';
import 'replayer.dart';
import 'resources.dart';
import 'typed_color.dart';

part 'canvas_target_blocks.dart';
part 'canvas_target_capabilities.dart';
part 'canvas_target_text.dart';

/// Paints the frozen RITODL1 profile onto Flutter Canvas.
///
/// The adapter fails closed for inset box shadows, `groove`/`ridge`/
/// `inset`/`outset` borders, and background grids above
/// [ritoCanvasMaxBackgroundTiles]. Those cases must not be approximated by a
/// different CSS effect.
final class RitoCanvasPaintTarget implements RitoPaintTarget {
  RitoCanvasPaintTarget(
    this._canvas, {
    required RitoImageResolver resolveImage,
    RitoFontEnvelopeStore? fontEnvelopes,
  }) : _resolveImage = resolveImage,
       _fontEnvelopes = fontEnvelopes;

  final ui.Canvas _canvas;
  final RitoImageResolver _resolveImage;
  final RitoFontEnvelopeStore? _fontEnvelopes;
  final List<double> _opacityStack = <double>[1];
  final Map<RitoPaintBlock, _PreparedBlockPaint> _preparedBlocks =
      <RitoPaintBlock, _PreparedBlockPaint>{};
  final Map<String, ui.Image?> _preparedImages = <String, ui.Image?>{};

  double get _opacity => _opacityStack.last;

  /// Validates Canvas paint capabilities across the complete list before
  /// replay can leave a partially painted page. Paint-ready block preparation
  /// is retained for replay.
  void preflightPaintCapabilities(RitoDisplayList displayList) {
    for (final command in displayList.commands) {
      switch (command) {
        case RitoPaintBlock():
          _preparedBlocks[command] = _prepareBlockPaint(
            command,
            _rect(command.rect),
          );
        case RitoPaintText():
          _validateRunPaint(command.paint);
        case RitoPaintRuby():
          _validateRunPaint(command.paint);
        case RitoPaintHorizontalRule():
          _validateHorizontalRulePaint(command);
        case RitoPaintImage(:final src):
          _preparedImages.putIfAbsent(src, () => _resolveImage(src));
        default:
          break;
      }
    }
  }

  @override
  void save() {
    _canvas.save();
    _opacityStack.add(_opacity);
  }

  @override
  void restore() {
    if (_opacityStack.length == 1) {
      throw const RitoWireException('restore has no matching save');
    }
    _canvas.restore();
    _opacityStack.removeLast();
  }

  @override
  void translate(RitoTranslate command) {
    _canvas.translate(command.dx, command.dy);
  }

  @override
  void opacity(RitoOpacity command) {
    if (command.value < 0 || command.value > 1) {
      throw const RitoWireException('opacity must be between zero and one');
    }
    _opacityStack[_opacityStack.length - 1] = _opacity * command.value;
  }

  @override
  void transform(RitoTransform command) {
    _canvas.translate(command.origin.x, command.origin.y);
    for (final transform in command.transforms) {
      _applyTransform(transform, command.boxSize);
    }
    _canvas.translate(-command.origin.x, -command.origin.y);
  }

  @override
  void clipRect(RitoClipRect command) {
    final rect = _rect(command.rect);
    final radius = command.radius;
    if (radius == null) {
      _canvas.clipRect(rect);
    } else {
      _canvas.clipRRect(ui.RRect.fromRectXY(rect, radius.rx, radius.ry));
    }
  }

  @override
  void paintPage(RitoPaintPage command) => _paintPage(command);

  @override
  void paintBlock(RitoPaintBlock command) => _paintBlock(command);

  @override
  void paintText(RitoPaintText command) => _paintText(command);

  @override
  void paintRuby(RitoPaintRuby command) => _paintRuby(command);

  @override
  void paintImage(RitoPaintImage command) {
    final image = _preparedImages.containsKey(command.src)
        ? _preparedImages[command.src]
        : _resolveImage(command.src);
    if (image == null) {
      return;
    }
    final source = ui.Rect.fromLTWH(
      0,
      0,
      image.width.toDouble(),
      image.height.toDouble(),
    );
    _canvas.drawImageRect(image, source, _rect(command.rect), _imagePaint());
  }

  @override
  void paintHorizontalRule(RitoPaintHorizontalRule command) {
    final rect = _rect(command.rect);
    _validateHorizontalRulePaint(command);
    final y = rect.top + rect.height / 2;
    _strokeStyledLine(
      ui.Offset(rect.left, y),
      ui.Offset(rect.right, y),
      rect.height,
      command.paint.color,
      command.paint.style,
    );
  }

  void _applyTransform(
    RitoTransformOperation transform,
    RitoDisplaySize boxSize,
  ) {
    switch (transform) {
      case RitoRotateTransform(:final radians):
        _canvas.rotate(radians);
      case RitoScaleTransform(:final sx, :final sy):
        _canvas.scale(sx, sy);
      case RitoTranslateTransform(:final x, :final y):
        _canvas.translate(
          _resolveLength(x, boxSize.width),
          _resolveLength(y, boxSize.height),
        );
    }
  }

  double _resolveLength(RitoLength length, double basis) {
    return switch (length) {
      RitoPxLength(:final value) => value,
      RitoPercentLength(:final value) => value * basis / 100,
    };
  }

  ui.Rect _rect(RitoDisplayRect rect) {
    return ui.Rect.fromLTWH(rect.x, rect.y, rect.width, rect.height);
  }

  ui.Color _color(RitoColor source) {
    final color = ritoUiColor(source);
    return color.withValues(alpha: color.a * _opacity);
  }

  ui.Paint _imagePaint() {
    return ui.Paint()
      ..filterQuality = ui.FilterQuality.medium
      ..color = const ui.Color(0xffffffff).withValues(alpha: _opacity);
  }
}
