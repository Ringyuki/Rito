import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/src/render/font_family_stack.dart';

void main() {
  test('splits the engine paint stack into literal family names', () {
    expect(
      ritoSplitFontFamilyStack('xinyalan, __RitoPinned_abc123, serif'),
      <String>['xinyalan', '__RitoPinned_abc123', 'serif'],
    );
  });

  test('unquotes CSS-quoted names and keeps quoted commas intact', () {
    expect(ritoSplitFontFamilyStack('"No, Such", "Tinos", serif'), <String>[
      'No, Such',
      'Tinos',
      'serif',
    ]);
  });

  test('unescapes quoted backslashes and quotes', () {
    expect(ritoSplitFontFamilyStack(r'"say \"hi\"", "a\\b", serif'), <String>[
      'say "hi"',
      r'a\b',
      'serif',
    ]);
  });

  test('drops empty segments and trims whitespace', () {
    expect(ritoSplitFontFamilyStack('  Tinos , ,serif '), <String>[
      'Tinos',
      'serif',
    ]);
    expect(ritoSplitFontFamilyStack(''), isEmpty);
  });
}
