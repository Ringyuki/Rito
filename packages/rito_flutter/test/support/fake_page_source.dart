import 'dart:async';

import 'package:rito_flutter/rito_flutter.dart';
import 'package:rito_flutter/rito_flutter_native.dart' show RitoArtifactDecoder;
import 'package:rito_flutter/src/reader/page_source.dart';

import 'artifact_fixture.dart';

const fakeLayout = RitoLayoutRequest(
  viewportWidth: 360,
  viewportHeight: 640,
  marginTop: 24,
  marginRight: 24,
  marginBottom: 24,
  marginLeft: 24,
  spreadMode: RitoSpreadMode.single,
  firstPageAlone: true,
  spreadGap: 0,
  rootFontSize: 16,
);

/// A page source whose pages are fixture artifacts, numbered from 1.
final class FakePageSource implements RitoPageSource {
  FakePageSource({
    int firstNextAvailability = 0,
    this.paginationSteps = 0,
    this.failPagination = false,
  }) : firstPage = fakePage(1, nextAvailability: firstNextAvailability);

  @override
  final RitoPreparedArtifact firstPage;
  final int paginationSteps;
  final bool failPagination;
  final Completer<void> gate = Completer<void>();
  final List<int> released = <int>[];
  final List<String> seeks = <String>[];

  /// A turn waits for this while it is set.
  Completer<void>? turnGate;
  bool failTurn = false;
  final List<String> turns = <String>[];
  int peeks = 0;
  int paginations = 0;
  int _nextId = 2;
  final Map<(int, String), RitoPreparedArtifact> _peeked = {};

  @override
  Future<RitoPreparedArtifact?> peek(
    RitoPreparedArtifact from,
    RitoAdjacentDirection direction,
  ) async {
    peeks += 1;
    return _peeked[(from.artifactId, direction.name)] = fakePage(_nextId++);
  }

  // Like the session, a turn lands on the page peeked from the same page in
  // the same direction.
  @override
  Future<RitoPreparedArtifact> turn(
    RitoPreparedArtifact from,
    RitoAdjacentDirection direction,
  ) async {
    turns.add(direction.name);
    await turnGate?.future;
    if (failTurn) throw StateError('turn failed');
    return _peeked[(from.artifactId, direction.name)] ?? fakePage(_nextId++);
  }

  @override
  Future<RitoPreparedArtifact> seek(
    RitoLayoutRequest layout,
    RitoLocator locator,
  ) async {
    seeks.add(locator.href);
    return fakePage(_nextId++, href: locator.href);
  }

  @override
  Future<RitoPaginationStep> paginate(
    RitoPreparedArtifact visible,
    int quantum,
  ) async {
    if (failPagination) throw StateError('pagination failed');
    paginations += 1;
    final complete = paginations >= paginationSteps;
    final adopt = complete && paginationSteps > 0;
    return (complete: complete, adopted: adopt ? fakePage(_nextId++) : null);
  }

  @override
  Future<void> release(RitoPreparedArtifact page) async {
    released.add(page.artifactId);
  }
}

RitoPreparedArtifact fakePage(
  int id, {
  int nextAvailability = 0,
  String href = 'chapter-4.xhtml',
}) => RitoPreparedArtifact.forTest(
  RitoArtifactDecoder().decode(
    artifactFixture(
      artifactId: id,
      nextAvailability: nextAvailability,
      locatorHref: href,
    ),
  ),
);
