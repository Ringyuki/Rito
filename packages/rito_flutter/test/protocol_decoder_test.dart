import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter_protocol.dart';

import 'support/artifact_fixture.dart';
import 'support/display_fixture.dart';

void main() {
  test('decodes a non-first exact artifact and every display opcode', () {
    final artifact = const RitoArtifactDecoder().decode(artifactFixture());

    expect(artifact.sessionId, 91);
    expect(artifact.requestId, 12);
    expect(artifact.artifactId, 7001);
    expect(artifact.localPageIndex, 7);
    expect(artifact.localSpreadIndex, 3);
    expect(artifact.localPageIndexes, <int>[7]);
    expect(artifact.locator.sourcePoint?.nodePath, <int>[1, 9, 2]);
    expect(artifact.locator.sourcePoint?.textOffset, 47);
    expect(artifact.matchedBy, RitoLocatorMatch.sourcePoint);
    expect(artifact.pages.single.pageIndex, 7);
    expect(artifact.pages.single.hits.single.text, 'body');
    expect(artifact.pages.single.semantics.single.level, 2);
    expect(artifact.pages.single.textRuns.single.end, 4);
    expect(
      artifact.resources
          .firstWhere((resource) => resource.kind == RitoResourceKind.image)
          .kind,
      RitoResourceKind.image,
    );
    expect(
      artifact.resources
          .firstWhere((resource) => resource.kind == RitoResourceKind.font)
          .href,
      'fonts/serif.woff2',
    );
    expect(artifact.fonts.single.shapeFingerprint, 'shape-v1');
    expect(artifact.navigation.previous, RitoAdjacentAvailability.available);
    expect(artifact.navigation.next, RitoAdjacentAvailability.pending);
    expect(artifact.displayList.displayList.commandCount, 12);
    expect(
      artifact.displayList.displayList.commands.map(
        (command) => command.opcode,
      ),
      List<int>.generate(12, (index) => index + 1),
    );
    final commands = artifact.displayList.displayList.commands;
    expect((commands[2] as RitoTranslate).dx, 1);
    final transform = commands[4] as RitoTransform;
    expect(transform.origin.x, 0);
    expect(transform.boxSize.height, 30);
    expect(transform.transforms, <Matcher>[
      isA<RitoRotateTransform>(),
      isA<RitoScaleTransform>(),
      isA<RitoTranslateTransform>(),
    ]);
    final block = commands[7] as RitoPaintBlock;
    expect(block.paint.background?.image, testRelativeImageHref);
    expect(block.paint.background?.size, RitoBackgroundSize.cover);
    expect(block.paint.boxShadows.single.inset, isFalse);
    final text = commands[8] as RitoPaintText;
    expect(text.text, 'body');
    expect(text.paint.font.family, 'Rito Serif');
    expect(text.paint.color.space, RitoColorSpace.srgb);
    expect(text.sourceText, 'source body');
    expect(text.sourceTextOffset, 9);
    final image = commands[10] as RitoPaintImage;
    expect(image.src, testRelativeImageHref);
    expect(image.sourceRect?.x, 4);
    expect(image.sourceRect?.height, 30);
  });

  test('rejects every truncated artifact prefix and trailing bytes', () {
    final fixture = artifactFixture();
    for (var end = 0; end < fixture.length; end += 1) {
      expect(
        () => const RitoArtifactDecoder().decode(
          Uint8List.sublistView(fixture, 0, end),
        ),
        throwsA(isA<FormatException>()),
        reason: 'prefix $end must fail',
      );
    }
    expect(
      () => const RitoArtifactDecoder().decode(
        Uint8List.fromList(<int>[...fixture, 0]),
      ),
      throwsA(isA<FormatException>()),
    );
    expect(
      () => const RitoArtifactDecoder().decode(
        artifactFixture(previousAvailability: 5),
      ),
      throwsA(isA<FormatException>()),
    );
    for (final invalidIdFixture in <Uint8List>[
      artifactFixture(sessionId: 0),
      artifactFixture(requestId: 0),
      artifactFixture(revisionId: 0),
      artifactFixture(artifactId: 0),
      artifactFixture(artifactId: 0x8000000000000000),
    ]) {
      expect(
        () => const RitoArtifactDecoder().decode(invalidIdFixture),
        throwsA(isA<FormatException>()),
      );
    }
  });

  test('accepts every frozen typed enum tag', () {
    const decoder = RitoDisplayListDecoder();
    for (var tag = 1; tag <= 15; tag += 1) {
      final display = decoder.decode(displayFixture(pageColorSpaceTag: tag));
      final page = display.commands[6] as RitoPaintPage;
      expect(page.paint.backgroundColor, isNotNull);
    }
    for (var tag = 1; tag <= 10; tag += 1) {
      decoder.decode(displayFixture(horizontalRuleStyleTag: tag));
    }
    for (var tag = 1; tag <= 6; tag += 1) {
      decoder.decode(displayFixture(backgroundRepeatTag: tag));
    }
    for (var tag = 1; tag <= 3; tag += 1) {
      decoder.decode(displayFixture(backgroundSizeTag: tag));
    }
    for (var tag = 1; tag <= 2; tag += 1) {
      decoder.decode(displayFixture(fontStyleTag: tag));
      decoder.decode(displayFixture(decorationKindTag: tag));
      decoder.decode(displayFixture(blockRadiusTag: tag));
      decoder.decode(displayFixture(transformLengthTag: tag));
    }
  });

  test('rejects every truncated display-list prefix', () {
    const decoder = RitoDisplayListDecoder();
    final fixture = displayFixture();
    for (var end = 0; end < fixture.length; end += 1) {
      expect(
        () => decoder.decode(Uint8List.sublistView(fixture, 0, end)),
        throwsA(isA<FormatException>()),
        reason: 'display prefix $end must fail',
      );
    }
  });

  test('rejects malformed typed display fields and trailing bytes', () {
    const decoder = RitoDisplayListDecoder();
    final invalidVersion = displayFixture()..setRange(7, 11, <int>[2, 0, 0, 0]);
    final invalidUtf8 = displayFixture();
    invalidUtf8[_indexOf(invalidUtf8, testRelativeImageHref.codeUnits)] = 0xff;
    final malformed = <Uint8List>[
      invalidVersion,
      invalidUtf8,
      displayFixture(unknownOpcode: 65535),
      displayFixture(transformTag: 255),
      displayFixture(transformLengthTag: 3),
      displayFixture(pageColorOptionTag: 2),
      displayFixture(pageColorSpaceTag: 16),
      displayFixture(pageColorFlags: 0x10),
      displayFixture(pageColorRed: double.infinity),
      displayFixture(backgroundSizeTag: 4),
      displayFixture(backgroundRepeatTag: 7),
      displayFixture(blockRadiusTag: 3),
      displayFixture(shadowInsetTag: 2),
      displayFixture(fontStyleTag: 3),
      displayFixture(decorationKindTag: 3),
      displayFixture(horizontalRuleStyleTag: 11),
      displayFixture(translateDx: double.nan),
    ];
    for (final bytes in malformed) {
      expect(() => decoder.decode(bytes), throwsA(isA<FormatException>()));
    }
    expect(
      () => decoder.decode(Uint8List.fromList(<int>[...displayFixture(), 0])),
      throwsA(isA<FormatException>()),
    );
  });

  test('strictly decodes an owned RITORES1 payload', () {
    const decoder = RitoResourceDecoder();
    final resource = decoder.decode(resourceFixture());
    expect(resource.artifactId, 7001);
    expect(resource.href, 'images/cover.png');
    expect(resource.mediaType, 'image/png');
    expect(resource.bytes, <int>[1, 2, 3, 4]);
    expect(resource.width, 320);
    expect(resource.height, 480);

    final unknown = resourceFixture()..[28] = 99;
    expect(() => decoder.decode(unknown), throwsA(isA<FormatException>()));

    final oversized = resourceFixture();
    final view = ByteData.sublistView(oversized);
    final hrefLength = view.getUint32(32, Endian.little);
    final mediaLengthOffset = 36 + hrefLength;
    final mediaLength = view.getUint32(mediaLengthOffset, Endian.little);
    final blobLengthOffset = mediaLengthOffset + 4 + mediaLength;
    view.setUint64(
      blobLengthOffset,
      32 * 1024 * 1024 + 1,
      Endian.little,
    );
    expect(() => decoder.decode(oversized), throwsA(isA<FormatException>()));

    expect(
      () => decoder.decode(resourceFixture(artifactId: 0)),
      throwsA(isA<FormatException>()),
    );
    expect(
      () => decoder.decode(resourceFixture(artifactId: 0x8000000000000000)),
      throwsA(isA<FormatException>()),
    );
  });
}

int _indexOf(List<int> bytes, List<int> needle) {
  for (var start = 0; start <= bytes.length - needle.length; start += 1) {
    var matches = true;
    for (var index = 0; index < needle.length; index += 1) {
      if (bytes[start + index] != needle[index]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return start;
    }
  }
  throw StateError('Fixture needle was not found.');
}
