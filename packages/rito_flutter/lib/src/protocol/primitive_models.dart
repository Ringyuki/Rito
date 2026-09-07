import 'display_color.dart';
import 'display_geometry.dart';
import 'display_models.dart';

/// `RITODL1` format version 2: the device-resolved primitive list.
///
/// Every coordinate is a device pixel on the grid the host rasterizes and
/// every rule about where ink lands has been applied by the engine; a
/// renderer blits. Text runs and blocks the engine does not resolve yet
/// pass through with their lengths in device pixels.
final class RitoPrimitiveList {
  RitoPrimitiveList({
    required this.formatVersion,
    required this.ratio,
    required List<RitoPrimitive> commands,
  }) : commands = List<RitoPrimitive>.unmodifiable(commands);

  final int formatVersion;

  /// Device pixels per CSS pixel the list was resolved at.
  final double ratio;
  final List<RitoPrimitive> commands;

  int get commandCount => commands.length;
}

sealed class RitoPrimitive {
  const RitoPrimitive();

  int get opcode;
}

final class RitoPrimitivePushState extends RitoPrimitive {
  const RitoPrimitivePushState();

  @override
  int get opcode => 1;
}

final class RitoPrimitivePopState extends RitoPrimitive {
  const RitoPrimitivePopState();

  @override
  int get opcode => 2;
}

final class RitoPrimitiveTranslate extends RitoPrimitive {
  const RitoPrimitiveTranslate({required this.dx, required this.dy});

  final double dx;
  final double dy;

  @override
  int get opcode => 3;
}

final class RitoPrimitiveOpacity extends RitoPrimitive {
  const RitoPrimitiveOpacity(this.value);

  final double value;

  @override
  int get opcode => 4;
}

final class RitoPrimitiveTransform extends RitoPrimitive {
  RitoPrimitiveTransform({
    required this.origin,
    required List<RitoDeviceTransform> transforms,
  }) : transforms = List<RitoDeviceTransform>.unmodifiable(transforms);

  final RitoDisplayPoint origin;
  final List<RitoDeviceTransform> transforms;

  @override
  int get opcode => 5;
}

final class RitoPrimitiveClipPath extends RitoPrimitive {
  const RitoPrimitiveClipPath(this.path);

  final RitoDevicePath path;

  @override
  int get opcode => 6;
}

final class RitoPrimitiveFillRect extends RitoPrimitive {
  const RitoPrimitiveFillRect({
    required this.rect,
    required this.color,
    required this.ground,
  });

  final RitoDisplayRect rect;
  final RitoColor color;
  final RitoFillGround ground;

  @override
  int get opcode => 7;
}

final class RitoPrimitiveFillPath extends RitoPrimitive {
  const RitoPrimitiveFillPath({
    required this.path,
    required this.rule,
    required this.color,
  });

  final RitoDevicePath path;
  final RitoFillRule rule;
  final RitoColor color;

  @override
  int get opcode => 8;
}

final class RitoPrimitiveStrokePath extends RitoPrimitive {
  const RitoPrimitiveStrokePath({
    required this.path,
    required this.width,
    required this.color,
    required this.cap,
    this.dash,
  });

  final RitoDevicePath path;
  final double width;
  final RitoColor color;
  final RitoStrokeCap cap;
  final RitoDashPattern? dash;

  @override
  int get opcode => 9;
}

/// A canvas-style shadow: [shape] blurred by Gaussian [sigma] (device
/// pixels) and drawn at [offset], then the shape itself on top, both with
/// [clipOut] excluded from the result.
final class RitoPrimitiveShadow extends RitoPrimitive {
  const RitoPrimitiveShadow({
    required this.shape,
    required this.sigma,
    required this.offset,
    required this.color,
    this.clipOut,
  });

  final RitoDevicePath shape;
  final double sigma;
  final RitoDisplayPoint offset;
  final RitoColor color;
  final RitoDevicePath? clipOut;

  @override
  int get opcode => 10;
}

/// [src] sampled over [sourceRect] (raster pixels; the whole raster when
/// null) into [dest], once or per [tiles].
final class RitoPrimitiveDrawImage extends RitoPrimitive {
  const RitoPrimitiveDrawImage({
    required this.src,
    required this.dest,
    this.sourceRect,
    this.tiles,
  });

  final String src;
  final RitoDisplayRect dest;
  final RitoDisplayRect? sourceRect;
  final RitoTilePlan? tiles;

