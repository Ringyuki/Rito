import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter_protocol.dart';

RitoHitEntry _hit(
  String text, {
  required double x,
  required double y,
  required double width,
  double height = 20,
  String? href,
  String? imageSrc,
  String? imageAlt,
  String? footnoteKey,
  bool footnotePending = false,
}) {
  return RitoHitEntry(
    pageIndex: 0,
    bounds: RitoRect(x: x, y: y, width: width, height: height),
    text: text,
    href: href,
    imageSrc: imageSrc,
    imageAlt: imageAlt,
    footnoteKey: footnoteKey,
    footnotePending: footnotePending,
  );
}

RitoHitResolver _resolver(List<RitoHitEntry> hits) {
  return RitoHitResolver([
    RitoPage(
      pageIndex: 0,
      width: 400,
      height: 800,
      hits: hits,
      semantics: const [],
      text: hits.map((hit) => hit.text).join(),
      textLength: hits.fold(0, (sum, hit) => sum + hit.text.length),
      textRuns: const [],
    ),
  ]);
}

void main() {
  test('a link run resolves with the label of every contiguous run', () {
    final resolver = _resolver([
      _hit('read ', x: 40, y: 300, width: 40),
      _hit('the ', x: 80, y: 300, width: 40, href: 'Text/ch2.xhtml'),
      _hit('chapter', x: 120, y: 300, width: 80, href: 'Text/ch2.xhtml'),
      _hit(' now', x: 200, y: 300, width: 40),
    ]);
    final target = resolver.resolve(x: 150, y: 310);
    expect(target, isA<RitoTapLink>());
    target as RitoTapLink;
    expect(target.href, 'Text/ch2.xhtml');
    expect(target.label, 'the chapter');
  });

  test(
    'a note anchor resolves as a footnote with its key and pending state',
    () {
      final resolver = _resolver([
        _hit(
          '注',
          x: 96,
          y: 300,
          width: 40,
          href: '#note1',
          footnoteKey: 'Text/Section001.xhtml#note1',
          footnotePending: true,
        ),
      ]);
      final target = resolver.resolve(x: 120, y: 310);
      expect(target, isA<RitoTapFootnote>());
      target as RitoTapFootnote;
      expect(target.key, 'Text/Section001.xhtml#note1');
      expect(target.pending, isTrue);
      expect(target.label, '注');
    },
  );

  test('link slack widens a text band sideways only', () {
    final resolver = _resolver([
      _hit('注', x: 100, y: 300, width: 20, href: '#note9'),
    ]);
    expect(resolver.resolve(x: 97, y: 310, linkSlack: 4), isA<RitoTapLink>());
    expect(resolver.resolve(x: 123, y: 310, linkSlack: 4), isA<RitoTapLink>());
    expect(resolver.resolve(x: 95, y: 310, linkSlack: 4), isNull);
    expect(resolver.resolve(x: 110, y: 322, linkSlack: 4), isNull);
    expect(resolver.resolve(x: 97, y: 310), isNull);
  });

  test('an image inside a link resolves as the link with exact bounds', () {
    final resolver = _resolver([
      _hit(
        '',
        x: 50,
        y: 100,
        width: 120,
        height: 160,
        href: '#intro',
        imageSrc: 'Images/cover.png',
        imageAlt: 'linked cover',
      ),
    ]);
    final target = resolver.resolve(x: 100, y: 180, linkSlack: 4);
    expect(target, isA<RitoTapLink>());
    expect((target as RitoTapLink).label, isNull);
    expect(resolver.resolve(x: 48, y: 180, linkSlack: 4), isNull);
  });

  test('an image outside any link resolves as an image', () {
    final resolver = _resolver([
      _hit(
        '',
        x: 50,
        y: 100,
        width: 120,
        height: 160,
        imageSrc: 'Images/plate.png',
        imageAlt: 'standalone plate',
      ),
    ]);
    final target = resolver.resolve(x: 100, y: 180);
    expect(target, isA<RitoTapImage>());
    target as RitoTapImage;
    expect(target.src, 'Images/plate.png');
    expect(target.alt, 'standalone plate');
  });

  test('a link run wins over an image behind it', () {
    final resolver = _resolver([
      _hit('caption', x: 60, y: 150, width: 80, href: '#fig'),
      _hit(
        '',
        x: 50,
        y: 100,
        width: 120,
        height: 160,
        imageSrc: 'Images/fig.png',
      ),
    ]);
    final target = resolver.resolve(x: 100, y: 160);
    expect(target, isA<RitoTapLink>());
    expect((target as RitoTapLink).href, '#fig');
  });

  test('a block-level link box resolves without a label', () {
    final resolver = _resolver([
      _hit('', x: 0, y: 0, width: 400, height: 240, href: 'Text/ch3.xhtml'),
    ]);
    final target = resolver.resolve(x: 200, y: 120);
    expect(target, isA<RitoTapLink>());
    expect((target as RitoTapLink).label, isNull);
  });

  test('a tap on nothing resolves to null', () {
    final resolver = _resolver([_hit('plain', x: 40, y: 300, width: 80)]);
    expect(resolver.resolve(x: 60, y: 310), isNull);
    expect(resolver.resolve(x: 300, y: 700), isNull);
  });
}
