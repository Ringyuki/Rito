import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart';

const _book = '../rito/tests/fixtures/books/book-10.epub';

RitoPinnedFontPolicy _pinnedPolicy() {
  final pinned = File(
    '../../apps/reader/src/assets/fonts/Tinos-Regular.ttf',
  ).readAsBytesSync();
  return RitoPinnedFontPolicy(
    faces: <RitoPinnedFontFace>[
      RitoPinnedFontFace(
        bytes: pinned,
        genericRole: RitoPinnedFontGenericRole.serif,
      ),
    ],
  );
}

RitoArtifactRequest _request(int sessionId) => RitoArtifactRequest(
  sessionId: sessionId,
  requestId: 1,
  layout: const RitoLayoutRequest(
    viewportWidth: 420,
    viewportHeight: 640,
    marginTop: 24,
    marginRight: 24,
    marginBottom: 24,
    marginLeft: 24,
    spreadMode: RitoSpreadMode.single,
    firstPageAlone: true,
    spreadGap: 0,
    rootFontSize: 16,
  ),
  locator: const RitoLocator(href: 'OEBPS/Text/Section013.xhtml'),
);

/// Packs the fixture with the repository's own `rito-pack`.
({
  Uint8List skeleton,
  Uint8List key,
  Map<int, File> files,
  Map<int, Uint8List> keys,
})
_pack(Directory out) {
  final packed = Process.runSync('cargo', <String>[
    'run',
    '--quiet',
    '-p',
    'rito-pack',
    '--',
    File(_book).absolute.path,
    out.path,
    '--encrypt',
  ], workingDirectory: '../..');
  expect(packed.exitCode, 0, reason: '${packed.stderr}');
  Uint8List hex(String value) => Uint8List.fromList(<int>[
    for (var index = 0; index < value.length; index += 2)
      int.parse(value.substring(index, index + 2), radix: 16),
  ]);
  final manifest =
      jsonDecode(File('${out.path}/manifest.json').readAsStringSync())
          as Map<String, Object?>;
  final keys =
      (jsonDecode(File('${out.path}/keys.json').readAsStringSync())
              as Map<String, Object?>)['keys']!
          as Map<String, Object?>;
  return (
    skeleton: File('${out.path}/skeleton.rshd').readAsBytesSync(),
    key: hex(keys['0']! as String),
    files: <int, File>{
      for (final shard in manifest['shards']! as List<Object?>)
        (shard! as Map<String, Object?>)['id']! as int: File(
          '${out.path}/${(shard as Map<String, Object?>)['file']}',
        ),
    },
    keys: <int, Uint8List>{
      for (final entry in keys.entries)
        if (entry.key != '0') int.parse(entry.key): hex(entry.value! as String),
    },
  );
}

Future<List<String>> _walk(
  RitoReaderSession session,
  int turns, {
  Future<void> Function(RitoPreparedArtifact page)? onPage,
}) async {
  final drawn = <String>[];
  var current = session.firstArtifact;
  for (var turn = 0; turn < turns; turn += 1) {
    final artifact = current.artifact;
    drawn.add(
      '${artifact.locator.href}#${artifact.localPageIndex}:'
      '${artifact.displayList.displayList.commands.length}',
    );
    await onPage?.call(current);
    final next = await session.turn(
      from: current,
      requestId: session.nextRequestId,
      direction: RitoAdjacentDirection.next,
    );
    await session.releaseArtifact(current);
    current = next;
  }
  return drawn;
}

void main() {
  test(
    'a session opened from shards lays every page out without loading a '
    'shard, draws what the archive draws and loads an image when it is read',
    () async {
      final out = Directory.systemTemp.createTempSync('rito-shards-');
      addTearDown(() => out.deleteSync(recursive: true));
      final packed = _pack(out);
      final loads = <List<int>>[];
      final shardGateway = RitoIsolateGateway();
      final archiveGateway = RitoIsolateGateway();
      final sharded = await RitoReaderSession.openShards(
        gateway: shardGateway,
        skeletonBytes: packed.skeleton,
        skeletonKey: packed.key,
        loadShards: (ids) async {
          loads.add(ids);
          return <RitoPublicationShard>[
            for (final id in ids)
              RitoPublicationShard(
                id: id,
                bytes: packed.files[id]!.readAsBytesSync(),
                key: packed.keys[id],
              ),
          ];
        },
        request: _request(9101),
        pinnedFontPolicy: _pinnedPolicy(),
      );
      final archive = await RitoReaderSession.open(
        gateway: archiveGateway,
        publicationBytes: File(_book).readAsBytesSync(),
        request: _request(9102),
        pinnedFontPolicy: _pinnedPolicy(),
      );
      try {
        expect(loads, isEmpty, reason: 'opening never waits on a shard');
        RitoResource? image;
        final shardWalk = await _walk(
          sharded,
          40,
          onPage: (page) async {
            if (image != null) return;
            for (final resource in page.artifact.resources) {
              if (resource.kind != RitoResourceKind.image) continue;
              image = await sharded.readResource(page, resource);
              return;
            }
          },
        );
        final archiveWalk = await _walk(archive, 40);
        expect(shardWalk, archiveWalk);
        expect(
          shardWalk.map((page) => page.split('#').first).toSet().length,
          greaterThan(1),
          reason: 'the walk crossed chapters',
        );
        expect(image, isNotNull, reason: 'the walk reached an image');
        expect(loads, hasLength(1), reason: 'only the image read loaded');
        expect(loads.single, hasLength(1));
      } finally {
        await sharded.dispose();
        await archive.dispose();
        await shardGateway.close();
        await archiveGateway.close();
      }
    },
    timeout: const Timeout(Duration(minutes: 5)),
  );
}
