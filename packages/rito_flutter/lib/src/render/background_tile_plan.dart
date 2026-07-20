import 'dart:math' as math;

import '../protocol/display_paint.dart';

const int ritoCanvasMaxBackgroundTiles = 4096;

/// A finite, paint-ready background tile grid.
///
/// This is internal adapter policy, not part of Rito's public API. Planning is
/// kept separate from Canvas calls so unsupported workloads fail before a
/// partially painted block can become visible.
final class RitoBackgroundTilePlan {
  const RitoBackgroundTilePlan._({
    required this.left,
    required this.top,
    required this.tileWidth,
    required this.tileHeight,
    required this.stepX,
    required this.stepY,
    required this.columnCount,
    required this.rowCount,
  });

  final double left;
  final double top;
  final double tileWidth;
  final double tileHeight;
  final double stepX;
  final double stepY;
  final int columnCount;
  final int rowCount;

  int get tileCount => columnCount * rowCount;

  double leftAt(int column) => left + stepX * column;

  double topAt(int row) => top + stepY * row;

  static RitoBackgroundTilePlan create({
    required double boxLeft,
    required double boxTop,
    required double boxWidth,
    required double boxHeight,
    required double targetLeft,
    required double targetTop,
    required double targetWidth,
    required double targetHeight,
    required RitoBackgroundRepeat repeat,
    int maxTiles = ritoCanvasMaxBackgroundTiles,
  }) {
    if (boxWidth <= 0 || boxHeight <= 0) {
      throw ArgumentError('Background tile box must have positive dimensions.');
    }
    if (targetWidth <= 0 || targetHeight <= 0) {
      throw ArgumentError('Background tile must have positive dimensions.');
    }
    if (maxTiles <= 0) {
      throw ArgumentError.value(maxTiles, 'maxTiles', 'must be positive');
    }
    final x = _planAxis(
      boxStart: boxLeft,
      boxExtent: boxWidth,
      tileStart: targetLeft,
      tileExtent: targetWidth,
      mode: _axisMode(repeat, horizontal: true),
    );
    final y = _planAxis(
      boxStart: boxTop,
      boxExtent: boxHeight,
      tileStart: targetTop,
      tileExtent: targetHeight,
      mode: _axisMode(repeat, horizontal: false),
    );
    final tileCount = x.count * y.count;
    if (tileCount > maxTiles) {
      throw UnsupportedError(
        'RITODL1 background requires $tileCount Canvas tiles; '
        'the adapter limit is $maxTiles.',
      );
    }
    return RitoBackgroundTilePlan._(
      left: x.start,
      top: y.start,
      tileWidth: x.extent,
      tileHeight: y.extent,
      stepX: x.step,
      stepY: y.step,
      columnCount: x.count,
      rowCount: y.count,
    );
  }
}

enum _AxisMode { noRepeat, repeat, space, round }

final class _AxisPlan {
  const _AxisPlan({
    required this.start,
    required this.extent,
    required this.step,
    required this.count,
  });

  final double start;
  final double extent;
  final double step;
  final int count;
}

_AxisMode _axisMode(RitoBackgroundRepeat repeat, {required bool horizontal}) {
  if (repeat == RitoBackgroundRepeat.noRepeat) {
    return _AxisMode.noRepeat;
  }
  if (repeat == RitoBackgroundRepeat.repeatX) {
    return horizontal ? _AxisMode.repeat : _AxisMode.noRepeat;
  }
  if (repeat == RitoBackgroundRepeat.repeatY) {
    return horizontal ? _AxisMode.noRepeat : _AxisMode.repeat;
  }
  if (repeat == RitoBackgroundRepeat.space) {
    return _AxisMode.space;
  }
  if (repeat == RitoBackgroundRepeat.round) {
    return _AxisMode.round;
  }
  return _AxisMode.repeat;
}

_AxisPlan _planAxis({
  required double boxStart,
  required double boxExtent,
  required double tileStart,
  required double tileExtent,
  required _AxisMode mode,
}) {
  return switch (mode) {
    _AxisMode.noRepeat => _AxisPlan(
      start: tileStart,
      extent: tileExtent,
      step: 0,
      count: 1,
    ),
    _AxisMode.repeat => _repeatAxis(
      boxStart: boxStart,
      boxExtent: boxExtent,
      tileStart: tileStart,
      tileExtent: tileExtent,
    ),
    _AxisMode.space => _spaceAxis(
      boxStart: boxStart,
      boxExtent: boxExtent,
      tileStart: tileStart,
      tileExtent: tileExtent,
    ),
    _AxisMode.round => _roundAxis(
      boxStart: boxStart,
      boxExtent: boxExtent,
      tileExtent: tileExtent,
    ),
  };
}

_AxisPlan _repeatAxis({
  required double boxStart,
  required double boxExtent,
  required double tileStart,
  required double tileExtent,
}) {
  final offset = ((tileStart - boxStart) / tileExtent).ceil();
  final start = tileStart - offset * tileExtent;
  final count = math.max(
    1,
    ((boxStart + boxExtent - start) / tileExtent).ceil(),
  );
  return _AxisPlan(
    start: start,
    extent: tileExtent,
    step: tileExtent,
    count: count,
  );
}

_AxisPlan _spaceAxis({
  required double boxStart,
  required double boxExtent,
  required double tileStart,
  required double tileExtent,
}) {
  final count = (boxExtent / tileExtent).floor();
  if (count < 2) {
    return _AxisPlan(start: tileStart, extent: tileExtent, step: 0, count: 1);
  }
  return _AxisPlan(
    start: boxStart,
    extent: tileExtent,
    step: (boxExtent - tileExtent) / (count - 1),
    count: count,
  );
}

_AxisPlan _roundAxis({
  required double boxStart,
  required double boxExtent,
  required double tileExtent,
}) {
  final count = math.max(1, (boxExtent / tileExtent).round());
  final roundedExtent = boxExtent / count;
  return _AxisPlan(
    start: boxStart,
    extent: roundedExtent,
    step: roundedExtent,
    count: count,
  );
}
