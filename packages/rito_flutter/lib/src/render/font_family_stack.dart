/// Parses the CSS font-family stack the engine paints runs with.
///
/// A run's `font.family` is a comma-joined CSS family list (see the
/// engine's `paint_family_stack`): resolvable named families — possibly
/// quoted with `\\` and `\"` escapes — then the pinned-face aliases,
/// then a generic keyword tail. The browser pen hands the whole string
/// to the canvas `font` shorthand, which resolves the fallback chain
/// natively; Flutter's `TextStyle.fontFamily` is a single literal name,
/// so the Flutter pen must split the stack itself and ride the rest in
/// `fontFamilyFallback`. Generic CSS keywords (`serif`, …) have no
/// Flutter meaning and simply never match, which mirrors the canvas
/// falling through to the renderer default.
List<String> ritoSplitFontFamilyStack(String stack) {
  final families = <String>[];
  final current = StringBuffer();
  var inQuotes = false;
  var index = 0;
  while (index < stack.length) {
    final char = stack[index];
    if (inQuotes) {
      if (char == r'\' && index + 1 < stack.length) {
        current.write(stack[index + 1]);
        index += 2;
        continue;
      }
      if (char == '"') {
        inQuotes = false;
        index += 1;
        continue;
      }
      current.write(char);
      index += 1;
      continue;
    }
    if (char == '"') {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (char == ',') {
      _flushFamily(current, families);
      index += 1;
      continue;
    }
    current.write(char);
    index += 1;
  }
  _flushFamily(current, families);
  return families;
}

void _flushFamily(StringBuffer current, List<String> families) {
  final name = current.toString().trim();
  current.clear();
  if (name.isNotEmpty) {
    families.add(name);
  }
}
