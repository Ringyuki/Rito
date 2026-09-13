import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter_protocol.dart';
import 'package:rito_flutter/src/render/canvas_target.dart';

/// Text runs arrive in CSS pixels and paint under the list's ratio: the
/// same run on a 2× list lands its ink on the doubled device columns and
/// rows, drawn at its CSS size under the scale rather than at a doubled
/// size on the device grid (synthetic bold widens with the size the
/// rasterizer is asked for, so the two are not the same ink).
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const family = 'RitoRatioTestFace';

  setUpAll(() async {
    final bytes = File(
      '../../apps/reader/src/assets/fonts/Tinos-Regular.ttf',
    ).readAsBytesSync();
    await (FontLoader(
      family,
    )..addFont(Future<ByteData>.value(ByteData.sublistView(bytes)))).load();
  });

  Future<ui.Rect> inkBounds(double ratio) async {
    final recorder = ui.PictureRecorder();
    final canvas = ui.Canvas(recorder)
      ..drawRect(
        const ui.Rect.fromLTWH(0, 0, 240, 120),
        ui.Paint()..color = const ui.Color(0xffffffff),
      );
    RitoPrimitiveCanvasTarget(
      canvas,
      resolveImage: (href) => null,
      ratio: ratio,
    ).paintText(
      RitoPaintText(
        text: 'H',
        rect: const RitoDisplayRect(x: 20, y: 10, width: 12, height: 16),
        paint: RitoRunPaint(
          font: const RitoFontPaint(
            family: family,
            sizePx: 16,
            weight: 400,
            style: RitoFontStyle.normal,
          ),
          color: const RitoColor(
            space: RitoColorSpace.srgb,
            component0: 0,
            component1: 0,
            component2: 0,
            alpha: 1,
            none: RitoColorNoneFlags(
              component0: false,
              component1: false,
              component2: false,
              alpha: false,
            ),
          ),
          textShadows: const <RitoTextShadow>[],
        ),
      ),
    );
    final picture = recorder.endRecording();
    final image = await picture.toImage(240, 120);
    picture.dispose();
    final data = (await image.toByteData())!.buffer.asUint8List();
    image.dispose();
    var left = 240, top = 120, right = -1, bottom = -1;
    for (var y = 0; y < 120; y += 1) {
      for (var x = 0; x < 240; x += 1) {
        if (data[(y * 240 + x) * 4] < 128) {
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
    }
    expect(right, greaterThanOrEqualTo(left), reason: 'the run paints ink');
    return ui.Rect.fromLTRB(
      left.toDouble(),
      top.toDouble(),
      right.toDouble() + 1,
      bottom.toDouble() + 1,
    );
  }

  test(
    'a run on a 2x list paints on the doubled device grid',
    () async {
      final atOne = await inkBounds(1);
      final atTwo = await inkBounds(2);
      // The glyph's left stem sits at the run's x and its foot on the
      // baseline row; on the 2× list both sit at twice that. The cap's top
      // edge is an antialiased boundary and may land one row either way.
      expect((atTwo.left - 2 * atOne.left).abs(), lessThanOrEqualTo(1));
      expect((atTwo.bottom - 2 * atOne.bottom).abs(), lessThanOrEqualTo(1));
      expect((atTwo.top - 2 * atOne.top).abs(), lessThanOrEqualTo(2));
      expect((atTwo.width - 2 * atOne.width).abs(), lessThanOrEqualTo(2));
      // The 1× run anchors its glyph at the wire x.
      expect((atOne.left - 20).abs(), lessThanOrEqualTo(2));
      // These bounds are a rasterizer calibration, not an engine rule: the
      // ink box moves by an antialiased column or row when the glyph is
      // rasterized by a different backend, and measured here the left,
      // bottom and top deltas already sit exactly on their limits. Asserted
      // only where they were calibrated; loosening them instead would stop
      // the test from catching the half-row drift it exists for.
    },
    skip: Platform.isMacOS
        ? null
        : 'ink bounds are calibrated against the macOS rasterizer',
  );

  test('a ratio that is not finite and positive is refused', () {
    final recorder = ui.PictureRecorder();
    for (final ratio in <double>[0, -1, double.nan, double.infinity]) {
      expect(
        () => RitoPrimitiveCanvasTarget(
          ui.Canvas(recorder),
          resolveImage: (href) => null,
          ratio: ratio,
        ),
        throwsArgumentError,
        reason: '$ratio',
      );
    }
    recorder.endRecording().dispose();
  });
}
