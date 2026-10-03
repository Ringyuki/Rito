import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart';

const _w = 400.0;

RitoPageTurnFrame _frame(double offset, RitoPageSlot? incoming) =>
    RitoPageTurnFrame(offset: offset, width: _w, incoming: incoming);

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

  test('a frame reports its progress toward the incoming page', () {
    expect(_frame(-100, next).progress, 0.25);
    expect(_frame(100, previous).progress, 0.25);
    expect(_frame(-100, null).progress, 0);
  });
}
