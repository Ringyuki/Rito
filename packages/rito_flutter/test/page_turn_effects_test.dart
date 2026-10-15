import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/painting.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart';

const _w = 400.0;

RitoPageTurnFrame _frame(double offset, RitoPageSlot? incoming) =>
    RitoPageTurnFrame(
      offset: offset,
      width: _w,
      incoming: incoming,
      phase: RitoPageTurnPhase.held,
    );

Future<ui.Image> _whitePage() {
  final recorder = ui.PictureRecorder();
  Canvas(recorder).drawRect(
    const Rect.fromLTWH(0, 0, _w, 8),
    Paint()..color = const Color(0xffffffff),
  );
  return recorder.endRecording().toImage(_w.toInt(), 8);
}

/// Every slot shows the same white page.
final class _Pages implements RitoPageTurnPages {
  _Pages(this._page);

  final ui.Image _page;

  @override
  double get pixelRatio => 1;

  @override
  ui.Image? image(RitoPageSlot slot) => _page;

  @override
  double reveal(RitoPageSlot slot) => 1;

  @override
  int? spread(RitoPageSlot slot) => slot.index;
}

void main() {
  const next = RitoPageSlot.next;
  const previous = RitoPageSlot.previous;
  const current = RitoPageSlot.current;

  test('slide moves the page and its neighbour edge to edge', () {
    expect(RitoPageTurnEffects.slide.layers(_frame(-100, next)), const [
      RitoPageTurnLayer(current, -100),
      RitoPageTurnLayer(next, 300),
    ]);
    // A spring settling back past the origin shows the far neighbour.
    expect(
      RitoPageTurnEffects.slide.layers(_frame(20, next)).first,
      const RitoPageTurnLayer(previous, -380),
    );
  });

  test('cover slides later pages over earlier ones', () {
    expect(RitoPageTurnEffects.cover.layers(_frame(-100, next)), const [
      RitoPageTurnLayer(current, 0),
      RitoPageTurnLayer(next, 300, shadow: RitoPageEdge.left),
    ]);
    expect(RitoPageTurnEffects.cover.layers(_frame(150, previous)), const [
      RitoPageTurnLayer(previous, 0),
      RitoPageTurnLayer(current, 150, shadow: RitoPageEdge.left),
    ]);
  });

  test('fade cross-fades by how far the turn has gone', () {
    expect(RitoPageTurnEffects.fade.layers(_frame(-100, next)), const [
      RitoPageTurnLayer(current, 0),
      RitoPageTurnLayer(next, 0, opacity: 0.25),
    ]);
  });

  test('every effect but none pulls the page against the ends', () {
    for (final effect in [
      RitoPageTurnEffects.slide,
      RitoPageTurnEffects.cover,
      RitoPageTurnEffects.fade,
    ]) {
      expect(effect.layers(_frame(30, null)), const [
        RitoPageTurnLayer(current, 30),
      ]);
    }
    expect(RitoPageTurnEffects.none.layers(_frame(30, null)), const [
      RitoPageTurnLayer(current, 0),
    ]);
    expect(RitoPageTurnEffects.none.instant, isTrue);
  });

  test('a sheet leaving the frame takes its shadow with it', () async {
    final sheet = await _whitePage();
    // How dark the frame is one pixel left of the moving sheet's edge.
    Future<int> darkness(double offset, RitoPageSlot incoming) async {
      final recorder = ui.PictureRecorder();
      final canvas = Canvas(recorder)
        ..drawRect(
          const Rect.fromLTWH(0, 0, _w, 8),
          Paint()..color = const Color(0xffffffff),
        );
      final frame = _frame(offset, incoming);
      RitoPageTurnEffects.cover.paint(
        RitoPageTurnScene(
          canvas: canvas,
          size: const Size(_w, 8),
          pages: _Pages(sheet),
          background: const Color(0xffffffff),
        ),
        frame,
      );
      final picture = recorder.endRecording();
      final image = await picture.toImage(_w.toInt(), 8);
      picture.dispose();
      final data = (await image.toByteData())!.buffer.asUint8List();
      image.dispose();
      final edge = RitoPageTurnEffects.cover.layers(frame).last.x.round();
      final column = edge - 1;
      return column < 0 ? 0 : 255 - data[(4 * _w.toInt() + column) * 4];
    }

    // Turning back, this page slides off to the right over the one before.
    final full = await darkness(150, previous);
    expect(full, greaterThan(40));
    expect(await darkness(_w - 24, previous), closeTo(full, 1));
    expect(await darkness(_w - 12, previous), closeTo(full / 2, 2));
    expect(await darkness(_w - 6, previous), closeTo(full / 4, 2));
    expect(await darkness(_w - 1, previous), lessThan(4));
    // Turning forward, the next page casts none before it is in the frame.
    expect(await darkness(-1, next), lessThan(4));
    expect(await darkness(-12, next), closeTo(full / 2, 2));
    expect(await darkness(-200, next), closeTo(full, 1));
  });

  test('the shadow is the web reader\'s', () {
    final web = File(
      '../kit/src/driver/transition-scene.ts',
    ).readAsStringSync();
    final dart = File('lib/src/turn/effects.dart').readAsStringSync();
    double number(String source, String pattern) =>
        double.parse(RegExp(pattern).firstMatch(source)!.group(1)!);
    expect(
      number(dart, r'_shadowReach = ([\d.]+)'),
      number(web, r'SHADOW_REACH = ([\d.]+)'),
    );
    expect(
      number(dart, r'_shadowAlpha = ([\d.]+)'),
      number(web, r'SHADOW_ALPHA = ([\d.]+)'),
    );
  });

  test('a frame reports its progress toward the incoming page', () {
    expect(_frame(-100, next).progress, 0.25);
    expect(_frame(100, previous).progress, 0.25);
    expect(_frame(-100, null).progress, 0);
  });

  test('a finger never said to have come back is at its farthest', () {
    const touch = RitoPageTurnTouch(
      origin: Offset(300, 0),
      position: Offset(120, 0),
    );
    expect(touch.farthest, const Offset(120, 0));
  });
}
