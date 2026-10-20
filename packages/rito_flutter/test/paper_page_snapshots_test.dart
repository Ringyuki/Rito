import 'dart:ui' as ui;

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/src/turn/paper/page_snapshots.dart';

/// Snapshots whose images have a texture once [drawn] says so, named after
/// the image.
final class _Rig {
  _Rig() {
    snapshots = PaperPageSnapshots<String>(
      share: (image) {
        if (!drawn.contains(image)) throw Exception('not drawn yet');
        return 'texture ${names[image]}';
      },
      onGivenUp: (error, stack) => givenUp += 1,
    );
  }

  late final PaperPageSnapshots<String> snapshots;
  final drawn = <ui.Image>{};
  final names = <ui.Image, String>{};
  int givenUp = 0;

  Future<ui.Image> image(String name, {bool drawn = true}) async {
    final image = await createTestImage(width: 2, height: 2, cache: false);
    names[image] = name;
    if (drawn) this.drawn.add(image);
    return image;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'a page is sampled from its own image once that has been drawn',
    () async {
      final rig = _Rig();
      final a = await rig.image('a', drawn: false);
      expect(rig.snapshots.of(a, 5), isNull);
      rig.drawn.add(a);
      expect(rig.snapshots.of(a, 5), 'texture a');
    },
  );

  test(
    'a page shown by an image not drawn yet is sampled from the texture it last had',
    () async {
      final rig = _Rig();
      expect(rig.snapshots.of(await rig.image('a'), 5), 'texture a');
      // The same page, a new image of it (one landing late) or a new
      // artifact bringing it back: its spread is the same.
      final again = await rig.image('again', drawn: false);
      expect(rig.snapshots.of(again, 5), 'texture a');
      // Another page has nothing of the first.
      expect(rig.snapshots.of(again, 6), isNull);
      // Without a spread a page is only its image.
      expect(rig.snapshots.of(again, null), isNull);
      rig.drawn.add(again);
      expect(rig.snapshots.of(again, 5), 'texture again');
    },
  );

  test('lets go of the pages no slot shows', () async {
    final rig = _Rig();
    rig.snapshots.of(await rig.image('a'), 5);
    rig.snapshots.keepOnly([6, 7, null]);
    expect(rig.snapshots.of(await rig.image('b', drawn: false), 5), isNull);
  });

  test(
    'an image that is never drawn is given up once, after a while',
    () async {
      final rig = _Rig();
      final never = await rig.image('never', drawn: false);
      for (var i = 0; i < PaperPageSnapshots.patience - 1; i += 1) {
        rig.snapshots.of(never, 5);
      }
      expect(rig.snapshots.hasNone(never), isFalse);
      rig.snapshots.of(never, 5);
      expect(rig.snapshots.hasNone(never), isTrue);
      rig.snapshots.of(never, 5);
      expect(rig.givenUp, 1);
    },
  );
}
