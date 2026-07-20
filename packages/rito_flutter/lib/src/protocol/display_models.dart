import 'display_geometry.dart';
import 'display_paint.dart';

final class RitoDisplayList {
  RitoDisplayList({
    required this.formatVersion,
    required List<RitoCommand> commands,
  }) : commands = List<RitoCommand>.unmodifiable(commands);

  final int formatVersion;
  final List<RitoCommand> commands;

  int get commandCount => commands.length;
}

sealed class RitoCommand {
  const RitoCommand();

  int get opcode;
}

final class RitoPushState extends RitoCommand {
  const RitoPushState();

  @override
  int get opcode => 1;
}

final class RitoPopState extends RitoCommand {
  const RitoPopState();

  @override
  int get opcode => 2;
}

final class RitoTranslate extends RitoCommand {
  const RitoTranslate({required this.dx, required this.dy});

  final double dx;
  final double dy;

  @override
  int get opcode => 3;
}

final class RitoOpacity extends RitoCommand {
  const RitoOpacity(this.value);

  final double value;

  @override
  int get opcode => 4;
}

final class RitoTransform extends RitoCommand {
  RitoTransform({
    required this.origin,
    required this.boxSize,
    required List<RitoTransformOperation> transforms,
  }) : transforms = List<RitoTransformOperation>.unmodifiable(transforms);

  final RitoDisplayPoint origin;
  final RitoDisplaySize boxSize;
  final List<RitoTransformOperation> transforms;

  @override
  int get opcode => 5;
}

final class RitoClipRect extends RitoCommand {
  const RitoClipRect({required this.rect, this.radius});

  final RitoDisplayRect rect;
  final RitoCornerRadius? radius;

  @override
  int get opcode => 6;
}

final class RitoPaintPage extends RitoCommand {
  const RitoPaintPage({required this.rect, required this.paint});

  final RitoDisplayRect rect;
  final RitoPagePaint paint;

  @override
  int get opcode => 7;
}

final class RitoPaintBlock extends RitoCommand {
  const RitoPaintBlock({
    required this.rect,
    required this.paint,
    this.borderBox,
  });

  final RitoDisplayRect rect;
  final RitoBlockPaint paint;
  final RitoBorderBox? borderBox;

  @override
  int get opcode => 8;
}

sealed class RitoTextPaintCommand extends RitoCommand {
  const RitoTextPaintCommand({
    required this.text,
    required this.rect,
    required this.paint,
    this.lineHeightPx,
    this.href,
    this.sourceText,
    this.sourceTextOffset,
  });

  final String text;
  final RitoDisplayRect rect;
  final RitoRunPaint paint;
  final double? lineHeightPx;
  final String? href;
  final String? sourceText;
  final int? sourceTextOffset;
}

final class RitoPaintText extends RitoTextPaintCommand {
  const RitoPaintText({
    required super.text,
    required super.rect,
    required super.paint,
    super.lineHeightPx,
    super.href,
    super.sourceText,
    super.sourceTextOffset,
  });

  @override
  int get opcode => 9;
}

final class RitoPaintRuby extends RitoTextPaintCommand {
  const RitoPaintRuby({
    required super.text,
    required super.rect,
    required super.paint,
    super.lineHeightPx,
    super.href,
    super.sourceText,
    super.sourceTextOffset,
  });

  @override
  int get opcode => 10;
}

final class RitoPaintImage extends RitoCommand {
  const RitoPaintImage({
    required this.src,
    required this.rect,
    this.alt,
    this.href,
  });

  final String src;
  final RitoDisplayRect rect;
  final String? alt;
  final String? href;

  @override
  int get opcode => 11;
}

final class RitoPaintHorizontalRule extends RitoCommand {
  const RitoPaintHorizontalRule({required this.rect, required this.paint});

  final RitoDisplayRect rect;
  final RitoHorizontalRulePaint paint;

  @override
  int get opcode => 12;
}
