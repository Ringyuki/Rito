import '../protocol/primitive_models.dart';

/// A renderer of the device-resolved primitive list: it blits what the
/// engine resolved and never measures or snaps.
abstract interface class RitoPrimitiveTarget {
  void save();
  void restore();
  void translate(RitoPrimitiveTranslate primitive);
  void opacity(RitoPrimitiveOpacity primitive);
  void transform(RitoPrimitiveTransform primitive);
  void clipPath(RitoPrimitiveClipPath primitive);
  void fillRect(RitoPrimitiveFillRect primitive);
  void fillPath(RitoPrimitiveFillPath primitive);
  void strokePath(RitoPrimitiveStrokePath primitive);
  void shadow(RitoPrimitiveShadow primitive);
  void drawImage(RitoPrimitiveDrawImage primitive);
  void text(RitoPrimitiveText primitive);
  void ruby(RitoPrimitiveRuby primitive);
  void block(RitoPrimitiveBlock primitive);
}

final class RitoPrimitiveListReplayer {
  const RitoPrimitiveListReplayer();

  void replay(RitoPrimitiveList list, RitoPrimitiveTarget target) {
    var saveDepth = 0;
    try {
      for (final primitive in list.commands) {
        switch (primitive) {
          case RitoPrimitivePushState():
            target.save();
            saveDepth += 1;
          case RitoPrimitivePopState():
            if (saveDepth == 0) {
              throw const FormatException(
                'RITODL1 restore has no matching save.',
              );
            }
            target.restore();
            saveDepth -= 1;
          case RitoPrimitiveTranslate():
            target.translate(primitive);
          case RitoPrimitiveOpacity():
            target.opacity(primitive);
          case RitoPrimitiveTransform():
            target.transform(primitive);
          case RitoPrimitiveClipPath():
            target.clipPath(primitive);
          case RitoPrimitiveFillRect():
            target.fillRect(primitive);
          case RitoPrimitiveFillPath():
            target.fillPath(primitive);
          case RitoPrimitiveStrokePath():
            target.strokePath(primitive);
          case RitoPrimitiveShadow():
            target.shadow(primitive);
          case RitoPrimitiveDrawImage():
            target.drawImage(primitive);
          case RitoPrimitiveText():
            target.text(primitive);
          case RitoPrimitiveRuby():
            target.ruby(primitive);
          case RitoPrimitiveBlock():
            target.block(primitive);
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