  @override
  int get opcode => 11;
}

/// A text run with every length in device pixels; glyph placement is
/// still the renderer's.
final class RitoPrimitiveText extends RitoPrimitive {
  const RitoPrimitiveText(this.command);

  final RitoPaintText command;

  @override
  int get opcode => 12;
}

final class RitoPrimitiveRuby extends RitoPrimitive {
  const RitoPrimitiveRuby(this.command);

  final RitoPaintRuby command;

  @override
  int get opcode => 13;
}

/// A block whose paint the engine does not resolve yet (rounded corners,
/// box shadows, background images), lengths in device pixels.
final class RitoPrimitiveBlock extends RitoPrimitive {
  const RitoPrimitiveBlock(this.command);

  final RitoPaintBlock command;

  @override
  int get opcode => 14;
}

/// A device-space outline. Arc angles are radians from the +x axis; a
/// positive sweep turns clockwise on the y-down device plane. An ellipse
/// is its own closed subpath.
final class RitoDevicePath {
  RitoDevicePath(List<RitoPathOp> ops)
    : ops = List<RitoPathOp>.unmodifiable(ops);

  final List<RitoPathOp> ops;
}

sealed class RitoPathOp {
  const RitoPathOp();
}

final class RitoPathMoveTo extends RitoPathOp {
  const RitoPathMoveTo({required this.x, required this.y});

  final double x;
  final double y;
}

final class RitoPathLineTo extends RitoPathOp {
  const RitoPathLineTo({required this.x, required this.y});

  final double x;
  final double y;
}

final class RitoPathArc extends RitoPathOp {
  const RitoPathArc({
    required this.cx,
    required this.cy,
    required this.rx,
    required this.ry,
    required this.start,
    required this.sweep,
  });

  final double cx;
  final double cy;
  final double rx;
  final double ry;
  final double start;
  final double sweep;
}

final class RitoPathEllipse extends RitoPathOp {
  const RitoPathEllipse({
    required this.cx,
    required this.cy,
    required this.rx,
    required this.ry,
  });

  final double cx;
  final double cy;
  final double rx;
  final double ry;
}

final class RitoPathRect extends RitoPathOp {
  const RitoPathRect(this.rect);

  final RitoDisplayRect rect;
}

final class RitoPathClose extends RitoPathOp {
  const RitoPathClose();
}

final class RitoFillRule {
  const RitoFillRule._(this.name);

  final String name;

  static const RitoFillRule nonZero = RitoFillRule._('nonzero');
  static const RitoFillRule evenOdd = RitoFillRule._('evenodd');
}

final class RitoStrokeCap {
  const RitoStrokeCap._(this.name);

  final String name;

  static const RitoStrokeCap butt = RitoStrokeCap._('butt');
  static const RitoStrokeCap round = RitoStrokeCap._('round');
}

/// What a fill declares to the theme override: the page ground, an opaque
/// block ground the ink over it was typeset against, or nothing.
final class RitoFillGround {
  const RitoFillGround._(this.name);

  final String name;

  static const RitoFillGround none = RitoFillGround._('none');
  static const RitoFillGround page = RitoFillGround._('page');
  static const RitoFillGround block = RitoFillGround._('block');
}

final class RitoDashPattern {
  const RitoDashPattern({required this.on, required this.off});

  final double on;
  final double off;
}

/// A grid of image tiles: [columns] by [rows] copies of the destination,
/// stepping [stepX]/[stepY] from [origin].
final class RitoTilePlan {
  const RitoTilePlan({
    required this.origin,
    required this.stepX,
    required this.stepY,
    required this.columns,
    required this.rows,
  });

  final RitoDisplayPoint origin;
  final double stepX;
  final double stepY;
  final int columns;
  final int rows;
}

sealed class RitoDeviceTransform {
  const RitoDeviceTransform();
}

final class RitoDeviceRotate extends RitoDeviceTransform {
  const RitoDeviceRotate(this.radians);

  final double radians;
}

final class RitoDeviceScale extends RitoDeviceTransform {
  const RitoDeviceScale({required this.sx, required this.sy});

  final double sx;
  final double sy;
}

final class RitoDeviceTranslate extends RitoDeviceTransform {
  const RitoDeviceTranslate({required this.dx, required this.dy});

  final double dx;
  final double dy;
}
