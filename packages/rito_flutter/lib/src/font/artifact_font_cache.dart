import 'dart:ui' as ui;

import 'dart:async';
import 'dart:collection';

import 'package:flutter/services.dart';

import '../image/artifact_image_cache.dart';
import '../protocol/artifact_models.dart';

typedef RitoFontResourceReader =
    Future<RitoResource> Function(RitoResourceRef reference);

const int _fontPrepareConcurrency = 4;

/// Registers an EPUB font with the Flutter engine on the UI isolate.
abstract interface class RitoFontRegistrar {
  Future<void> register(RitoFontRef font, Uint8List bytes);
}

final class RitoFlutterFontRegistrar implements RitoFontRegistrar {
  const RitoFlutterFontRegistrar();

  @override
  Future<void> register(RitoFontRef font, Uint8List bytes) async {
    if (_isWoff(bytes)) {
      throw UnsupportedError(
        'Flutter FontLoader accepts OTF/TTF bytes, but ${font.href} is WOFF. '
        'Provide a transcoding RitoFontRegistrar or native SFNT bytes.',
      );
    }
    final loader = FontLoader(font.family)
      ..addFont(Future<ByteData>.value(ByteData.sublistView(bytes)));
    await loader.load();
  }

  bool _isWoff(Uint8List bytes) {
    if (bytes.length < 4) {
      return false;
    }
    return bytes[0] == 0x77 &&
        bytes[1] == 0x4f &&
        bytes[2] == 0x46 &&
        (bytes[3] == 0x46 || bytes[3] == 0x32);
  }
}

/// An artifact whose declared font faces have completed Flutter registration.
///
/// The private constructor prevents a page surface from being created from a
/// decoded-but-unprepared artifact.
final class RitoPreparedArtifact {
  const RitoPreparedArtifact._(this.artifact, [this._imageLease]);

  final RitoArtifact artifact;
  final RitoArtifactImageLease? _imageLease;

  int get sessionId => artifact.sessionId;
  int get requestId => artifact.requestId;
  int get artifactId => artifact.artifactId;
  List<RitoResourceRef> get resources => artifact.resources;
  List<RitoFontRef> get fonts => artifact.fonts;

  bool get hasPreparedImages => _imageLease != null;

  ui.Image resolveImage(String href) {
    final lease = _imageLease;
    if (lease == null) {
      throw StateError('Artifact images were not prepared by this session.');
    }
    return lease.resolveImage(href);
  }

  factory RitoPreparedArtifact.withImageLease({
    required RitoPreparedArtifact fontPrepared,
    required RitoArtifactImageLease imageLease,
  }) {
    if (fontPrepared._imageLease != null) {
      throw StateError('Prepared artifact already owns an image lease.');
    }
    if (fontPrepared.sessionId != imageLease.sessionId ||
        fontPrepared.artifactId != imageLease.artifactId) {
      throw ArgumentError('Image lease identity does not match the artifact.');
    }
    return RitoPreparedArtifact._(fontPrepared.artifact, imageLease);
  }
}

/// Process-wide cache for Flutter font registrations.
///
/// Flutter does not expose an unload operation for dynamically registered
/// fonts. Keeping the successful registration cache process-wide prevents the
/// same immutable face from being registered repeatedly across artifacts and
/// sessions. Failed entries are removed so a later artifact can retry.
final class RitoArtifactFontCache {
  RitoArtifactFontCache({RitoFontRegistrar? registrar})
    : _registrar = registrar ?? const RitoFlutterFontRegistrar();

  static final RitoArtifactFontCache shared = RitoArtifactFontCache();

  final RitoFontRegistrar _registrar;
  final _AsyncWorkLimiter _prepareLimiter = _AsyncWorkLimiter(
    _fontPrepareConcurrency,
  );
  final Map<({String family, String fingerprint}), _FontLoadEntry> _loads =
      <({String family, String fingerprint}), _FontLoadEntry>{};

