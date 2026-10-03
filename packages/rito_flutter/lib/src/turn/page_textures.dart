import 'dart:ui' as ui;

import 'package:flutter/painting.dart';

import '../font/artifact_font_cache.dart';
import '../render/page_surface.dart';
import 'effects.dart';

/// Paints one page onto a turn texture at logical size [size], over the
/// paper colour already filled in. The default replays the artifact; a
/// host adds what it draws over its pages (highlights, a theme) here.
typedef RitoPagePainter =
    void Function(Canvas canvas, Size size, RitoPreparedArtifact page);

void ritoPaintArtifactPage(
  Canvas canvas,
  Size size,
  RitoPreparedArtifact page,
) {
  RitoArtifactPainter(
    artifact: page,
    resolveImage: page.resolveImage,
  ).paint(canvas, size);
}

/// The page images of a turn, one per slot. A page is rasterized when it is
/// first drawn and again whenever its images change (one landing late), so
/// a turn never shows a stale page.
final class RitoPageTextures implements RitoPageTurnPages {
  RitoPageTextures({required RitoPagePainter painter, required this.onChanged})
    : _painter = painter;

  /// Called when a texture must be drawn again.
  final VoidCallback onChanged;

  final Map<RitoPageSlot, _Texture> _slots = {};
  RitoPagePainter _painter;
  double _pixelRatio = 1;
  Color _background = const Color(0xFFFFFFFF);

  @override
  double get pixelRatio => _pixelRatio;

  Color get background => _background;

  /// Changes how pages are rasterized; every texture is redrawn.
  void configure({
    double? pixelRatio,
    Color? background,
    RitoPagePainter? painter,
  }) {
    final changed =
        (pixelRatio != null && pixelRatio != _pixelRatio) ||
        (background != null && background != _background) ||
        (painter != null && painter != _painter);
    _pixelRatio = pixelRatio ?? _pixelRatio;
    _background = background ?? _background;
    _painter = painter ?? _painter;
    if (changed) invalidate();
  }

  /// The page assigned to [slot], if any.
  RitoPreparedArtifact? page(RitoPageSlot slot) => _slots[slot]?.page;

  /// Puts [page] in [slot]. A page arriving while a turn already shows its
  /// slot fades in ([reveal]); otherwise it appears at once.
  void assign(
    RitoPageSlot slot,
    RitoPreparedArtifact? page, {
    bool reveal = false,
  }) {
    final current = _slots[slot];
    if (identical(current?.page, page)) return;
    current?.dispose();
    if (page == null) {
      _slots.remove(slot);
      return;
    }
    _slots[slot] = _Texture(page, onChanged, revealed: reveal ? 0 : 1);
    onChanged();
  }

  /// Moves the texture in [from] to [to] (a landed turn: the incoming page
  /// becomes the current one without being rasterized again).
  void move(RitoPageSlot from, RitoPageSlot to) {
    final texture = _slots.remove(from);
    _slots.remove(to)?.dispose();
    if (texture != null) _slots[to] = texture..revealed = 1;
  }

  /// Rasterizes [slot] now if it is not, and keeps that image from then on:
  /// its page is about to be released, and a released page cannot be
  /// painted again.
  void freeze(RitoPageSlot slot) {
    final texture = _slots[slot];
    if (texture == null) return;
    texture.image(_pixelRatio, _background, _painter);
    texture.freeze();
  }

  /// Advances late pages' fade-in by [seconds]; true while any still fades.
  bool advanceReveal(double seconds) {
    var fading = false;
    for (final texture in _slots.values) {
      if (texture.revealed >= 1) continue;
      texture.revealed = (texture.revealed + seconds / 0.2).clamp(0.0, 1.0);
      fading = fading || texture.revealed < 1;
    }
    return fading;
  }

  /// Redraws every texture on its next use.
  void invalidate() {
    for (final texture in _slots.values) {
      texture.markDirty();
    }
    onChanged();
  }

  void clear({Set<RitoPageSlot> except = const {}}) {
    for (final slot in RitoPageSlot.values) {
      if (except.contains(slot)) continue;
      _slots.remove(slot)?.dispose();
    }
  }

  @override
  ui.Image? image(RitoPageSlot slot) {
    final texture = _slots[slot];
    if (texture == null) return null;
    return texture.image(_pixelRatio, _background, _painter);
  }

  @override
  double reveal(RitoPageSlot slot) => _slots[slot]?.revealed ?? 1;

  void dispose() => clear();
}

final class _Texture {
  _Texture(this.page, this._onChanged, {required this.revealed}) {
    page.imageChanges?.addListener(_imagesChanged);
  }

  final RitoPreparedArtifact page;
  final VoidCallback _onChanged;
  double revealed;
  ui.Image? _image;
  bool _dirty = true;
  bool _frozen = false;

  ui.Image image(double pixelRatio, Color background, RitoPagePainter paint) {
    final cached = _image;
    if (cached != null && !_dirty) return cached;
    final size = Size(page.artifact.width, page.artifact.height);
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder)
      ..scale(pixelRatio)
      ..drawRect(Offset.zero & size, Paint()..color = background);
    paint(canvas, size, page);
    final picture = recorder.endRecording();
    final image = picture.toImageSync(
      (size.width * pixelRatio).ceil(),
      (size.height * pixelRatio).ceil(),
    );
    picture.dispose();
    cached?.dispose();
    _image = image;
    _dirty = false;
    return image;
  }

  void markDirty() {
    if (!_frozen) _dirty = true;
  }

  void freeze() {
    _frozen = true;
    page.imageChanges?.removeListener(_imagesChanged);
  }

  void _imagesChanged() {
    _dirty = true;
    _onChanged();
  }

  void dispose() {
    page.imageChanges?.removeListener(_imagesChanged);
    _image?.dispose();
    _image = null;
  }
}
