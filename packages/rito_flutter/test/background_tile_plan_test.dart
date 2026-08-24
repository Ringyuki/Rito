import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter_protocol.dart';
import 'package:rito_flutter/src/render/background_tile_plan.dart';

void main() {
  test('space distributes whole tiles against both box edges', () {
    final plan = _plan(
      boxWidth: 10,
      boxHeight: 8,
      targetLeft: 2,
      targetTop: 1,
      targetWidth: 3,
      targetHeight: 3,
      repeat: RitoBackgroundRepeat.space,
    );

    expect(plan.columnCount, 3);
    expect(plan.rowCount, 2);
    expect(plan.left, 0);
    expect(plan.top, 0);
    expect(plan.stepX, 3.5);
    expect(plan.stepY, 5);
    expect(plan.leftAt(2), 7);
    expect(plan.topAt(1), 5);
  });

  test('space keeps background-position when fewer than two tiles fit', () {
    final plan = _plan(
      boxWidth: 2,
      boxHeight: 2,
      targetLeft: .5,
      targetTop: .25,
      targetWidth: 3,
      targetHeight: 4,
      repeat: RitoBackgroundRepeat.space,
    );

    expect(plan.columnCount, 1);
    expect(plan.rowCount, 1);
    expect(plan.left, .5);
    expect(plan.top, .25);
  });

  test('round resizes an integer tile count to exactly fill both axes', () {
    final plan = _plan(
      boxWidth: 10,
      boxHeight: 8,
      targetLeft: 2,
      targetTop: 1,
      targetWidth: 3,
      targetHeight: 3,
      repeat: RitoBackgroundRepeat.round,
    );

    expect(plan.columnCount, 3);
    expect(plan.rowCount, 3);
    expect(plan.tileWidth, closeTo(10 / 3, 1e-12));
    expect(plan.tileHeight, closeTo(8 / 3, 1e-12));
    expect(
      plan.leftAt(plan.columnCount - 1) + plan.tileWidth,
      closeTo(10, 1e-12),
    );
    expect(plan.topAt(plan.rowCount - 1) + plan.tileHeight, closeTo(8, 1e-12));
  });

  test('repeat-x repeats only the horizontal axis from positioned origin', () {
    final plan = _plan(
      boxWidth: 10,
      boxHeight: 8,
      targetLeft: 2,
      targetTop: 1,
      targetWidth: 3,
      targetHeight: 3,
      repeat: RitoBackgroundRepeat.repeatX,
    );

    expect(plan.columnCount, 4);
    expect(plan.rowCount, 1);
    expect(plan.left, -1);
    expect(plan.top, 1);
  });

  test('tile budget fails closed instead of returning a truncated plan', () {
    expect(
      () => _plan(
        boxWidth: 100,
        boxHeight: 100,
        targetLeft: 0,
        targetTop: 0,
        targetWidth: 1,
        targetHeight: 1,
        repeat: RitoBackgroundRepeat.repeat,
      ),
      throwsA(
        isA<UnsupportedError>().having(
          (error) => error.message,
          'message',
          allOf(contains('10000 Canvas tiles'), contains('limit is 4096')),
        ),
      ),
    );
  });
}

RitoBackgroundTilePlan _plan({
  required double boxWidth,
  required double boxHeight,
  required double targetLeft,
  required double targetTop,
  required double targetWidth,
  required double targetHeight,
  required RitoBackgroundRepeat repeat,
}) {
  return RitoBackgroundTilePlan.create(
    boxLeft: 0,
    boxTop: 0,
    boxWidth: boxWidth,
    boxHeight: boxHeight,
    targetLeft: targetLeft,
    targetTop: targetTop,
    targetWidth: targetWidth,
    targetHeight: targetHeight,
    repeat: repeat,
  );
}
