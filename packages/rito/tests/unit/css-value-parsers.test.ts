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
} from '../../src/style/css/value-parsers';
import { parseLength, evaluateCalc } from '../../src/style/css/parse-utils';

describe('parseFontWeight', () => {
  it('parses bold to 700', () => {
    expect(parseFontWeight('bold')).toBe(700);
  });
  it('parses normal to 400', () => {
    expect(parseFontWeight('normal')).toBe(400);
  });
  it('parses numeric 700', () => {
    expect(parseFontWeight('700')).toBe(700);
  });
  it('parses numeric 400', () => {
    expect(parseFontWeight('400')).toBe(400);
  });
  it('parses numeric 600', () => {
    expect(parseFontWeight('600')).toBe(600);
  });
  it('parses numeric 100', () => {
    expect(parseFontWeight('100')).toBe(100);
  });
  it('parses numeric 900', () => {
    expect(parseFontWeight('900')).toBe(900);
  });
  it('returns undefined for invalid', () => {
    expect(parseFontWeight('heavy')).toBeUndefined();
  });
  it('resolves lighter relative to inherited weight', () => {
    expect(parseFontWeight('lighter', 400)).toBe(100);
    expect(parseFontWeight('lighter', 700)).toBe(400);
    expect(parseFontWeight('lighter', 900)).toBe(700);
  });
  it('resolves bolder relative to inherited weight', () => {
    expect(parseFontWeight('bolder', 400)).toBe(700);
    expect(parseFontWeight('bolder', 100)).toBe(400);
    expect(parseFontWeight('bolder', 700)).toBe(900);
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
  it('parses circle', () => {
    expect(parseListStyleType('circle')).toBe('circle');
  });
  it('parses square', () => {
    expect(parseListStyleType('square')).toBe('square');
  });
  it('parses decimal', () => {
    expect(parseListStyleType('decimal')).toBe('decimal');
  });
  it('parses lower-alpha', () => {
    expect(parseListStyleType('lower-alpha')).toBe('lower-alpha');
  });
  it('parses lower-latin as lower-alpha', () => {
    expect(parseListStyleType('lower-latin')).toBe('lower-alpha');
  });
  it('parses upper-alpha', () => {
    expect(parseListStyleType('upper-alpha')).toBe('upper-alpha');
  });
  it('parses upper-latin as upper-alpha', () => {
    expect(parseListStyleType('upper-latin')).toBe('upper-alpha');
  });
  it('parses lower-roman', () => {
    expect(parseListStyleType('lower-roman')).toBe('lower-roman');
  });
  it('parses upper-roman', () => {
    expect(parseListStyleType('upper-roman')).toBe('upper-roman');
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

  it('parses rem width', () => {
    const b = parseBorder('0.5rem solid black', 16, 20);
    expect(b?.width).toBe(10);
  });
});

// ── rem unit tests ─────────────────────────────────────────────────

describe('parseLength — rem unit', () => {
  it('parses 1rem with default root font size (16)', () => {
    expect(parseLength('1rem', 12)).toBe(16);
  });

  it('parses 1.5rem with default root font size', () => {
    expect(parseLength('1.5rem', 12)).toBe(24);
  });

  it('parses rem with custom root font size', () => {
    expect(parseLength('2rem', 12, 20)).toBe(40);
  });

  it('parses 0.5rem', () => {
    expect(parseLength('0.5rem', 16, 16)).toBe(8);
  });

  it('rem is independent of parent font size', () => {
    const r1 = parseLength('1rem', 12, 20);
    const r2 = parseLength('1rem', 24, 20);
    expect(r1).toBe(20);
    expect(r2).toBe(20);
  });

  it('does not confuse rem with em', () => {
    const rem = parseLength('2rem', 16, 20);
    const em = parseLength('2em', 16, 20);
    expect(rem).toBe(40); // 2 * 20
    expect(em).toBe(32); // 2 * 16
  });
});

describe('parseLineHeight — rem unit', () => {
  it('parses rem line-height relative to root and parent', () => {
    // 1rem = 20px, parent = 16px, ratio = 20/16 = 1.25
    expect(parseLineHeight('1rem', 16, 20)).toBe(1.25);
  });
});

// ── calc() tests ───────────────────────────────────────────────────

describe('evaluateCalc', () => {
  it('handles simple addition of px values', () => {
    expect(evaluateCalc('calc(10px + 20px)', 16)).toBe(30);
  });

  it('handles subtraction', () => {
    expect(evaluateCalc('calc(100px - 20px)', 16)).toBe(80);
  });

  it('handles multiplication', () => {
    expect(evaluateCalc('calc(10px * 3)', 16)).toBe(30);
  });

  it('handles division', () => {
    expect(evaluateCalc('calc(30px / 2)', 16)).toBe(15);
  });

  it('mixes em and px', () => {
    // 1em = 16px, so calc(1em + 10px) = 16 + 10 = 26
    expect(evaluateCalc('calc(1em + 10px)', 16)).toBe(26);
  });

  it('mixes rem and px', () => {
    // 2rem = 40px (root=20), calc(2rem - 10px) = 40 - 10 = 30
    expect(evaluateCalc('calc(2rem - 10px)', 16, 20)).toBe(30);
  });

  it('mixes percent and rem', () => {
    // 100% = 16px (% resolves against parentFontSize), 2rem = 40px (root=20)
    // calc(100% - 2rem) = 16 - 40 = -24
    expect(evaluateCalc('calc(100% - 2rem)', 16, 20)).toBe(-24);
  });

  it('handles operator precedence (* before +)', () => {
    // calc(10px + 5px * 2) = 10 + 10 = 20
    expect(evaluateCalc('calc(10px + 5px * 2)', 16)).toBe(20);
  });

  it('handles operator precedence (/ before -)', () => {
    // calc(20px - 10px / 2) = 20 - 5 = 15
    expect(evaluateCalc('calc(20px - 10px / 2)', 16)).toBe(15);
  });

  it('handles parenthesized sub-expressions', () => {
    // calc((10px + 5px) * 2) = 15 * 2 = 30
    expect(evaluateCalc('calc((10px + 5px) * 2)', 16)).toBe(30);
  });

  it('handles negative values', () => {
    expect(evaluateCalc('calc(-10px + 20px)', 16)).toBe(10);
  });

  it('returns undefined for empty calc()', () => {
    expect(evaluateCalc('calc()', 16)).toBeUndefined();
  });

  it('returns undefined for division by zero', () => {
    expect(evaluateCalc('calc(10px / 0)', 16)).toBeUndefined();
  });

  it('handles pt units inside calc', () => {
    // 12pt = 16px, calc(12pt + 4px) = 16 + 4 = 20
    expect(evaluateCalc('calc(12pt + 4px)', 16)).toBe(20);
  });
});

describe('parseLength — calc() integration', () => {
  it('parses calc() via parseLength', () => {
    expect(parseLength('calc(1em + 10px)', 16)).toBe(26);
  });

  it('parses calc() with rem via parseLength', () => {
    expect(parseLength('calc(1rem + 10px)', 16, 20)).toBe(30);
  });

  it('is case-insensitive', () => {
    expect(parseLength('CALC(10PX + 20PX)', 16)).toBe(30);
  });
});
