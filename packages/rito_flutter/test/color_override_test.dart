import 'dart:ui' as ui;

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart';

void main() {
  const dark = RitoCanvasColorOverride(
    foreground: ui.Color(0xffe5e5e5),
    background: ui.Color(0xff1a1a1a),
  );

  group('R1 page-ground classification', () {
    test('designed grounds stay the book\'s', () {
      // Teal contents page, deep black art page, saturated purple.
      for (final color in const [
        ui.Color(0xff00ced1),
        ui.Color(0xff111111),
        ui.Color(0xff663399),
      ]) {
        expect(
          RitoCanvasColorOverride.isBookOwnedPageGround(color),
          isTrue,
          reason: '$color',
        );
      }
    });

    test('white-paper defaults go to the theme', () {
      // White, warm off-white (solarized paper), light gray, and any
      // translucent ground.
      for (final color in const [
        ui.Color(0xffffffff),
        ui.Color(0xfffdf6e3),
        ui.Color(0xffebebeb),
        ui.Color(0x80111111),
      ]) {
        expect(
          RitoCanvasColorOverride.isBookOwnedPageGround(color),
          isFalse,
          reason: '$color',
        );
      }
    });
  });

  group('R2 declared-ground scope', () {
    test('a declared ground returns the original ink untouched', () {
      // Black ink on a declared yellow band would be invisible after a
      // one-sided substitution; the pair is the typesetter's.
      const black = ui.Color(0xff000000);
      expect(
        dark.effectiveTextColor(
          black,
          declaredGround: const ui.Color(0xffffef9e),
        ),
        black,
      );
    });
  });

  group('R3 lightness-only relight', () {
    test('readable ink stays', () {
      const accent = ui.Color(0xffffb86b);
      expect(dark.effectiveTextColor(accent), accent);
    });

    test('achromatic ink lands exactly on the theme foreground', () {
      for (final ink in const [
        ui.Color(0xff000000),
        ui.Color(0xff222222),
        ui.Color(0xff333333),
      ]) {
        expect(dark.effectiveTextColor(ink), dark.foreground, reason: '$ink');
      }
    });

    test('chromatic ink keeps hue and moves only lightness', () {
      // Red heading at night becomes bright red, not gray-white. The
      // exact channels mirror the browser pen's quantized HSL round
      // trip: #cc0000 -> hsl(0, 100%, L(fg)) -> rgb(255, 203, 203).
      const red = ui.Color(0xffcc0000);
      expect(
        dark.effectiveTextColor(red),
        const ui.Color(0xffffcbcb),
      );
    });

    test('a foreground that cannot carry the hue falls back exactly', () {
      // Pathological theme: foreground barely differs from background,
      // so the relit hue cannot reach 4.5:1 either.
      const muddy = RitoCanvasColorOverride(
        foreground: ui.Color(0xff888888),
        background: ui.Color(0xff777777),
      );
      const red = ui.Color(0xffcc0000);
      expect(muddy.effectiveTextColor(red), muddy.foreground);
    });
  });
}
