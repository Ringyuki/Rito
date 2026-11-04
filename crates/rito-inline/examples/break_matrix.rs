//! Diagnostic: the engine's verdict on every ordered pair of a character
//! set — may a line break between A and B — for each content language and
//! `line-break` value, in the shape of the browser probe's output so the
//! two compare line for line. Each case is a paragraph
//! "一二三四五六七" + A + B + "九九" in the pinned serif at 16px whose
//! width is the engine's own width of "一二三四五六七" + A plus 0.5px: the
//! first line ends exactly after A iff the pair is a break opportunity.
//!
//! usage: cargo run --release -p rito-inline --example break_matrix --
//!        <font.otf> <chars.txt> <out.tsv> [langs] [line-breaks] [word-break]
use std::collections::HashMap;
use std::fmt::Write as _;

use rito_fragment::{
    CancelFlag, ConstraintSpace, FormattingContext, FormattingNode, FormattingNodeContent,
    FormattingNodeId, FormattingTree, Fragment, InlineItem,
};
use rito_inline::{plain_paragraph_style, ParleyInlineContext};
use rito_style_contract::{
    FontFamilies, FontFamily, FontFamilyName, InlineStyleTable, LanguageTag, LayoutStyleTable,
    LineBreak, WordBreak,
};

const PREFIX: &str = "一二三四五六七";

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let [_, font, chars, out, ..] = args.as_slice() else {
        panic!("usage: break_matrix <font.otf> <chars.txt> <out.tsv> [langs] [line-breaks]");
    };
    let langs = args
        .get(4)
        .map_or("ja,zh-CN,zh-TW,ko,en,none", String::as_str);
    let line_breaks = args
        .get(5)
        .map_or("auto,normal,loose,strict", String::as_str);
    let word_break = args.get(6).map_or("normal", String::as_str);
    let context = ParleyInlineContext::new(vec![std::fs::read(font).expect("font reads")])
        .expect("context builds");
    let chars: Vec<char> = std::fs::read_to_string(chars)
        .expect("chars read")
        .split_whitespace()
        .map(|hex| char::from_u32(u32::from_str_radix(hex, 16).expect("hex")).expect("scalar"))
        .collect();
    let mut rows = String::new();
    for lang in langs.split(',') {
        for line_break in line_breaks.split(',') {
            let mut widths: HashMap<char, f64> = HashMap::new();
            let mut breakable = 0;
            for &a in &chars {
                let width = *widths.entry(a).or_insert_with(|| {
                    first_line(
                        &context,
                        (lang, line_break, word_break),
                        &format!("{PREFIX}{a}"),
                        1.0e6,
                    )
                    .1
                });
                for &b in &chars {
                    let text = format!("{PREFIX}{a}{b}九九");
                    let (end, _) =
                        first_line(&context, (lang, line_break, word_break), &text, width + 0.5);
                    let chars_on_line = text[..end].chars().count();
                    let verdict = usize::from(chars_on_line == PREFIX.chars().count() + 1);
                    breakable += verdict;
                    let config = if word_break == "normal" {
                        line_break.to_owned()
                    } else {
                        format!("{line_break}/{word_break}")
                    };
                    writeln!(
                        rows,
                        "{lang}\t{config}\t{:x}\t{:x}\t{verdict}\t{chars_on_line}",
                        u32::from(a),
                        u32::from(b)
                    )
                    .expect("row writes");
                }
            }
            eprintln!(
                "{lang} {line_break}: {breakable}/{} breakable",
                chars.len() * chars.len()
            );
        }
    }
    std::fs::write(out, rows).expect("rows write");
}

/// The byte where the first line of `text` ends and that line's width,
/// laid out `width` wide under a content language, `line-break` and
/// `word-break`.
fn first_line(
    context: &ParleyInlineContext,
    (lang, line_break, word_break): (&str, &str, &str),
    text: &str,
    width: f64,
) -> (usize, f64) {
    let mut style = plain_paragraph_style(
        FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("NoSuchFace"))])
            .expect("family list"),
        16.0,
        0.0,
    );
    style.text_flow.language = (lang != "none").then(|| LanguageTag::new(lang));
    style.text_flow.line_break = match line_break {
        "auto" => LineBreak::Auto,
        "normal" => LineBreak::Normal,
        "loose" => LineBreak::Loose,
        "strict" => LineBreak::Strict,
        "anywhere" => LineBreak::Anywhere,
        other => panic!("unknown line-break {other}"),
    };
    style.text_flow.word_break = match word_break {
        "normal" => WordBreak::Normal,
        "break-all" => WordBreak::BreakAll,
        "keep-all" => WordBreak::KeepAll,
        other => panic!("unknown word-break {other}"),
    };
    let mut inline = InlineStyleTable::new(1);
    let style = inline.intern_for_node(0, style).expect("style interns");
    let nodes = vec![FormattingNode {
        style: rito_style_contract::LayoutStyleId::from_raw(0),
        content: FormattingNodeContent::InlineFlow {
            items: vec![InlineItem::Text {
                text: text.to_owned(),
                style,
                baseline_shift_px: 0.0,
                ruby_annotation: None,
            }],
        },
        children: Vec::new(),
    }];
    let tree = FormattingTree::with_styles(
        nodes,
        FormattingNodeId(0),
        rito_fragment::FormattingTreeStyles {
            layout: LayoutStyleTable::new(0),
            inline,
        },
    )
    .expect("inline tree builds");
    let outcome = context
        .layout(
            &tree,
            tree.root(),
            &ConstraintSpace::continuous(width),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("inline outcome root is a box fragment");
    };
    let Some(Fragment::Line(line)) = root.children.first() else {
        panic!("the paragraph has a first line");
    };
    let mut end = 0_u32;
    let mut line_width = 0.0;
    for child in &line.children {
        if let Fragment::Text(run) = child {
            end = end.max(run.text_end);
        }
        line_width += child.rect().width;
    }
    (end as usize, line_width)
}
