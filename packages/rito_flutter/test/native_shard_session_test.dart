import 'dart:async';
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

/// Packs the fixture with the engine's own packing, through the test
/// packer in `crates/rito-pack/examples`: `<id>.rshd` and `<id>.key` for
/// every shard, the skeleton being shard 0.
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
    '--example',
    'test_shards',
    '--',
    File(_book).absolute.path,
    out.path,
  ], workingDirectory: '../..');
  expect(packed.exitCode, 0, reason: '${packed.stderr}');
  final ids = <int>[
    for (final entry in out.listSync())
      if (entry.path.endsWith('.rshd'))
        int.parse(entry.uri.pathSegments.last.split('.').first),
  ]..sort();
  Uint8List keyOf(int id) => File('${out.path}/$id.key').readAsBytesSync();
  return (
    skeleton: File('${out.path}/0.rshd').readAsBytesSync(),
    key: keyOf(0),
    files: <int, File>{
      for (final id in ids)
        if (id != 0) id: File('${out.path}/$id.rshd'),
    },
    keys: <int, Uint8List>{
      for (final id in ids)
        if (id != 0) id: keyOf(id),
    },
  );
}

Future<List<String>> _walk(
  RitoReaderSession session,
  int turns, {
  bool Function(RitoPreparedArtifact page)? keep,
}) async {
  final drawn = <String>[];
  var current = session.firstArtifact;
  for (var turn = 0; turn < turns; turn += 1) {
    final artifact = current.artifact;
    drawn.add(
      '${artifact.locator.href}#${artifact.localPageIndex}:'
      '${artifact.displayList.displayList.commands.length}',
    );
    final kept = keep?.call(current) ?? false;
    final next = await session.turn(
      from: current,
      requestId: session.nextRequestId,
      direction: RitoAdjacentDirection.next,
    );
    if (!kept) {
      await session.releaseArtifact(current);
    }
    current = next;
  }
  return drawn;
}

void main() {
  test(
    'a session opened from shards opens and turns while no shard can arrive, '
    'draws what the archive draws, and supplies every image ahead of need',
    () async {
      final out = Directory.systemTemp.createTempSync('rito-shards-');
      addTearDown(() => out.deleteSync(recursive: true));
      final packed = _pack(out);
      final loads = <List<int>>[];
      final network = Completer<void>();
      final shardGateway = RitoIsolateGateway();
      final archiveGateway = RitoIsolateGateway();
      final sharded = await RitoReaderSession.openShards(
        gateway: shardGateway,
        skeletonBytes: packed.skeleton,
        skeletonKey: packed.key,
        loadShards: (ids) async {
          loads.add(ids);
          await network.future;
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
        // No shard can arrive yet: opening and every turn still complete.
        RitoPreparedArtifact? imagePage;
        final shardWalk = await _walk(
          sharded,
          40,
          keep: (page) {
            if (imagePage != null ||
                !page.artifact.resources.any(
                  (resource) => resource.kind == RitoResourceKind.image,
                )) {
              return false;
            }
            imagePage = page;
            return true;
          },
        );
        final archiveWalk = await _walk(archive, 40);
        expect(shardWalk, archiveWalk);
        expect(
          shardWalk.map((page) => page.split('#').first).toSet().length,
          greaterThan(1),
          reason: 'the walk crossed chapters',
        );
        expect(
          loads,
          hasLength(1),
          reason: 'ahead-of-need supply asks for one shard at a time',
        );

        network.complete();
        for (var tick = 0; tick < 500; tick += 1) {
          if (loads.length >= packed.files.length) break;
          await Future<void>.delayed(const Duration(milliseconds: 10));
        }
        final requested = loads.expand((ids) => ids).toList();
        expect(requested.toSet(), packed.files.keys.toSet());
        expect(requested, hasLength(packed.files.length), reason: 'each once');

        final loadsBeforeRead = loads.length;
        final page = imagePage;
        expect(page, isNotNull, reason: 'the walk reached an image');
        final reference = page!.artifact.resources.firstWhere(
          (resource) => resource.kind == RitoResourceKind.image,
        );
        final image = await sharded.readResource(page, reference);
        expect(image.bytes, isNotEmpty);
        expect(
          loads,
          hasLength(loadsBeforeRead),
          reason: 'the image was supplied before it was read',
        );
        await sharded.releaseArtifact(page);
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
