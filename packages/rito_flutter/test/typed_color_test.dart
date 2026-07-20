import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter_protocol.dart';
import 'package:rito_flutter/src/render/typed_color.dart';

void main() {
  test('typed sRGB paint preserves channels and opacity', () {
    final color = ritoUiColor(_color(RitoColorSpace.srgb, .25, .5, .75, .4));
    expect(color.r, closeTo(.25, 1e-6));
    expect(color.g, closeTo(.5, 1e-6));
    expect(color.b, closeTo(.75, 1e-6));
    expect(color.a, closeTo(.4, 1e-6));
  });

  test('typed HSL and missing components convert without CSS parsing', () {
    final green = ritoUiColor(_color(RitoColorSpace.hsl, 120, 100, 50, 1));
    expect(green.r, closeTo(0, 1e-6));
    expect(green.g, closeTo(1, 1e-6));
    expect(green.b, closeTo(0, 1e-6));

    final missingAlpha = ritoUiColor(
      RitoColor(
        space: RitoColorSpace.srgb,
        component0: 1,
        component1: 1,
        component2: 1,
        alpha: 1,
        none: const RitoColorNoneFlags(
          component0: false,
          component1: false,
          component2: false,
          alpha: true,
        ),
      ),
    );
    expect(missingAlpha.a, 0);
  });

  test('every frozen color space reaches a typed Canvas color', () {
    const spaces = <RitoColorSpace>[
      RitoColorSpace.srgb,
      RitoColorSpace.hsl,
      RitoColorSpace.hwb,
      RitoColorSpace.lab,
      RitoColorSpace.lch,
      RitoColorSpace.oklab,
      RitoColorSpace.oklch,
      RitoColorSpace.srgbLinear,
      RitoColorSpace.displayP3,
      RitoColorSpace.displayP3Linear,
      RitoColorSpace.a98Rgb,
      RitoColorSpace.prophotoRgb,
      RitoColorSpace.rec2020,
      RitoColorSpace.xyzD50,
      RitoColorSpace.xyzD65,
    ];
    for (final space in spaces) {
      final color = ritoUiColor(_color(space, .25, .5, .75, 1));
      expect(color.a, 1, reason: space.name);
      expect(color.r.isFinite, isTrue, reason: space.name);
      expect(color.g.isFinite, isTrue, reason: space.name);
      expect(color.b.isFinite, isTrue, reason: space.name);
    }
  });
}

RitoColor _color(
  RitoColorSpace space,
  double component0,
  double component1,
  double component2,
  double alpha,
) {
  return RitoColor(
    space: space,
    component0: component0,
    component1: component1,
    component2: component2,
    alpha: alpha,
    none: const RitoColorNoneFlags(
      component0: false,
      component1: false,
      component2: false,
      alpha: false,
    ),
  );
}
