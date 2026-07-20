import 'dart:ui' as ui;

/// Converts the CSS/Flutter blur radius carried by RITODL1 to the sigma Skia's
/// [ui.MaskFilter.blur] requires.
///
/// This follows Flutter's own [ui.Shadow] and `BoxShadow` conversion instead of
/// treating radius as sigma or using an approximate `/ 2` conversion.
double ritoCanvasShadowSigma(double blurRadius) {
  return ui.Shadow.convertRadiusToSigma(blurRadius);
}
