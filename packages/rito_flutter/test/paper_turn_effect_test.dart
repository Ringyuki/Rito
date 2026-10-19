import 'dart:async';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/painting.dart';
import 'package:flutter_gpu/gpu.dart' as gpu;
import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart';

const _w = 400.0;
const _h = 600.0;

Future<ui.Image> _page(Color colour) {
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder)
    ..drawRect(
      const Rect.fromLTWH(0, 0, _w, _h),
      Paint()..color = const Color(0xffffffff),
    );
  for (var y = 40.0; y < _h - 40; y += 24) {
    canvas.drawRect(Rect.fromLTWH(40, y, _w - 80, 10), Paint()..color = colour);
  }
  return recorder.endRecording().toImage(_w.toInt(), _h.toInt());
}

/// The page on screen and the next one.
final class _Pages implements RitoPageTurnPages {
  _Pages(this._current, this._next);

  final ui.Image _current;
  final ui.Image _next;

  @override
  double get pixelRatio => 1;

  @override
  ui.Image? image(RitoPageSlot slot) => switch (slot) {
    RitoPageSlot.current => _current,
    RitoPageSlot.next => _next,
    RitoPageSlot.previous => null,
  };

  @override
  double reveal(RitoPageSlot slot) => 1;

  @override
  int? spread(RitoPageSlot slot) => switch (slot) {
    RitoPageSlot.current => 5,
    RitoPageSlot.next => 6,
    RitoPageSlot.previous => null,
  };
}

RitoPageTurnFrame _held(double x) => RitoPageTurnFrame(
  offset: (x - 388) / 2,
  width: _w,
  incoming: RitoPageSlot.next,
  phase: RitoPageTurnPhase.held,
  touch: RitoPageTurnTouch(
    origin: const Offset(388, 120),
    position: Offset(x, 130),
  ),
);

Future<Uint8List> _painted(
  RitoPageTurnEffect effect,
  RitoPageTurnPages pages,
  RitoPageTurnFrame frame,
) async {
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder)
    ..drawRect(
      const Rect.fromLTWH(0, 0, _w, _h),
      Paint()..color = const Color(0xffffffff),
    );
  effect.paint(
    RitoPageTurnScene(
      canvas: canvas,
      size: const Size(_w, _h),
      pages: pages,
      background: const Color(0xffffffff),
    ),
    frame,
  );
  final image = await recorder.endRecording().toImage(_w.toInt(), _h.toInt());
  final bytes = (await image.toByteData())!.buffer.asUint8List();
  image.dispose();
  return bytes;
}

bool get _gpuAvailable {
  try {
    gpu.gpuContext;
    return true;
  } on Object {
    return false;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('moves as the engine has a page curled over move', () {
    final effect = RitoPaperTurnEffect();
    addTearDown(effect.dispose);
    final physics = effect.physics;
    // The edge of a page 400 wide comes over the spine after the finger has gone 400: half a turn.
    expect(
      physics.travelAcross(const Offset(380, 300), const Offset(180, 300), _w),
      closeTo(-400 * (200 / 800), 1e-6),
    );
    bool lands(double from, double to) => physics.lands(
      RitoPageTurnRelease(
        offset: (to - from) / 2,
        velocity: 0,
        width: _w,
        forward: true,
        touch: RitoPageTurnTouch(
          origin: Offset(from, 300),
          position: Offset(to, 300),
        ),
      ),
    );
    // A pull out turns it, however short; a nudge does not.
    expect(lands(250, 220), isTrue);
    expect(lands(250, 226), isTrue);
    expect(lands(250, 228), isFalse);
  });

  test('steps a page let go once for each moment it is asked about', () {
    final effect = RitoPaperTurnEffect();
    addTearDown(effect.dispose);
    final settle = effect.physics.settle(from: 0, velocity: 0, to: -800);
    // Asked its place, speed and whether it is done at one moment, it moves once.
    final x = settle.x(0.19);
    expect(settle.dx(0.19), isNonZero);
    expect(settle.isDone(0.19), isFalse);
    expect(settle.x(0.19), x);
    expect(x / -800, closeTo(0.658, 0.01));
    // It lands exactly where it was sent, a frame before it is done.
    expect(settle.x(0.38), -800);
    expect(settle.isDone(0.38), isFalse);
    expect(settle.isDone(0.397), isTrue);
  });

  test(
    'without Flutter GPU turns as the built-in cover does, and says so once',
    () async {
      final errors = <FlutterErrorDetails>[];
      final reported = FlutterError.onError;
      FlutterError.onError = errors.add;
      addTearDown(() => FlutterError.onError = reported);
      final effect = RitoPaperTurnEffect();
      addTearDown(effect.dispose);
      final pages = _Pages(
        await _page(const Color(0xff202020)),
        await _page(const Color(0xff2040a0)),
      );
      final frame = _held(240);
      final paper = await _painted(effect, pages, frame);
      final cover = await _painted(RitoPageTurnEffects.cover, pages, frame);
      expect(paper, cover);
      await _painted(effect, pages, _held(200));
      expect(errors, hasLength(1));
    },
    skip: _gpuAvailable ? 'Flutter GPU is enabled here' : false,
  );

  test(
    'with Flutter GPU curls the page over, its back and its shadow drawn',
    () async {
      final effect = RitoPaperTurnEffect();
      addTearDown(effect.dispose);
      final pages = _Pages(
        await _page(const Color(0xff202020)),
        await _page(const Color(0xff2040a0)),
      );
      final cover = await _painted(
        RitoPageTurnEffects.cover,
        pages,
        _held(240),
      );
      // The programs are readied and the pages copied first; until then a turn is plain.
      effect.warm(pages);
      final ready = Completer<void>();
      var asked = 0;
      void heard() {
        asked += 1;
        if (asked == 3 && !ready.isCompleted) ready.complete();
      }

      effect.repaint.addListener(heard);
      await ready.future.timeout(const Duration(seconds: 10));
      effect.repaint.removeListener(heard);
      // A new turn: lifted from flat and carried half way under the finger.
      Uint8List? curled;
      for (var step = 0; step < 30; step += 1) {
        curled = await _painted(effect, pages, _held(388 - 6.0 * step));
      }
      var differ = 0;
      for (var i = 0; i < curled!.length; i += 4) {
        if (curled[i] != cover[i]) differ += 1;
      }
      // Not the cover: the curled page and its shadow are drawn.
      expect(differ, greaterThan(10000));
    },
    skip: _gpuAvailable
        ? false
        : 'needs --enable-impeller --enable-flutter-gpu',
  );
}
