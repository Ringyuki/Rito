import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter_protocol.dart';

import 'support/artifact_fixture.dart';
import 'support/display_fixture.dart';

void main() {
  test('decodes a non-first exact artifact and every primitive opcode', () {
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
    expect(artifact.displayList.formatVersion, 2);
    final list = artifact.displayList.displayList;
    expect(list.ratio, 1);
    expect(list.commandCount, 13);
    expect(
      list.commands.map((primitive) => primitive.opcode),
      List<int>.generate(13, (index) => index + 1),
    );
    expect((list.commands[2] as RitoPrimitiveTranslate).dx, 1);
    final transform = list.commands[4] as RitoPrimitiveTransform;
    expect(transform.origin.x, 0);
    expect(transform.transforms, <Matcher>[
      isA<RitoDeviceRotate>(),
      isA<RitoDeviceScale>(),
      isA<RitoDeviceTranslate>(),
    ]);
    final fill = list.commands[6] as RitoPrimitiveFillRect;
    expect(fill.ground, RitoFillGround.page);
    expect(fill.color.space, RitoColorSpace.srgb);
    final fillPath = list.commands[7] as RitoPrimitiveFillPath;
    expect(fillPath.rule, RitoFillRule.evenOdd);
    expect(fillPath.groundRect?.x, 4);
    final image = list.commands[10] as RitoPrimitiveDrawImage;
    expect(image.src, testRelativeImageHref);
    expect(image.sourceRect?.x, 4);
    expect(image.tiles?.rows, 3);
    final text = list.commands[11] as RitoPrimitiveText;
    expect(text.command.text, 'body');
    expect(text.command.paint.font.family, 'Rito Serif');
    expect(text.command.paint.color.space, RitoColorSpace.srgb);
    expect(text.command.sourceText, 'source body');
    expect(text.command.sourceTextOffset, 9);
    final ruby = list.commands[12] as RitoPrimitiveRuby;
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
    const decoder = RitoPrimitiveListDecoder();
    for (var tag = 1; tag <= 15; tag += 1) {
      final list = decoder.decode(primitiveFixture(fillColorSpaceTag: tag));
      final fill = list.commands[6] as RitoPrimitiveFillRect;
      expect(fill.color.alpha, 1);
    }
    final p3 = decoder.decode(primitiveFixture(fillColorSpaceTag: 9));
    expect(
      (p3.commands[6] as RitoPrimitiveFillRect).color.space,
      RitoColorSpace.displayP3,
    );
    for (var tag = 1; tag <= 6; tag += 1) {
      decoder.decode(primitiveFixture(pathOpTag: tag));
    }
    for (var tag = 1; tag <= 3; tag += 1) {
      decoder.decode(primitiveFixture(transformTag: tag));
      decoder.decode(primitiveFixture(groundTag: tag));
    }
    for (var tag = 1; tag <= 2; tag += 1) {
      decoder.decode(primitiveFixture(fontStyleTag: tag));
      decoder.decode(primitiveFixture(fillRuleTag: tag));
      decoder.decode(primitiveFixture(strokeCapTag: tag));
    }
    final none = decoder.decode(primitiveFixture(groundTag: 1));
    expect(
      (none.commands[6] as RitoPrimitiveFillRect).ground,
      RitoFillGround.none,
    );
  });

  test('rejects every truncated primitive-list prefix', () {
    const decoder = RitoPrimitiveListDecoder();
    final fixture = primitiveFixture();
    for (var end = 0; end < fixture.length; end += 1) {
      expect(
        () => decoder.decode(Uint8List.sublistView(fixture, 0, end)),
        throwsA(isA<FormatException>()),
        reason: 'primitive prefix $end must fail',
      );
    }
  });

  test('rejects malformed typed primitive fields and trailing bytes', () {
    const decoder = RitoPrimitiveListDecoder();
    final invalidUtf8 = primitiveFixture();
    invalidUtf8[_indexOf(invalidUtf8, testRelativeImageHref.codeUnits)] = 0xff;
    final malformed = <Uint8List>[
      primitiveFixture(version: 1),
      primitiveFixture(ratio: 0),
      invalidUtf8,
      primitiveFixture(unknownOpcode: 65535),
      primitiveFixture(transformTag: 255),
      primitiveFixture(pathOpTag: 7),
      primitiveFixture(groundTag: 4),
      primitiveFixture(fillRuleTag: 3),
      primitiveFixture(strokeCapTag: 3),
      primitiveFixture(fillColorSpaceTag: 16),
      primitiveFixture(fillColorFlags: 0x10),
      primitiveFixture(fillColorRed: double.infinity),
      primitiveFixture(fontStyleTag: 3),
      primitiveFixture(translateDx: double.nan),
    ];
    for (final bytes in malformed) {
      expect(() => decoder.decode(bytes), throwsA(isA<FormatException>()));
    }
    expect(
      () => decoder.decode(Uint8List.fromList(<int>[...primitiveFixture(), 0])),
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
    view.setUint64(blobLengthOffset, 32 * 1024 * 1024 + 1, Endian.little);
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
