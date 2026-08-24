import 'dart:ui' as ui;

/// Resolves only caller-owned, already-decoded resources. The renderer never
/// performs network or filesystem I/O.
typedef RitoImageResolver = ui.Image? Function(String href);
