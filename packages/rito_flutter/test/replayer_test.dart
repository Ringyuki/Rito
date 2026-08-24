import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter_protocol.dart';

import 'support/display_fixture.dart';

void main() {
  test('replays all commands in deterministic golden order', () {
    final display = const RitoDisplayListDecoder().decode(displayFixture());
    final target = _RecordingTarget();

    const RitoDisplayListReplayer().replay(display, target);

    expect(target.commands, <String>[
      'save',
      'restore',
      'translate',
      'opacity',
      'transform',
      'clipRect',
      'paintPage',
      'paintBlock',
      'paintText',
      'paintRuby',
      'paintImage',
      'paintHorizontalRule',
    ]);
  });
}

final class _RecordingTarget implements RitoPaintTarget {
  final List<String> commands = <String>[];

  @override
  void save() => commands.add('save');

  @override
  void restore() => commands.add('restore');

  @override
  void translate(RitoTranslate command) => commands.add('translate');

  @override
  void opacity(RitoOpacity command) => commands.add('opacity');

  @override
  void transform(RitoTransform command) => commands.add('transform');

  @override
  void clipRect(RitoClipRect command) => commands.add('clipRect');

  @override
  void paintPage(RitoPaintPage command) => commands.add('paintPage');

  @override
  void paintBlock(RitoPaintBlock command) => commands.add('paintBlock');

  @override
  void paintText(RitoPaintText command) => commands.add('paintText');

  @override
  void paintRuby(RitoPaintRuby command) => commands.add('paintRuby');

  @override
  void paintImage(RitoPaintImage command) => commands.add('paintImage');

  @override
  void paintHorizontalRule(RitoPaintHorizontalRule command) {
    commands.add('paintHorizontalRule');
  }
}
