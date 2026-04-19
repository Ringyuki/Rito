export interface FontPreviewSpec {
  readonly primaryText: string;
  readonly secondaryText?: string;
  readonly lang?: string;
}

type ScriptKey = 'zh-Hans' | 'zh-Hant' | 'ja' | 'ko' | 'ar' | 'he' | 'th' | 'hi' | 'el' | 'ru';

interface ScriptPreview {
  readonly sample: string;
  readonly lang: string;
}

const SCRIPT_PREVIEWS: Readonly<Record<ScriptKey, ScriptPreview>> = {
  'zh-Hans': { sample: '汉字预览', lang: 'zh-CN' },
  'zh-Hant': { sample: '漢字預覽', lang: 'zh-Hant' },
  ja: { sample: 'かな漢字', lang: 'ja' },
  ko: { sample: '한글 보기', lang: 'ko' },
  ar: { sample: 'العربية', lang: 'ar' },
  he: { sample: 'עברית', lang: 'he' },
  th: { sample: 'ไทยตัวอย่าง', lang: 'th' },
  hi: { sample: 'देवनागरी', lang: 'hi' },
  el: { sample: 'Ελληνικά', lang: 'el' },
  ru: { sample: 'Кириллица', lang: 'ru' },
};

const SCRIPT_KEYWORDS: ReadonlyArray<readonly [ScriptKey, readonly RegExp[]]> = [
  [
    'zh-Hant',
    [
      /\b(?:pmingliu|mingliu|jhenghei|dfkai)\b/i,
      /\bmicrosoft\s+jhenghei\b/i,
      /\bnoto\s+(?:sans|serif)\s+cjk\s+tc\b/i,
      /\bsource\s+han\s+(?:sans|serif)\s+tc\b/i,
      /\b(?:songti|heiti)\s+tc\b/i,
    ],
  ],
  [
    'zh-Hans',
    [
      /\b(?:simsun|simhei|yahei|dengxian|youyuan|kaiti|fangsong|heiti|songti)\b/i,
      /\b(?:kai|hei|song|fang)\b/i,
      /\bpingfang\b/i,
      /\bhiragino\s+sans\s+gb\b/i,
      /\bwenquanyi\b/i,
      /\bnoto\s+(?:sans|serif)\s+cjk\s+sc\b/i,
      /\bsource\s+han\s+(?:sans|serif)\s+sc\b/i,
      /\bsarasa\b.*\bsc\b/i,
    ],
  ],
  [
    'ja',
    [
      /\b(?:yu\s+gothic|yu\s+mincho|meiryo)\b/i,
      /\bms\s+p?(?:gothic|mincho)\b/i,
      /\b(?:hiragino|kaku\s+gothic|maru\s+gothic)\b/i,
      /\bnoto\s+(?:sans|serif)\s+(?:jp|cjk\s+jp)\b/i,
      /\bsource\s+han\s+(?:sans|serif)\s+jp\b/i,
    ],
  ],
  [
    'ko',
    [
      /\b(?:malgun|batang|dotum|gulim|nanum)\b/i,
      /\bapple\s+sd\s+gothic\s+neo\b/i,
      /\bnoto\s+(?:sans|serif)\s+(?:kr|cjk\s+kr)\b/i,
      /\bsource\s+han\s+(?:sans|serif)\s+kr\b/i,
    ],
  ],
  [
    'ar',
    [
      /\b(?:arabic|naskh|kufi|amiri|scheherazade|geeza|dubai)\b/i,
      /\bal\s+bayan\b/i,
      /\bal\s+tarikh\b/i,
    ],
  ],
  ['he', [/\b(?:hebrew|aharoni|frank\s+ruehl|guttman)\b/i]],
  ['th', [/\b(?:thai|sarabun|thonburi|angsana|browallia|cordia|leelawadee)\b/i]],
  ['hi', [/\b(?:devanagari|mangal|kokila|aparajita|nirmala)\b/i]],
  ['el', [/\b(?:greek)\b/i]],
  ['ru', [/\b(?:cyrillic)\b/i]],
];

export function getFontPreviewSpec(
  family: string | null,
  label: string,
  options?: { readonly isPreset?: boolean },
): FontPreviewSpec {
  if (family === null) {
    return { primaryText: label };
  }

  if (options?.isPreset) {
    return { primaryText: 'Ag', secondaryText: label, lang: 'en' };
  }

  const nativeScript = inferScriptFromVisibleName(family);
  if (nativeScript) {
    return { primaryText: family, lang: SCRIPT_PREVIEWS[nativeScript].lang };
  }

  const aliasedScript = inferScriptFromAlias(family);
  if (aliasedScript) {
    const preview = SCRIPT_PREVIEWS[aliasedScript];
    return {
      primaryText: preview.sample,
      secondaryText: label,
      lang: preview.lang,
    };
  }

  return { primaryText: family, lang: 'en' };
}

function inferScriptFromVisibleName(value: string): ScriptKey | undefined {
  if (/[ぁ-ゟ゠-ヿ]/u.test(value)) return 'ja';
  if (/[가-힣]/u.test(value)) return 'ko';
  if (/[\u0600-\u06FF]/u.test(value)) return 'ar';
  if (/[\u0590-\u05FF]/u.test(value)) return 'he';
  if (/[\u0E00-\u0E7F]/u.test(value)) return 'th';
  if (/[\u0900-\u097F]/u.test(value)) return 'hi';
  if (/[\u0370-\u03FF]/u.test(value)) return 'el';
  if (/[\u0400-\u04FF]/u.test(value)) return 'ru';
  if (/[\u4E00-\u9FFF]/u.test(value)) {
    if (/[繁體體臺灣港澳]/u.test(value)) return 'zh-Hant';
    return 'zh-Hans';
  }
  return undefined;
}

function inferScriptFromAlias(value: string): ScriptKey | undefined {
  for (const [script, patterns] of SCRIPT_KEYWORDS) {
    for (const pattern of patterns) {
      if (pattern.test(value)) return script;
    }
  }
  return undefined;
}
