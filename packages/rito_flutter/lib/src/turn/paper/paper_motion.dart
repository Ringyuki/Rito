import '../../native/bindings.dart';

/// The numbers a paper turn moves by, in place of the engine's defaults:
/// each one left null keeps the default. Lengths are logical px (the web's
/// CSS px), times seconds.
///
/// A leaf let go on the move finishes on the leaf spring ([leafStiffness],
/// [leafDamping]); one let go slower than [unhurried] of its remaining
/// lengths a second goes at its own pace, taking [wholeTurn] the whole way
/// ([wholeSpan] or farther) and [shortestTurn] for the least nudge; one
/// sent back the way it came stops in [stopsIn] first. A curled page turns
/// when its finger has pulled [leastPull], has come back no more than
/// [cameBack] or [cameBackShare] of its farthest pull, and is not flung back
/// faster than [flungBack] px a second. A leaf of a two-page spread turns
/// when the share of it the finger carried, its speed (leaves a second)
/// projected over [leafProjection] added, passes [leafThreshold], or its
/// speed passes [leafCommit]; pulled back faster than [leafPullBack], it
/// stays.
final class RitoPaperTurnMotion {
  const RitoPaperTurnMotion({
    this.leafStiffness,
    this.leafDamping,
    this.wholeTurn,
    this.shortestTurn,
    this.wholeSpan,
    this.unhurried,
    this.stopsIn,
    this.leastPull,
    this.cameBack,
    this.cameBackShare,
    this.flungBack,
    this.leafProjection,
    this.leafThreshold,
    this.leafCommit,
    this.leafPullBack,
  });

  final double? leafStiffness;
  final double? leafDamping;
  final double? wholeTurn;
  final double? shortestTurn;
  final double? wholeSpan;
  final double? unhurried;
  final double? stopsIn;
  final double? leastPull;
  final double? cameBack;
  final double? cameBackShare;
  final double? flungBack;
  final double? leafProjection;
  final double? leafThreshold;
  final double? leafCommit;
  final double? leafPullBack;

  /// The numbers paper turns with by default, the engine's.
  static RitoPaperTurnMotion get defaults {
    final numbers = RitoNativePaperTurn.defaultMotion();
    return RitoPaperTurnMotion(
      leafStiffness: numbers[0],
      leafDamping: numbers[1],
      wholeTurn: numbers[2],
      shortestTurn: numbers[3],
      wholeSpan: numbers[4],
      unhurried: numbers[5],
      stopsIn: numbers[6],
      leastPull: numbers[7],
      cameBack: numbers[8],
      cameBackShare: numbers[9],
      flungBack: numbers[10],
      leafProjection: numbers[11],
      leafThreshold: numbers[12],
      leafCommit: numbers[13],
      leafPullBack: numbers[14],
    );
  }

  /// These numbers in the order the engine lays them out, the defaults
  /// where they are null.
  List<double> numbers() {
    final given = <double?>[
      leafStiffness,
      leafDamping,
      wholeTurn,
      shortestTurn,
      wholeSpan,
      unhurried,
      stopsIn,
      leastPull,
      cameBack,
      cameBackShare,
      flungBack,
      leafProjection,
      leafThreshold,
      leafCommit,
      leafPullBack,
    ];
    final defaults = RitoNativePaperTurn.defaultMotion();
    return <double>[
      for (var index = 0; index < given.length; index += 1)
        given[index] ?? defaults[index],
    ];
  }
}
