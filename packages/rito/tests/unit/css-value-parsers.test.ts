import { describe, it, expect } from 'vitest';
import {
  parseFontWeight,
  parseFontStyle,
  parseLineHeight,
  parseTextAlign,
  parseTextDecoration,
  parseTextTransform,
  parseWhiteSpace,
  parseDisplay,
  parseListStyleType,
  parsePageBreak,
  parseBorder,
} from '../../src/style/css-value-parsers';

describe('parseFontWeight', () => {
  it('parses bold', () => {
    expect(parseFontWeight('bold')).toBe('bold');
  });
  it('parses normal', () => {
    expect(parseFontWeight('normal')).toBe('normal');
  });
  it('maps 700 to bold', () => {
    expect(parseFontWeight('700')).toBe('bold');
  });
  it('maps 400 to normal', () => {
    expect(parseFontWeight('400')).toBe('normal');
  });
  it('maps 600 to bold', () => {
    expect(parseFontWeight('600')).toBe('bold');
  });
  it('returns undefined for invalid', () => {
    expect(parseFontWeight('heavy')).toBeUndefined();
  });
});

describe('parseFontStyle', () => {
  it('parses italic', () => {
    expect(parseFontStyle('italic')).toBe('italic');
  });
  it('parses oblique as italic', () => {
    expect(parseFontStyle('oblique')).toBe('italic');
  });
  it('parses normal', () => {
    expect(parseFontStyle('normal')).toBe('normal');
  });
  it('returns undefined for invalid', () => {
    expect(parseFontStyle('slanted')).toBeUndefined();
  });
});

describe('parseLineHeight', () => {
  it('parses px relative to font size', () => {
    expect(parseLineHeight('24px', 16)).toBe(1.5);
  });
  it('parses em', () => {
    expect(parseLineHeight('1.5em', 16)).toBe(1.5);
  });
  it('parses percentage', () => {
    expect(parseLineHeight('150%', 16)).toBe(1.5);
  });
  it('parses unitless number', () => {
    expect(parseLineHeight('1.4', 16)).toBe(1.4);
  });
  it('returns undefined for invalid', () => {
    expect(parseLineHeight('auto', 16)).toBeUndefined();
  });
});

describe('parseTextAlign', () => {
  it('parses left', () => {
    expect(parseTextAlign('left')).toBe('left');
  });
  it('parses center', () => {
    expect(parseTextAlign('center')).toBe('center');
  });
  it('parses right', () => {
    expect(parseTextAlign('right')).toBe('right');
  });
  it('parses justify', () => {
    expect(parseTextAlign('justify')).toBe('justify');
  });
  it('returns undefined for invalid', () => {
    expect(parseTextAlign('start')).toBeUndefined();
  });
});

describe('parseTextDecoration', () => {
  it('parses underline', () => {
    expect(parseTextDecoration('underline')).toBe('underline');
  });
  it('parses line-through', () => {
    expect(parseTextDecoration('line-through')).toBe('line-through');
  });
  it('parses none', () => {
    expect(parseTextDecoration('none')).toBe('none');
  });
});

describe('parseTextTransform', () => {
  it('parses uppercase', () => {
    expect(parseTextTransform('uppercase')).toBe('uppercase');
  });
  it('parses lowercase', () => {
    expect(parseTextTransform('lowercase')).toBe('lowercase');
  });
  it('parses capitalize', () => {
    expect(parseTextTransform('capitalize')).toBe('capitalize');
  });
  it('parses none', () => {
    expect(parseTextTransform('none')).toBe('none');
  });
});

describe('parseWhiteSpace', () => {
  it('parses normal', () => {
    expect(parseWhiteSpace('normal')).toBe('normal');
  });
  it('parses pre', () => {
    expect(parseWhiteSpace('pre')).toBe('pre');
  });
  it('parses pre-wrap', () => {
    expect(parseWhiteSpace('pre-wrap')).toBe('pre-wrap');
  });
  it('parses nowrap', () => {
    expect(parseWhiteSpace('nowrap')).toBe('nowrap');
  });
});

describe('parseDisplay', () => {
  it('parses block', () => {
    expect(parseDisplay('block')).toBe('block');
  });
  it('parses inline', () => {
    expect(parseDisplay('inline')).toBe('inline');
  });
  it('parses none', () => {
    expect(parseDisplay('none')).toBe('none');
  });
  it('returns undefined for flex', () => {
    expect(parseDisplay('flex')).toBeUndefined();
  });
});

describe('parseListStyleType', () => {
  it('parses disc', () => {
    expect(parseListStyleType('disc')).toBe('disc');
  });
  it('maps circle to disc', () => {
    expect(parseListStyleType('circle')).toBe('disc');
  });
  it('parses decimal', () => {
    expect(parseListStyleType('decimal')).toBe('decimal');
  });
  it('parses none', () => {
    expect(parseListStyleType('none')).toBe('none');
  });
});

describe('parsePageBreak', () => {
  it('parses always', () => {
    expect(parsePageBreak('always')).toBe('always');
  });
  it('maps page to always', () => {
    expect(parsePageBreak('page')).toBe('always');
  });
  it('parses auto', () => {
    expect(parsePageBreak('auto')).toBe('auto');
  });
});

describe('parseBorder', () => {
  it('parses solid border', () => {
    const b = parseBorder('1px solid #000', 16);
    expect(b).toEqual({ width: 1, color: '#000', style: 'solid' });
  });

  it('parses dashed border', () => {
    const b = parseBorder('2px dashed red', 16);
    expect(b).toEqual({ width: 2, color: 'red', style: 'dashed' });
  });

  it('parses dotted border', () => {
    const b = parseBorder('1px dotted blue', 16);
    expect(b).toEqual({ width: 1, color: 'blue', style: 'dotted' });
  });

  it('approximates double as solid', () => {
    const b = parseBorder('3px double #333', 16);
    expect(b?.style).toBe('solid');
  });

  it('parses none', () => {
    const b = parseBorder('none', 16);
    expect(b?.style).toBe('none');
  });

  it('parses em width', () => {
    const b = parseBorder('0.5em solid black', 16);
    expect(b?.width).toBe(8);
  });
});