  Future<RitoPreparedArtifact> prepare({
    required RitoArtifact artifact,
    required RitoFontResourceReader readResource,
  }) async {
    _validateDeclarations(artifact);
    final resourceReads = <String, Future<RitoResource>>{};
    Future<RitoResource> readFont(RitoFontRef font) {
      return resourceReads.putIfAbsent(
        font.href,
        () => Future<RitoResource>.sync(
          () => readResource(
            RitoResourceRef(kind: RitoResourceKind.font, href: font.href),
          ),
        ),
      );
    }

    await Future.wait<void>(
      artifact.fonts.map(
        (font) => _prepareLimiter.run<void>(
          () => _ensureRegistered(artifact, font, () => readFont(font)),
        ),
      ),
    );
    return RitoPreparedArtifact._(artifact);
  }

  Future<void> _ensureRegistered(
    RitoArtifact artifact,
    RitoFontRef font,
    Future<RitoResource> Function() readResource,
  ) {
    final key = (family: font.family, fingerprint: font.shapeFingerprint);
    final existing = _loads[key];
    if (existing != null) {
      if (existing.byteLength != font.byteLength) {
        return Future<void>.error(
          FormatException(
            'Conflicting byte lengths for font ${font.family} '
            '(${font.shapeFingerprint}).',
          ),
        );
      }
      if (existing.isLoaded) {
        return Future<void>.value();
      }
      return _waitFor(key, existing, existing.future!);
    }
    final entry = _FontLoadEntry(
      byteLength: font.byteLength,
      future: _register(artifact, font, readResource),
    );
    _loads[key] = entry;
    return _waitFor(key, entry, entry.future!);
  }

  Future<void> _register(
    RitoArtifact artifact,
    RitoFontRef font,
    Future<RitoResource> Function() readResource,
  ) async {
    final resource = await readResource();
    if (resource.artifactId != artifact.artifactId ||
        resource.kind != RitoResourceKind.font ||
        resource.href != font.href) {
      throw StateError('Font resource ownership does not match its artifact.');
    }
    if (resource.bytes.length != font.byteLength) {
      throw FormatException(
        'Font ${font.family} declared ${font.byteLength} bytes but received '
        '${resource.bytes.length}.',
      );
    }
    await _registrar.register(font, resource.bytes);
  }

  Future<void> _waitFor(
    ({String family, String fingerprint}) key,
    _FontLoadEntry entry,
    Future<void> future,
  ) async {
    try {
      await future;
      if (identical(_loads[key], entry)) {
        entry.markLoaded();
      }
    } on Object {
      if (identical(_loads[key], entry)) {
        _loads.remove(key);
      }
      rethrow;
    }
  }

  void _validateDeclarations(RitoArtifact artifact) {
    final resourceHrefs = artifact.resources
        .where((resource) => resource.kind == RitoResourceKind.font)
        .map((resource) => resource.href)
        .toSet();
    final declarations = <({String family, String fingerprint}), RitoFontRef>{};
    for (final font in artifact.fonts) {
      if (font.family.isEmpty ||
          font.href.isEmpty ||
          font.shapeFingerprint.isEmpty ||
          font.byteLength <= 0) {
        throw const FormatException('Artifact contains an invalid font face.');
      }
      if (!resourceHrefs.contains(font.href)) {
        throw FormatException(
          'Artifact font ${font.family} does not have a font resource.',
        );
      }
      final key = (family: font.family, fingerprint: font.shapeFingerprint);
      final previous = declarations[key];
      if (previous != null && previous.byteLength != font.byteLength) {
        throw FormatException(
          'Artifact contains conflicting declarations for ${font.family}.',
        );
      }
      declarations[key] = font;
    }
  }
}

final class _FontLoadEntry {
  _FontLoadEntry({required this.byteLength, required this.future});

  final int byteLength;
  Future<void>? future;
  bool isLoaded = false;

  void markLoaded() {
    future = null;
    isLoaded = true;
  }
}

final class _AsyncWorkLimiter {
  _AsyncWorkLimiter(this.limit);

  final int limit;
  final Queue<Future<void> Function()> _queue = Queue<Future<void> Function()>();
  int _active = 0;

  Future<T> run<T>(Future<T> Function() task) {
    final completion = Completer<T>();
    _queue.add(() async {
      try {
        completion.complete(await task());
      } on Object catch (error, stackTrace) {
        completion.completeError(error, stackTrace);
      } finally {
        _active -= 1;
        _drain();
      }
    });
    _drain();
    return completion.future;
  }

  void _drain() {
    while (_active < limit && _queue.isNotEmpty) {
      _active += 1;
      unawaited(_queue.removeFirst()());
    }
  }
}
