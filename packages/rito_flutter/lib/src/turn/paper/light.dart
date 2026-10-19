// Made from the web paper turn's light.ts (packages/kit/src/driver/paper);
// regenerate with RITO_EMIT_SHADERS=1 pnpm --filter @ritojs/kit test paper-flutter-shaders.

/// The light the paper turn is lit by: see the web's `light.ts`.
abstract final class RitoPaperLight {
  static const List<double> keyDirection = <double>[
    -0.2806603285720313,
    -0.12028299795944199,
    0.952240400512249,
  ];
  static const double keyShare = 0.1;
  static const double keySize = 0.5;
  static const double paperThrough = 0.09;
  static const double showsThrough = 0.05;
  static const double showsThroughCurled = 0.4;
  static const double handedBack = 0.9;
}
