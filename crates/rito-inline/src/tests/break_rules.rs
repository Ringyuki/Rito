//! Where a line may break, as Chromium 156 breaks: the boundaries of
//! mixed strings under each content language and `line-break` value its
//! ICU opens a different rule set for.

use crate::{BreakContext, BreakOpportunities, RuleSet};
use rito_style_contract::LineBreak;

fn line_break(value: &str) -> LineBreak {
    match value {
        "auto" => LineBreak::Auto,
        "normal" => LineBreak::Normal,
        "loose" => LineBreak::Loose,
        "strict" => LineBreak::Strict,
        other => panic!("unknown line-break {other}"),
    }
}

/// Each boundary of `text` as `1` (a break opportunity), `0` (none) or `?`
/// (left to the dictionary).
fn verdicts(language: &str, value: &str, text: &str) -> String {
    let rule_set =
        RuleSet::for_content((language != "none").then_some(language), line_break(value));
    let opportunities = BreakOpportunities::new(text, |_| BreakContext {
        rule_set,
        word_break: rito_style_contract::WordBreak::Normal,
        anywhere: false,
        collapses: true,
    });
    text.char_indices()
        .skip(1)
        .map(|(offset, _)| match opportunities.before(offset) {
            Some(true) => '1',
            Some(false) => '0',
            None => '?',
        })
        .collect()
}

/// Each case's boundaries as Chromium 156 breaks them (the pinned serif at
/// 16px, each boundary probed by a paragraph as wide as the text before
/// it): `1` a break opportunity, `0` none.
const CASES: &[(&str, &str, &str, &str)] = &[
    // A wave dash may start a line in Japanese `normal` and `loose` and in
    // Chinese, never by default in Japanese nor in other languages.
    ("ja", "auto", "ちょっと〜〜！」って", "111000011"),
    ("ja", "normal", "ちょっと〜〜！」って", "111110011"),
    ("ja", "loose", "ちょっと〜〜！」って", "111111011"),
    ("zh-CN", "auto", "ちょっと〜〜！」って", "111110011"),
    ("en", "auto", "ちょっと〜〜！」って", "111000011"),
    // ...but never after an opening bracket or quotation mark.
    ("ja", "normal", "（〜）", "00"),
    ("ja", "normal", "“〜”", "00"),
    ("ja", "normal", "あ 〜 い", "0101"),
    // Chinese reads the curly double quotes as brackets; elsewhere a
    // quotation mark breaks only between East Asian characters.
    ("zh-CN", "auto", "怕”——可见", "01011"),
    ("ja", "auto", "怕”——可见", "00011"),
    ("en", "auto", "怕”——可见", "00011"),
    ("en", "auto", "我們說“好”吧", "111001"),
    // Numbers keep their prefixes and postfixes; full-width digits are
    // ideographs.
    (
        "en",
        "auto",
        "100% 50$ $50 €40 40€ ¥100 100¥",
        "00001000100010001000100001000",
    ),
    (
        "ja",
        "loose",
        "100% 50$ $50 €40 40€ ¥100 100¥",
        "00001000100011001000100001000",
    ),
    ("zh-CN", "auto", "价格（１２３）％便宜", "110110111"),
    // `loose` breaks before iteration marks and centered punctuation in
    // Japanese, and between an ideograph and a hyphen, whose word then
    // stays together.
    ("ja", "normal", "々ゝヽ・：；！？‼⁇あ", "0000000001"),
    ("ja", "loose", "々ゝヽ・：；！？‼⁇あ", "1111111111"),
    ("ja", "normal", "‐あ‐い", "101"),
    ("ja", "loose", "‐あ‐い", "111"),
    // A space then an ideographic space: the line ends after the space.
    ("ja", "auto", "上下 \u{3000}左右", "10101"),
];

#[test]
fn break_opportunities_follow_chromium_per_language_and_line_break() {
    for &(language, value, text, expected) in CASES {
        assert_eq!(
            verdicts(language, value, text),
            expected,
            "{language} line-break: {value} breaks {text:?}"
        );
    }
}

/// The instrument: every row of the browser probe's strings, as this
/// engine breaks them, in the probe's shape.
/// `RITO_BREAK_STRINGS=in.tsv RITO_BREAK_OUT=out.tsv cargo test -p rito-inline
/// break_strings_dump -- --ignored`
#[test]
#[ignore = "instrument: compares against the browser probe's output"]
fn break_strings_dump() {
    let input = std::env::var("RITO_BREAK_STRINGS").expect("RITO_BREAK_STRINGS");
    let output = std::env::var("RITO_BREAK_OUT").expect("RITO_BREAK_OUT");
    let unescape = |raw: &str| {
        let mut text = String::new();
        let mut rest = raw;
        while let Some(at) = rest.find("\\u{") {
            text.push_str(&rest[..at]);
            let close = rest[at..].find('}').expect("escape closes") + at;
            let code = u32::from_str_radix(&rest[at + 3..close], 16).expect("hex escape");
            text.push(char::from_u32(code).expect("scalar"));
            rest = &rest[close + 1..];
        }
        text.push_str(rest);
        text
    };
    let rows: Vec<String> = std::fs::read_to_string(input)
        .expect("strings read")
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| {
            let mut fields = line.splitn(3, '\t');
            let (language, value, raw) = (
                fields.next().expect("language"),
                fields.next().expect("line-break"),
                fields.next().expect("text"),
            );
            let text = unescape(raw);
            format!(
                "{language}\t{value}\t{text}\t{}",
                verdicts(language, value, &text)
            )
        })
        .collect();
    std::fs::write(output, rows.join("\n") + "\n").expect("rows write");
}
