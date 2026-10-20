// The paper turn's model as Flutter runs it, through the C ABI, replayed
// over the turns `crates/rito-turn` replays natively (`tests/web_traces.rs`)
// and the web replays through wasm: every answer folds into the same
// digest, so Flutter computes the bits the web does.
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/src/native/bindings.dart';
import 'package:rito_flutter/src/turn/effects.dart';
import 'package:rito_flutter/src/turn/paper/model.dart';

const _fixtures = '../../crates/rito-turn/tests/fixtures';

/// FNV-1a over 32-bit words, f64s low word first: `Digest` in `tests/web_traces.rs`.
final class _Digest {
  int value = 2166136261;
  final _wide = ByteData(8);

  void word(int word) {
    value = ((value ^ word) * 16777619) & 0xFFFFFFFF;
  }

  void number(double number) {
    _wide.setFloat64(0, number, Endian.little);
    word(_wide.getUint32(0, Endian.little));
    word(_wide.getUint32(4, Endian.little));
  }

  void flag(bool value) => word(value ? 1 : 0);

  void leaves(List<int> leaves) {
    word(leaves.length);
    leaves.forEach(word);
  }

  void points(Float32List values) {
    final words = Uint32List.view(
      values.buffer,
      values.offsetInBytes,
      values.length,
    );
    var value = this.value;
    for (final word in words) {
      value = ((value ^ word) * 16777619) & 0xFFFFFFFF;
    }
    this.value = value;
  }
}

Offset _point(Object? json) {
  final point = json! as Map<String, Object?>;
  return Offset(
    (point['x']! as num).toDouble(),
    (point['y']! as num).toDouble(),
  );
}

RitoPageTurnTouch? _touch(Object? json) {
  if (json == null) return null;
  final touch = json as Map<String, Object?>;
  final farthest = touch['farthest'];
  return RitoPageTurnTouch(
    origin: _point(touch['origin']),
    position: _point(touch['position']),
    farthest: farthest == null ? null : _point(farthest),
  );
}

double _n(Map<String, Object?> json, String key) =>
    (json[key]! as num).toDouble();

RitoPaperTurnPage _page(int spread) =>
    RitoPaperTurnPage(spread: spread, buffer: 1000 + spread);

/// A sheet as `write_sheet` lays it out.
List<double> _sheetNumbers(RitoPaperTurnSheet sheet) {
  List<double> face(RitoPaperTurnFace? face) =>
      face == null ? [0, 0] : [face.front ? 1 : 2, face.leaf.toDouble()];
  final curl = sheet.curl;
  return [
    ...face(sheet.front),
    ...face(sheet.back),
    sheet.shown,
    (sheet.still ?? 0).toDouble(),
    ...(curl == null
        ? [0, 0, 0, 0, 0]
        : [1, curl.dx, curl.dy, curl.at, curl.radius]),
  ];
}

void _laidOut(RitoPaperTurnModel model, _Digest digest) {
  final laid = model.lay(0);
  if (laid == null) throw StateError('a frame waits');
  digest
    ..word(laid.led)
    ..leaves(laid.leftBook)
    ..word(laid.columns)
    ..word(laid.rows)
    ..word(laid.sheets);
  final points = RitoNativePaperTurnPoints(laid.columns * laid.rows * 3);
  try {
    for (var index = 0; index < laid.sheets; index += 1) {
      final sheet = model.sheet(index, points);
      _sheetNumbers(sheet).forEach(digest.number);
      digest
        ..points(points.positions)
        ..points(points.normals);
    }
  } finally {
    points.dispose();
  }
}

String _replay(Map<String, Object?> trace) {
  final layout = trace['layout']! as Map<String, Object?>;
  final model = RitoPaperTurnModel();
  final digest = _Digest();
  RitoPaperTurnSettle? settle;
  try {
    for (final json in trace['frames']! as List<Object?>) {
      final record = json! as Map<String, Object?>;
      final lands = record['lands'] as Map<String, Object?>?;
      if (lands != null) {
        final release = lands['release']! as Map<String, Object?>;
        final answer = model.lands(
          dx: _n(release, 'dx'),
          from: _n(release, 'from'),
          velocity: _n(release, 'velocity'),
          width: _n(release, 'width'),
          forward: release['direction'] == 'forward',
          touch: _touch(release['touch']),
          spine: (release['spine'] as num?)?.toDouble(),
        );
        expect(answer, lands['answer']);
        digest.flag(answer);
        continue;
      }
      final from = record['settleFrom'] as Map<String, Object?>?;
      if (from != null) {
        settle?.dispose();
        settle = model.settle(
          _n(from, 'from'),
          _n(from, 'velocity'),
          _n(from, 'to'),
        );
        continue;
      }
      final now = _n(record, 'now');
      final step = record['settle'] as Map<String, Object?>?;
      if (settle != null && step != null) {
        final at = settle.step(_n(step, 'seconds'), now);
        digest
          ..number(at.x)
          ..number(at.velocity)
          ..flag(at.done);
      }
      final frame = record['frame']! as Map<String, Object?>;
      final incoming = record['incoming'] as num?;
      final begun = model.begin(
        RitoPaperTurnInput(
          width: _n(layout, 'width'),
          height: _n(layout, 'height'),
          spine: _n(layout, 'spine'),
          cssPixel: _n(layout, 'cssPixel'),
          dx: _n(frame, 'dx'),
          incoming: switch (frame['incoming']) {
            'next' => RitoPageSlot.next,
            'prev' => RitoPageSlot.previous,
            _ => null,
          },
          phase: switch (frame['phase']) {
            'held' => RitoPageTurnPhase.held,
            'landing' => RitoPageTurnPhase.landing,
            _ => RitoPageTurnPhase.returning,
          },
          touch: _touch(frame['touch']),
          current: _page((record['spread']! as num).toInt()),
          incomingPage: incoming == null ? null : _page(incoming.toInt()),
          now: now,
          epoch: 0,
        ),
      );
      if (begun.turns) {
        digest
          ..word(1)
          ..number(begun.spread.toDouble())
          ..flag(begun.anew);
      } else {
        digest
          ..word(0)
          ..number(_n(frame, 'dx'));
      }
      digest
        ..leaves(begun.forgotten.leaves)
        ..flag(begun.forgotten.release);
      if (begun.turns) _laidOut(model, digest);
      digest.flag(model.state(now).gone);
    }
  } finally {
    settle?.dispose();
    model.dispose();
  }
  return digest.value.toRadixString(16).padLeft(8, '0');
}

void main() {
  test('replays the recorded turns to the digests the engine replays them to '
      'natively and on the web', () {
    final recorded =
        jsonDecode(File('$_fixtures/web-traces.json').readAsStringSync())
            as Map<String, Object?>;
    final held =
        jsonDecode(File('$_fixtures/web-traces-digest.json').readAsStringSync())
            as Map<String, Object?>;
    final ours = <String, String>{
      for (final trace in recorded['traces']! as List<Object?>)
        (trace! as Map<String, Object?>)['name']! as String: _replay(
          trace as Map<String, Object?>,
        ),
    };
    expect(ours, held);
  });

  test('says the model has been disposed rather than call into it', () {
    final model = RitoPaperTurnModel()..dispose();
    expect(() => model.lay(0), throwsStateError);
  });
}
