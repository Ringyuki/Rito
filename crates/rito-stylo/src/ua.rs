/// Rito's EPUB support-profile user-agent stylesheet.
///
/// This is deliberately a document policy rather than browser chrome. It
/// supplies the HTML box-generation defaults needed by publication content,
/// while leaving controls, focus rings, presentational hints, and platform
/// widgets to hosts. It is not a complete browser HTML UA stylesheet.
/// Keeping it as CSS lets Stylo apply normal cascade/origin rules over the
/// DOM-independent `rito-source` arena.
pub const EPUB_UA_PROFILE_ID: &str = "rito-epub-support-profile-v2";

pub fn epub_ua_stylesheet() -> &'static str {
    EPUB_UA_STYLESHEET
}

pub(crate) const EPUB_UA_STYLESHEET: &str = r#"
@namespace url(http://www.w3.org/1999/xhtml);

html, body,
address, article, aside, blockquote, center, details, dialog, div, dl, dt, dd,
fieldset, figcaption, figure, footer, form,
h1, h2, h3, h4, h5, h6, header, hgroup, hr,
legend, listing, main, menu, nav, ol, p, plaintext, pre, search, section, summary, ul, xmp {
  display: block;
}

area, base, basefont, datalist, head, link, meta, noembed, noframes, param, rp,
script, style, template, title {
  display: none;
}

*[hidden] { display: none; }
dialog:not([open]) { display: none; }

li { display: list-item; }
details > summary:first-of-type { display: list-item; }
table { display: table; box-sizing: border-box; border-collapse: separate; border-spacing: 2px; text-indent: 0; }
caption { display: table-caption; text-align: center; }
col { display: table-column; }
colgroup { display: table-column-group; }
tbody { display: table-row-group; vertical-align: middle; }
thead { display: table-header-group; vertical-align: middle; }
tfoot { display: table-footer-group; vertical-align: middle; }
tr { display: table-row; vertical-align: inherit; }
td, th { display: table-cell; vertical-align: inherit; padding: 1px; }

body { margin: 0; }
h1 { font-size: 2em; font-weight: bold; margin-block: 0.67em; }
h2 { font-size: 1.5em; font-weight: bold; margin-block: 0.83em; }
h3 { font-size: 1.17em; font-weight: bold; margin-block: 1em; }
h4 { font-size: 1em; font-weight: bold; margin-block: 1.33em; }
h5 { font-size: 0.83em; font-weight: bold; margin-block: 1.67em; }
h6 { font-size: 0.67em; font-weight: bold; margin-block: 2.33em; }

p { margin-block: 1em; }
blockquote { margin-block: 1em; margin-inline: 40px; }
listing, plaintext, pre, xmp { font-family: monospace; white-space: pre; margin-block: 1em; }
code { font-family: monospace; }
em, i { font-style: italic; }
strong, b, dt, th { font-weight: bold; }
center { text-align: center; }

ul { margin-block: 1em; padding-inline-start: 40px; list-style-type: disc; }
ol { margin-block: 1em; padding-inline-start: 40px; list-style-type: decimal; }
li { margin-block: 0; }
dl { margin-block: 1em; }
dd { margin-inline-start: 40px; }

hr { margin-block: 0.5em; }
sup { vertical-align: super; font-size: smaller; }
sub { vertical-align: sub; font-size: smaller; }

address, blockquote, center, div, figure, figcaption, footer, form, header, hr,
legend, listing, main, p, plaintext, pre, summary, xmp, article, aside,
h1, h2, h3, h4, h5, h6, hgroup, nav, search, section,
table, caption, colgroup, col, thead, tbody, tfoot, tr, td, th,
dir, dd, dl, dt, menu, ol, ul, li, bdi, output,
*[dir="ltr" i], *[dir="rtl" i], *[dir="auto" i] {
  unicode-bidi: isolate;
}
bdo, bdo[dir] { unicode-bidi: isolate-override; }

/* Stylo's Servo profile has no ruby/ruby-text display variants. Rito keeps
   ruby box generation as an explicit semantic/layout policy; `rp` alone is
   hidden here because it is fallback text for non-ruby renderers. */
"#;
