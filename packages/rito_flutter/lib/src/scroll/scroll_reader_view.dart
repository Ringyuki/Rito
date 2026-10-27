import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';

import '../protocol/revision_layout.dart';
import '../render/page_surface.dart';
import 'scroll_reader_controller.dart';
import 'scroll_windows.dart';

/// A scrolled reader: the book's windows end to end, down the screen or
/// leftwards for a book that scrolls leftwards, in a scrollable that moves
/// by [physics] (the platform's by default) — an app gives its own physics,
/// or drives [scrollController] itself.
final class RitoScrollReaderView extends StatefulWidget {
  const RitoScrollReaderView({
    required this.controller,
    this.physics,
    this.scrollController,
    this.colorOverride,
    this.loadingColor = const Color(0xFFFFFFFF),
    super.key,
  });

  final RitoScrollReaderController controller;
  final ScrollPhysics? physics;

  /// The strip's scroll position, in logical pixels from the book's block
  /// start; the view makes its own when none is given.
  final ScrollController? scrollController;

  /// Optional host theme (dark/sepia). See [RitoCanvasColorOverride].
  final RitoCanvasColorOverride? colorOverride;

  /// What a window shows while it loads.
  final Color loadingColor;

  @override
  State<RitoScrollReaderView> createState() => _RitoScrollReaderViewState();
}

final class _RitoScrollReaderViewState extends State<RitoScrollReaderView> {
  ScrollController? _owned;
  RitoScrollWindows? _shown;

  ScrollController get _scroll =>
      widget.scrollController ?? (_owned ??= ScrollController());

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_changed);
    _scroll.addListener(_moved);
    _shown = widget.controller.windows;
  }

  @override
  void dispose() {
    widget.controller.removeListener(_changed);
    _scroll.removeListener(_moved);
    _owned?.dispose();
    super.dispose();
  }

  void _moved() {
    widget.controller.read(_scroll.offset * widget.controller.devicePixelRatio);
  }

  /// New windows (the whole book's after the chapter's) keep the reading
  /// line on the window it was in, as far into it as it was.
  void _changed() {
    final windows = widget.controller.windows;
    final shown = _shown;
    if (!identical(windows, shown) && windows != null) {
      final ratio = widget.controller.devicePixelRatio;
      final line = widget.controller.readingLine;
      final before = _scroll.hasClients && shown != null
          ? _scroll.offset * ratio + line
          : null;
      final into = before == null
          ? 0.0
          : before - (shown!.windowAt(before)?.start ?? 0);
      final reading = windows.windows.where(
        (window) => window.spreadIndex == widget.controller.readingSpread,
      );
      _shown = windows;
      if (reading.isNotEmpty) {
        final target = (reading.first.start + into - line) / ratio;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (_scroll.hasClients)
            _scroll.jumpTo(target.clamp(0, double.infinity));
        });
      }
    }
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final windows = widget.controller.windows;
    if (windows == null) return ColoredBox(color: widget.loadingColor);
    final ratio = windows.ratio;
    final down = windows.axis == RitoScrollAxis.down;
    return CustomScrollView(
      controller: _scroll,
      physics: widget.physics,
      scrollDirection: down ? Axis.vertical : Axis.horizontal,
      reverse: !down,
      slivers: <Widget>[
        SliverVariedExtentList.builder(
          itemCount: windows.windows.length,
          itemExtentBuilder: (index, _) {
            if (index >= windows.windows.length) return null;
            return windows.windows[index].length / ratio;
          },
          itemBuilder: (context, index) {
            final window = windows.windows[index];
            final artifact = widget.controller.windowArtifact(
              window.spreadIndex,
            );
            return _DeviceGridSnap(
              ratio: ratio,
              child: artifact == null
                  ? ColoredBox(color: widget.loadingColor)
                  : ClipRect(
                      child: CustomPaint(
                        painter: RitoArtifactPainter(
                          artifact: artifact,
                          resolveImage: artifact.resolveImage,
                          colorOverride: widget.colorOverride,
                        ),
                      ),
                    ),
            );
          },
        ),
      ],
    );
  }
}

/// Paints its child on the device grid: windows are pictures resolved on
/// that grid, and the scroll position is anywhere between its pixels.
final class _DeviceGridSnap extends SingleChildRenderObjectWidget {
  const _DeviceGridSnap({required this.ratio, super.child});

  final double ratio;

  @override
  RenderObject createRenderObject(BuildContext context) =>
      _RenderDeviceGridSnap(ratio);

  @override
  void updateRenderObject(
    BuildContext context,
    _RenderDeviceGridSnap renderObject,
  ) {
    renderObject.ratio = ratio;
  }
}

final class _RenderDeviceGridSnap extends RenderProxyBox {
  _RenderDeviceGridSnap(this._ratio);

  double _ratio;

  set ratio(double value) {
    if (value == _ratio) return;
    _ratio = value;
    markNeedsPaint();
  }

  @override
  void paint(PaintingContext context, Offset offset) {
    final child = this.child;
    if (child == null) return;
    double snap(double value) => (value * _ratio).roundToDouble() / _ratio;
    context.paintChild(child, Offset(snap(offset.dx), snap(offset.dy)));
  }
}
