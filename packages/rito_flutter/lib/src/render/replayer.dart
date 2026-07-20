import '../protocol/display_models.dart';

abstract interface class RitoPaintTarget {
  void save();
  void restore();
  void translate(RitoTranslate command);
  void opacity(RitoOpacity command);
  void transform(RitoTransform command);
  void clipRect(RitoClipRect command);
  void paintPage(RitoPaintPage command);
  void paintBlock(RitoPaintBlock command);
  void paintText(RitoPaintText command);
  void paintRuby(RitoPaintRuby command);
  void paintImage(RitoPaintImage command);
  void paintHorizontalRule(RitoPaintHorizontalRule command);
}

final class RitoDisplayListReplayer {
  const RitoDisplayListReplayer();

  void replay(RitoDisplayList displayList, RitoPaintTarget target) {
    var saveDepth = 0;
    try {
      for (final command in displayList.commands) {
        switch (command) {
          case RitoPushState():
            target.save();
            saveDepth += 1;
          case RitoPopState():
            if (saveDepth == 0) {
              throw const FormatException(
                'RITODL1 restore has no matching save.',
              );
            }
            target.restore();
            saveDepth -= 1;
          case RitoTranslate():
            target.translate(command);
          case RitoOpacity():
            target.opacity(command);
          case RitoTransform():
            target.transform(command);
          case RitoClipRect():
            target.clipRect(command);
          case RitoPaintPage():
            target.paintPage(command);
          case RitoPaintBlock():
            target.paintBlock(command);
          case RitoPaintText():
            target.paintText(command);
          case RitoPaintRuby():
            target.paintRuby(command);
          case RitoPaintImage():
            target.paintImage(command);
          case RitoPaintHorizontalRule():
            target.paintHorizontalRule(command);
        }
      }
      if (saveDepth != 0) {
        throw FormatException('RITODL1 leaves $saveDepth save states open.');
      }
    } finally {
      while (saveDepth > 0) {
        target.restore();
        saveDepth -= 1;
      }
    }
  }
}
