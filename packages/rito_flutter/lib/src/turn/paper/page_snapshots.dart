import 'dart:ui' as ui;

/// The pages as the GPU samples them: the texture each page image was
/// drawn into, shared with the image, not a pixel of it copied. An image
/// just made has none until the raster thread has drawn it, a moment
/// later; until then its page is sampled from the texture the page was
/// last sampled from. A page is known by its spread, which it keeps from
/// one turn to the next whatever image or artifact shows it.
final class PaperPageSnapshots<T extends Object> {
  PaperPageSnapshots({required this.share, required this.onGivenUp});

  /// The texture [image] was drawn into, shared; throws while the image has
  /// none.
  final T Function(ui.Image image) share;

  /// How many times an image is asked for its texture before it is taken
  /// to have none to share: about once a frame, two seconds at 60 Hz.
  static const int patience = 120;

  /// Called once an image has been asked for its texture [patience] times
  /// and still has none: the turns that need it are drawn without it.
  final void Function(Object error, StackTrace stack) onGivenUp;

  final _shared = Expando<T>();
  final _asked = Expando<int>();
  final _givenUp = Expando<bool>();

  /// The texture each spread was last sampled from.
  final _lastOf = <int, T>{};

  /// The texture [image] of the page [spread] is sampled from: its own once
  /// the raster thread has drawn it, before that the page's last one; null
  /// while there is neither.
  T? of(ui.Image image, int? spread) {
    final shared = _sharedOf(image);
    if (spread == null) return shared;
    if (shared != null) return _lastOf[spread] = shared;
    return _lastOf[spread];
  }

  /// Lets go of the textures of every page but [spreads].
  void keepOnly(Iterable<int?> spreads) {
    final kept = spreads.toSet();
    _lastOf.removeWhere((spread, _) => !kept.contains(spread));
  }

  /// Whether [image] will never have a texture to share.
  bool hasNone(ui.Image image) => _givenUp[image] ?? false;

  T? _sharedOf(ui.Image image) {
    final shared = _shared[image];
    if (shared != null || hasNone(image)) return shared;
    try {
      return _shared[image] = share(image);
    } on Exception catch (error, stack) {
      // Not drawn yet: asked again later, but not for ever.
      final asked = (_asked[image] ?? 0) + 1;
      _asked[image] = asked;
      if (asked >= patience) {
        _givenUp[image] = true;
        onGivenUp(error, stack);
      }
      return null;
    }
  }
}
