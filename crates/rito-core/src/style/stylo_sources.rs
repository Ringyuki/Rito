//! Fail-closed construction of production Stylo stylesheet inputs.
//!
//! This module deliberately inventories CSS with a small lexer instead of
//! invoking the compatibility parser. A source is admitted only when its
//! complete declaration surface can be represented by the production style
//! contract, apart from a very small, explicitly audited set of declarations
//! that the legacy engine also ignored. `@page` remains a compatibility no-op;
//! page-rule projection is a separate migration gate.

use rito_source::SourceArena;
use rito_stylo::StylesheetInput;

use crate::{
    epub::{join_epub_href, opf_dir, StylesheetSourceLedger},
    xhtml::AuthorStylesheetSource,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StyloSourceSelection {
    pub(crate) document_url: String,
    pub(crate) stylesheets: Vec<StylesheetInput>,
}

/// A stylesheet-selection rejection uses the effective cascade ordinal as
/// `source_index`; inline-style validation uses the source arena node index.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum StyloSourceRejection {
    SelectionIssue {
        source_index: usize,
        issue_index: usize,
    },
    MediaEnvironmentIssue {
        source_index: usize,
        issue_index: usize,
    },
    ExternalStylesheetMissing {
        source_index: usize,
        resolved_href: String,
    },
    ExternalStylesheetAmbiguous {
        source_index: usize,
        resolved_href: String,
        matches: usize,
    },
    BackslashEscape {
        source_index: usize,
    },
    UnsupportedAtRule {
        source_index: usize,
        name: String,
    },
    UnsupportedProperty {
        source_index: usize,
        name: String,
    },
    UnsupportedAttribute {
        source_index: usize,
        name: String,
    },
    CssNesting {
        source_index: usize,
    },
    UnsupportedPseudoElement {
        source_index: usize,
        pseudo: String,
    },
    UnreliableInventory {
        source_index: usize,
        reason: CssInventoryFailure,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CssInventoryFailure {
    EmptyPrelude { offset: usize },
    MissingBlock,
    MissingColon,
    UnexpectedDelimiter,
    UnterminatedBlock,
    UnterminatedComment,
    UnterminatedString,
}

pub(crate) fn select_stylo_sources(
    stylesheet_ledger: &StylesheetSourceLedger,
    chapter_href: &str,
    author_stylesheets: &[AuthorStylesheetSource],
) -> Result<StyloSourceSelection, StyloSourceRejection> {
    let document_url = publication_url(chapter_href);
    let has_external_source = author_stylesheets
        .iter()
        .any(|source| matches!(source, AuthorStylesheetSource::External { .. }));
    let implicit_source_count = if has_external_source {
        0
    } else {
        stylesheet_ledger.sources().len()
    };
    let mut stylesheets = Vec::with_capacity(author_stylesheets.len() + implicit_source_count);

    // Preserve the compatibility contract used by documents constructed
    // through the public LoadedEpubDocument API: when XHTML has no link
    // occurrence, every publication stylesheet precedes embedded sheets.
    if !has_external_source {
        for source in stylesheet_ledger.sources() {
            let source_index = stylesheets.len();
            inventory_selected_css(source_index, source.href(), source.text())?;
            stylesheets.push(StylesheetInput::author(
                source.text(),
                publication_url(source.href()),
            ));
        }
    }

    for source in author_stylesheets {
        let source_index = stylesheets.len();
        reject_source_issues(source_index, source)?;
        let (css, base_url) = match source {
            AuthorStylesheetSource::Embedded { css, .. } => (css.as_str(), document_url.clone()),
            AuthorStylesheetSource::External { href, .. } => {
                let resolved_href = resolve_stylesheet_href(chapter_href, href);
                let matches = stylesheet_ledger
                    .sources()
                    .iter()
                    .filter(|candidate| normalize_path(candidate.href()) == resolved_href)
                    .collect::<Vec<_>>();
                let selected = match matches.as_slice() {
                    [selected] => *selected,
                    [] => {
                        return Err(StyloSourceRejection::ExternalStylesheetMissing {
                            source_index,
                            resolved_href,
                        });
                    }
                    _ => {
                        return Err(StyloSourceRejection::ExternalStylesheetAmbiguous {
                            source_index,
                            resolved_href,
                            matches: matches.len(),
                        });
                    }
                };
                (selected.text(), publication_url(&resolved_href))
            }
        };
        inventory_selected_css(source_index, &base_url, css)?;
        stylesheets.push(StylesheetInput::author(css, base_url));
    }
    Ok(StyloSourceSelection {
        document_url,
        stylesheets,
    })
}

fn inventory_selected_css(
    source_index: usize,
    label: &str,
    css: &str,
) -> Result<(), StyloSourceRejection> {
    inventory_css(css).map_err(|failure| {
        #[cfg(feature = "bench-internals")]
        if std::env::var_os("RITO_STYLO_FALLBACK_DIAGNOSTICS").is_some() {
            eprintln!(
                "rito Stylo source gate rejected {label:?}; prefix={:?}",
                css.chars().take(96).collect::<String>()
            );
        }
        #[cfg(not(feature = "bench-internals"))]
        let _ = label;
        failure.with_source_index(source_index)
    })
}

/// Applies the same fail-closed property inventory to one `style` attribute.
/// The caller supplies a stable source-node index for diagnostics.
pub(crate) fn validate_stylo_inline_style(
    source_node_index: usize,
    declarations: &str,
) -> Result<(), StyloSourceRejection> {
    let wrapped = format!("*{{{declarations}}}");
    inventory_css(&wrapped).map_err(|failure| failure.with_source_index(source_node_index))
}

/// Validates source-level inputs that are not stylesheet rules. These checks
/// prevent a Stylo success from silently skipping a legacy presentational
/// hint or an HTML algorithm that the DOM-independent adapter cannot express.
pub(crate) fn validate_stylo_source_arena(
    source_arena: &SourceArena,
) -> Result<(), StyloSourceRejection> {
    for (node_id, node) in source_arena.iter() {
        let Some(element) = node.as_element() else {
            continue;
        };
        if let Some(declarations) = element.attribute("style") {
            validate_stylo_inline_style(node_id.index(), declarations)?;
        }
        if element
            .attribute("dir")
            .is_some_and(|value| value.trim().eq_ignore_ascii_case("auto"))
        {
            return Err(StyloSourceRejection::UnsupportedAttribute {
                source_index: node_id.index(),
                name: "dir=auto".to_owned(),
            });
        }
        if element.name.local_name.eq_ignore_ascii_case("body") {
            if let Some(value) = element.attribute("bgcolor") {
                const HTML_NAMESPACE: &str = "http://www.w3.org/1999/xhtml";
                if element.name.namespace.as_deref() != Some(HTML_NAMESPACE)
                    || !rito_stylo::supports_body_bgcolor_presentational_hint(value)
                {
                    return Err(StyloSourceRejection::UnsupportedAttribute {
                        source_index: node_id.index(),
                        name: "body@bgcolor".to_owned(),
                    });
                }
            }
        }
    }
    Ok(())
}

fn reject_source_issues(
    source_index: usize,
    source: &AuthorStylesheetSource,
) -> Result<(), StyloSourceRejection> {
    let (selection_issues, media_issues) = match source {
        AuthorStylesheetSource::External {
            selection_issues,
            media_environment_issues,
            ..
        }
        | AuthorStylesheetSource::Embedded {
            selection_issues,
            media_environment_issues,
            ..
        } => (selection_issues, media_environment_issues),
    };
    if !selection_issues.is_empty() {
        return Err(StyloSourceRejection::SelectionIssue {
            source_index,
            issue_index: 0,
        });
    }
    if !media_issues.is_empty() {
        return Err(StyloSourceRejection::MediaEnvironmentIssue {
            source_index,
            issue_index: 0,
        });
    }
    Ok(())
}

fn resolve_stylesheet_href(chapter_href: &str, stylesheet_href: &str) -> String {
    let normalized = stylesheet_href.replace('\\', "/");
    if normalized.starts_with('/') {
        normalize_path(normalized.trim_start_matches('/'))
    } else {
        normalize_path(&join_epub_href(opf_dir(chapter_href), &normalized))
    }
}

fn normalize_path(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    join_epub_href("", &normalized)
}

fn publication_url(href: &str) -> String {
    let path = normalize_path(href);
    let mut encoded = String::with_capacity(path.len());
    for byte in path.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~' | b'/' | b'%') {
            encoded.push(char::from(byte));
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    format!("https://rito.invalid/publication/{encoded}")
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum InventoryRejection {
    BackslashEscape,
    UnsupportedAtRule(String),
    UnsupportedProperty(String),
    CssNesting,
    UnsupportedPseudoElement(String),
    Syntax(CssInventoryFailure),
}

impl InventoryRejection {
    fn with_source_index(self, source_index: usize) -> StyloSourceRejection {
        match self {
            Self::BackslashEscape => StyloSourceRejection::BackslashEscape { source_index },
            Self::UnsupportedAtRule(name) => {
                StyloSourceRejection::UnsupportedAtRule { source_index, name }
            }
            Self::UnsupportedProperty(name) => {
                StyloSourceRejection::UnsupportedProperty { source_index, name }
            }
            Self::CssNesting => StyloSourceRejection::CssNesting { source_index },
            Self::UnsupportedPseudoElement(pseudo) => {
                StyloSourceRejection::UnsupportedPseudoElement {
                    source_index,
                    pseudo,
                }
            }
            Self::Syntax(reason) => StyloSourceRejection::UnreliableInventory {
                source_index,
                reason,
            },
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DeclarationContext {
    Style,
    Page,
    FontFace,
}

fn inventory_css(css: &str) -> Result<(), InventoryRejection> {
    if contains_backslash_escape(css) {
        return Err(InventoryRejection::BackslashEscape);
    }
    let mut scanner = CssScanner::new(css);
    while scanner.skip_trivia()? {
        if scanner.peek() == Some('@') {
            let name = scanner.consume_at_rule_name()?;
            let context = match name.as_str() {
                "page" => DeclarationContext::Page,
                "font-face" => DeclarationContext::FontFace,
                _ => return Err(InventoryRejection::UnsupportedAtRule(name)),
            };
            scanner.consume_prelude_open_brace(true)?;
            scanner.consume_declarations(context)?;
        } else {
            scanner.consume_prelude_open_brace(false)?;
            scanner.consume_declarations(DeclarationContext::Style)?;
        }
    }
    Ok(())
}

fn contains_backslash_escape(css: &str) -> bool {
    let mut cursor = 0;
    let mut quote = None;
    while cursor < css.len() {
        let character = css[cursor..].chars().next().expect("cursor is in bounds");
        if quote.is_none() && css[cursor..].starts_with("/*") {
            let Some(end) = css[cursor + 2..].find("*/") else {
                return false;
            };
            cursor += end + 4;
            continue;
        }
        if character == '\\' {
            return true;
        }
        match quote {
            Some(opening) if character == opening => quote = None,
            None if matches!(character, '\'' | '"') => quote = Some(character),
            _ => {}
        }
        cursor += character.len_utf8();
    }
    false
}

struct CssScanner<'a> {
    css: &'a str,
    cursor: usize,
}

impl<'a> CssScanner<'a> {
    fn new(css: &'a str) -> Self {
        Self { css, cursor: 0 }
    }

    fn peek(&self) -> Option<char> {
        self.css[self.cursor..].chars().next()
    }

    fn bump(&mut self) -> Option<char> {
        let character = self.peek()?;
        self.cursor += character.len_utf8();
        Some(character)
    }

    fn skip_trivia(&mut self) -> Result<bool, InventoryRejection> {
        loop {
            while self.peek().is_some_and(char::is_whitespace) {
                self.bump();
            }
            if !self.css[self.cursor..].starts_with("/*") {
                return Ok(self.peek().is_some());
            }
            let Some(end) = self.css[self.cursor + 2..].find("*/") else {
                return Err(InventoryRejection::Syntax(
                    CssInventoryFailure::UnterminatedComment,
                ));
            };
            self.cursor += end + 4;
        }
    }

    fn consume_at_rule_name(&mut self) -> Result<String, InventoryRejection> {
        let marker = self.bump();
        debug_assert_eq!(marker, Some('@'));
        let start = self.cursor;
        while self.peek().is_some_and(|character| {
            character.is_ascii_alphanumeric()
                || matches!(character, '-' | '_')
                || !character.is_ascii()
        }) {
            self.bump();
        }
        if self.cursor == start {
            return Err(InventoryRejection::Syntax(
                CssInventoryFailure::EmptyPrelude { offset: start },
            ));
        }
        Ok(self.css[start..self.cursor].to_ascii_lowercase())
    }

    fn consume_prelude_open_brace(&mut self, allow_empty: bool) -> Result<(), InventoryRejection> {
        let start = self.cursor;
        let mut parentheses = 0usize;
        let mut brackets = 0usize;
        loop {
            let Some(character) = self.bump() else {
                return Err(InventoryRejection::Syntax(
                    CssInventoryFailure::MissingBlock,
                ));
            };
            match character {
                '\'' | '"' => self.consume_string(character)?,
                '/' if self.peek() == Some('*') => self.consume_comment_after_slash()?,
                '(' => parentheses += 1,
                ')' if parentheses > 0 => parentheses -= 1,
                ')' => return Err(unexpected_delimiter()),
                '[' => brackets += 1,
                ']' if brackets > 0 => brackets -= 1,
                ']' => return Err(unexpected_delimiter()),
                '{' if parentheses == 0 && brackets == 0 => {
                    let prelude = self.css[start..self.cursor - 1].trim();
                    if !allow_empty && !prelude_contains_non_trivia(prelude)? {
                        return Err(InventoryRejection::Syntax(
                            CssInventoryFailure::EmptyPrelude { offset: start },
                        ));
                    }
                    if !allow_empty {
                        if let Some(pseudo) = unsupported_pseudo_element(prelude) {
                            return Err(InventoryRejection::UnsupportedPseudoElement(pseudo));
                        }
                    }
                    return Ok(());
                }
                ';' | '}' if parentheses == 0 && brackets == 0 => {
                    return Err(unexpected_delimiter());
                }
                _ => {}
            }
        }
    }

    fn consume_declarations(
        &mut self,
        context: DeclarationContext,
    ) -> Result<(), InventoryRejection> {
        loop {
            self.skip_trivia()?;
            while self.peek() == Some(';') {
                self.bump();
                self.skip_trivia()?;
            }
            if self.peek() == Some('}') {
                self.bump();
                return Ok(());
            }
            if self.peek().is_none() {
                return Err(InventoryRejection::Syntax(
                    CssInventoryFailure::UnterminatedBlock,
                ));
            }
            let property = self.consume_property_name()?;
            let declaration = self.consume_declaration_value()?;
            if !property_is_supported(&property, declaration.value, context) {
                return Err(InventoryRejection::UnsupportedProperty(property));
            }
            if declaration.closed_block {
                return Ok(());
            }
        }
    }

    fn consume_property_name(&mut self) -> Result<String, InventoryRejection> {
        let start = self.cursor;
        loop {
            match self.peek() {
                Some(':') => {
                    let property = self.css[start..self.cursor].trim().to_ascii_lowercase();
                    self.bump();
                    if property.is_empty()
                        || !property
                            .chars()
                            .all(|character| character.is_ascii_alphanumeric() || character == '-')
                    {
                        return Err(InventoryRejection::Syntax(
                            CssInventoryFailure::MissingColon,
                        ));
                    }
                    return Ok(property);
                }
                Some('{') => return Err(InventoryRejection::CssNesting),
                Some(';') | Some('}') | None => {
                    return Err(InventoryRejection::Syntax(
                        CssInventoryFailure::MissingColon,
                    ));
                }
                Some('\'' | '"') => {
                    return Err(InventoryRejection::Syntax(
                        CssInventoryFailure::MissingColon,
                    ));
                }
                Some(_) => {
                    self.bump();
                }
            }
        }
    }

    fn consume_declaration_value(&mut self) -> Result<ConsumedDeclaration<'a>, InventoryRejection> {
        let start = self.cursor;
        let mut parentheses = 0usize;
        let mut brackets = 0usize;
        loop {
            let Some(character) = self.bump() else {
                return Err(InventoryRejection::Syntax(
                    CssInventoryFailure::UnterminatedBlock,
                ));
            };
            match character {
                '\'' | '"' => self.consume_string(character)?,
                '/' if self.peek() == Some('*') => self.consume_comment_after_slash()?,
                '(' => parentheses += 1,
                ')' if parentheses > 0 => parentheses -= 1,
                ')' => return Err(unexpected_delimiter()),
                '[' => brackets += 1,
                ']' if brackets > 0 => brackets -= 1,
                ']' => return Err(unexpected_delimiter()),
                '{' => return Err(InventoryRejection::CssNesting),
                ';' if parentheses == 0 && brackets == 0 => {
                    return Ok(ConsumedDeclaration {
                        value: self.css[start..self.cursor - 1].trim(),
                        closed_block: false,
                    });
                }
                '}' if parentheses == 0 && brackets == 0 => {
                    return Ok(ConsumedDeclaration {
                        value: self.css[start..self.cursor - 1].trim(),
                        closed_block: true,
                    });
                }
                _ => {}
            }
        }
    }

    fn consume_string(&mut self, quote: char) -> Result<(), InventoryRejection> {
        loop {
            match self.bump() {
                Some(character) if character == quote => return Ok(()),
                Some('\n' | '\r') | None => {
                    return Err(InventoryRejection::Syntax(
                        CssInventoryFailure::UnterminatedString,
                    ));
                }
                Some(_) => {}
            }
        }
    }

    fn consume_comment_after_slash(&mut self) -> Result<(), InventoryRejection> {
        let marker = self.bump();
        debug_assert_eq!(marker, Some('*'));
        let Some(end) = self.css[self.cursor..].find("*/") else {
            return Err(InventoryRejection::Syntax(
                CssInventoryFailure::UnterminatedComment,
            ));
        };
        self.cursor += end + 2;
        Ok(())
    }
}

struct ConsumedDeclaration<'a> {
    value: &'a str,
    closed_block: bool,
}

fn prelude_contains_non_trivia(prelude: &str) -> Result<bool, InventoryRejection> {
    CssScanner::new(prelude).skip_trivia()
}

fn unexpected_delimiter() -> InventoryRejection {
    InventoryRejection::Syntax(CssInventoryFailure::UnexpectedDelimiter)
}

fn unsupported_pseudo_element(selector: &str) -> Option<String> {
    let lowercase = selector.to_ascii_lowercase();
    let mut cursor = 0;
    while cursor < lowercase.len() {
        if lowercase[cursor..].starts_with("/*") {
            let end = lowercase[cursor + 2..].find("*/")?;
            cursor += end + 4;
            continue;
        }
        let character = lowercase[cursor..].chars().next()?;
        if matches!(character, '\'' | '"') {
            let tail = &lowercase[cursor + 1..];
            let end = tail.find(character)?;
            cursor += end + 2;
            continue;
        }
        if character == ':' {
            if lowercase[cursor..].starts_with("::") {
                let mut end = cursor + 2;
                while lowercase[end..]
                    .chars()
                    .next()
                    .is_some_and(|next| next.is_ascii_alphanumeric() || next == '-')
                {
                    end += lowercase[end..]
                        .chars()
                        .next()
                        .expect("checked above")
                        .len_utf8();
                }
                return Some(lowercase[cursor..end].to_owned());
            }
            for pseudo in [":before", ":after", ":first-letter", ":first-line"] {
                if lowercase[cursor..].starts_with(pseudo) {
                    let end = cursor + pseudo.len();
                    let bounded = lowercase[end..]
                        .chars()
                        .next()
                        .is_none_or(|next| !(next.is_ascii_alphanumeric() || next == '-'));
                    if bounded {
                        return Some(pseudo.to_owned());
                    }
                }
            }
        }
        cursor += character.len_utf8();
    }
    None
}

fn property_is_supported(property: &str, value: &str, context: DeclarationContext) -> bool {
    match context {
        DeclarationContext::FontFace => matches!(
            property,
            "font-family" | "src" | "font-style" | "font-weight"
        ),
        DeclarationContext::Page | DeclarationContext::Style => {
            style_property_has_typed_bridge(property)
                || legacy_compatible_noop_property(property)
                || (property == "list-style" && safe_list_style_shorthand(value))
        }
    }
}

fn legacy_compatible_noop_property(property: &str) -> bool {
    // Keep this list deliberately explicit. The compatibility parser has no
    // branch for either declaration, and neither value is consumed elsewhere
    // in layout/render. Admitting them therefore removes parser work without
    // silently dropping behavior that Rito previously implemented.
    matches!(
        property,
        "-epub-text-emphasis-position"
            | "-epub-text-emphasis-style"
            | "-moz-overflow"
            | "-moz-transform"
            | "-moz-white-space"
            | "-ms-transform"
            | "-o-transform"
            | "-webkit-overflow"
            | "-webkit-text-emphasis"
            | "-webkit-text-emphasis-color"
            | "-webkit-text-emphasis-position"
            | "-webkit-text-emphasis-style"
            | "-webkit-transform"
            | "-webkit-white-space"
            | "background-attachment"
            | "border-collapse"
            | "border-spacing"
            | "duokan-bleed"
            | "duokan-text-indent"
            | "max-wdith"
            | "page-break-inside"
            | "ruby-align"
            | "text-emphasis"
            | "text-emphasis-color"
            | "text-emphasis-position"
            | "text-emphasis-style"
            | "xmlns"
    )
}

fn safe_list_style_shorthand(value: &str) -> bool {
    // The legacy parser only extracted a known marker type from this
    // shorthand. Restrict the migration bridge to the corpus form whose
    // standard shorthand reset and legacy behavior are identical. Other
    // list-style values stay fail-closed until position/image are contracted.
    let normalized = value.trim().to_ascii_lowercase();
    normalized
        .strip_suffix("!important")
        .unwrap_or(&normalized)
        .trim()
        == "none"
}

fn style_property_has_typed_bridge(property: &str) -> bool {
    matches!(
        property,
        "color"
            | "clear"
            | "display"
            | "break-before"
            | "break-after"
            | "page-break-before"
            | "page-break-after"
            | "align-items"
            | "justify-content"
            | "flex-direction"
            | "flex-wrap"
            | "float"
            | "width"
            | "max-width"
            | "height"
            | "min-height"
            | "max-height"
            | "line-height"
            | "list-style-type"
            | "text-align"
            | "text-indent"
            | "vertical-align"
            | "word-break"
            | "word-wrap"
            | "background"
            | "background-color"
            | "background-image"
            | "background-position"
            | "background-repeat"
            | "background-size"
            | "box-shadow"
            | "text-shadow"
            | "letter-spacing"
            | "word-spacing"
            | "white-space"
            | "line-break"
            | "text-transform"
            | "transform"
            | "text-justify"
            | "direction"
            | "unicode-bidi"
            | "writing-mode"
            | "overflow-wrap"
            | "overflow"
            | "opacity"
            | "border"
            | "border-width"
            | "border-style"
            | "border-color"
            | "border-top"
            | "border-right"
            | "border-bottom"
            | "border-left"
            | "border-top-width"
            | "border-right-width"
            | "border-bottom-width"
            | "border-left-width"
            | "border-top-style"
            | "border-right-style"
            | "border-bottom-style"
            | "border-left-style"
            | "border-top-color"
            | "border-right-color"
            | "border-bottom-color"
            | "border-left-color"
            | "border-block"
            | "border-inline"
            | "border-block-width"
            | "border-inline-width"
            | "border-block-style"
            | "border-inline-style"
            | "border-block-color"
            | "border-inline-color"
            | "border-block-start"
            | "border-block-end"
            | "border-inline-start"
            | "border-inline-end"
            | "border-block-start-width"
            | "border-block-end-width"
            | "border-inline-start-width"
            | "border-inline-end-width"
            | "border-block-start-style"
            | "border-block-end-style"
            | "border-inline-start-style"
            | "border-inline-end-style"
            | "border-block-start-color"
            | "border-block-end-color"
            | "border-inline-start-color"
            | "border-inline-end-color"
            | "border-radius"
            | "margin"
            | "margin-top"
            | "margin-right"
            | "margin-bottom"
            | "margin-left"
            | "margin-block"
            | "margin-inline"
            | "margin-block-start"
            | "margin-block-end"
            | "margin-inline-start"
            | "margin-inline-end"
            | "padding"
            | "padding-top"
            | "padding-right"
            | "padding-bottom"
            | "padding-left"
            | "padding-block"
            | "padding-inline"
            | "padding-block-start"
            | "padding-block-end"
            | "padding-inline-start"
            | "padding-inline-end"
            | "text-decoration"
            | "text-decoration-line"
            | "text-decoration-style"
            | "text-decoration-color"
            | "font-family"
            | "font-size"
            | "font-style"
            | "font-weight"
    )
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use rito_source::SourceArena;

    use super::{
        inventory_css, publication_url, select_stylo_sources, validate_stylo_inline_style,
        validate_stylo_source_arena, CssInventoryFailure, InventoryRejection, StyloSourceRejection,
    };
    use crate::{
        epub::{
            prepare_loaded_document_base, LoadedEpubDocument, LoadedTextResource, PackageDocument,
            PackageMetadata,
        },
        xhtml::AuthorStylesheetSource,
    };

    fn source_id() -> rito_source::NodeId {
        Arc::new(SourceArena::from_xhtml("<html><head/></html>").unwrap()).root()
    }

    fn ledger(stylesheets: &[(&str, &str)]) -> crate::epub::StylesheetSourceLedger {
        let document = LoadedEpubDocument {
            package: PackageDocument {
                metadata: PackageMetadata {
                    title: String::new(),
                    language: String::new(),
                    identifier: String::new(),
                    creator: None,
                },
                manifest: Vec::new(),
                spine: Vec::new(),
                toc: Vec::new(),
            },
            stylesheets: stylesheets
                .iter()
                .map(|(href, text)| LoadedTextResource {
                    href: (*href).to_owned(),
                    text: (*text).to_owned(),
                })
                .collect(),
            fonts: Vec::new(),
            images: Vec::new(),
            chapters: Vec::new(),
            archive_source: None,
        };
        prepare_loaded_document_base(&document).stylesheet_ledger
    }

    #[test]
    fn admits_book10_property_surface_and_safe_at_rules() {
        let css = r#"
            @page { margin: 0; }
            @font-face { font-family: Reader; src: url(font.woff2); font-weight: 700; }
            article { border: 1px solid; border-radius: 2px; color: #111; display: block;
                font-family: serif; font-size: 1rem; height: 2em; min-height: 0;
                max-height: 100%; width: 90%; max-width: 100%; line-height: 1.5;
                list-style-type: decimal; margin: 0; padding-inline: 1em; text-align: justify;
                text-decoration: underline; text-indent: 1em; vertical-align: baseline;
                word-break: normal; word-wrap: break-word; background-color: white;
                background-image: url(../Images/paper.png); background-repeat: no-repeat;
                background-position: top center; background-size: cover;
                box-shadow: none; text-shadow: none; letter-spacing: normal; word-spacing: normal;
                white-space: normal; line-break: auto; text-transform: none; text-justify: auto;
                transform: rotate(5deg);
                direction: ltr; unicode-bidi: normal; writing-mode: horizontal-tb;
                clear: both; float: right; overflow: hidden; overflow-wrap: anywhere; }
        "#;
        assert_eq!(inventory_css(css), Ok(()));
    }

    #[test]
    fn admits_only_audited_legacy_noops_and_safe_list_style_shorthand() {
        assert_eq!(
            inventory_css(
                "table { border-collapse: collapse; border-spacing: 0; } \
                 p { duokan-bleed: leftright; duokan-text-indent: -2em; } \
                 ruby { ruby-align: center; text-emphasis: circle #000; } \
                 .compat { -webkit-transform: rotate(5deg); -webkit-overflow: hidden; \
                           page-break-inside: avoid; max-wdith: 100%; } \
                 ol { list-style: NONE !IMPORTANT; }"
            ),
            Ok(())
        );
        for value in ["inside", "disc", "url(marker.png)", "none inside"] {
            let css = format!("ol {{ list-style: {value}; }}");
            assert!(matches!(
                inventory_css(&css),
                Err(InventoryRejection::UnsupportedProperty(name)) if name == "list-style"
            ));
        }
    }

    #[test]
    fn preserves_document_order_and_assigns_source_specific_base_urls() {
        let ledger = ledger(&[("Styles/book.css", "p { color: red }")]);
        let sources = vec![
            AuthorStylesheetSource::Embedded {
                source_node_id: source_id(),
                css: "h1 { margin: 0 }".to_owned(),
                selection_issues: Vec::new(),
                media_environment_issues: Vec::new(),
            },
            AuthorStylesheetSource::External {
                source_node_id: source_id(),
                href: "../Styles/book.css".to_owned(),
                selection_issues: Vec::new(),
                media_environment_issues: Vec::new(),
            },
        ];
        let selection = select_stylo_sources(&ledger, "Text/chapter.xhtml", &sources).unwrap();
        assert_eq!(selection.stylesheets[0].css, "h1 { margin: 0 }");
        assert_eq!(selection.stylesheets[0].base_url, selection.document_url);
        assert_eq!(selection.stylesheets[1].css, "p { color: red }");
        assert_eq!(
            selection.stylesheets[1].base_url,
            "https://rito.invalid/publication/Styles/book.css"
        );
    }

    #[test]
    fn preserves_implicit_all_publication_stylesheets_compatibility() {
        let ledger = ledger(&[
            ("Styles/first.css", "p { color: red }"),
            ("Styles/second.css", "p { color: blue }"),
        ]);
        let embedded = AuthorStylesheetSource::Embedded {
            source_node_id: source_id(),
            css: "p { color: green }".to_owned(),
            selection_issues: Vec::new(),
            media_environment_issues: Vec::new(),
        };
        let selection = select_stylo_sources(&ledger, "Text/chapter.xhtml", &[embedded]).unwrap();
        assert_eq!(selection.stylesheets.len(), 3);
        assert_eq!(selection.stylesheets[0].css, "p { color: red }");
        assert_eq!(selection.stylesheets[1].css, "p { color: blue }");
        assert_eq!(selection.stylesheets[2].css, "p { color: green }");
    }

    #[test]
    fn requires_one_exact_external_ledger_match() {
        let ledger = ledger(&[
            ("Styles/book.css", "p { color: red }"),
            ("Styles/book.css", "p { color: blue }"),
        ]);
        let source = AuthorStylesheetSource::External {
            source_node_id: source_id(),
            href: "../Styles/book.css".to_owned(),
            selection_issues: Vec::new(),
            media_environment_issues: Vec::new(),
        };
        assert!(matches!(
            select_stylo_sources(&ledger, "Text/chapter.xhtml", &[source]),
            Err(StyloSourceRejection::ExternalStylesheetAmbiguous { matches: 2, .. })
        ));
    }

    #[test]
    fn rejects_known_unsupported_contract_properties_and_at_rules() {
        assert!(matches!(
            inventory_css("p { background-origin: content-box }"),
            Err(InventoryRejection::UnsupportedProperty(name)) if name == "background-origin"
        ));
        assert!(matches!(
            inventory_css("@media print { p { color: black } }"),
            Err(InventoryRejection::UnsupportedAtRule(name)) if name == "media"
        ));
        assert!(matches!(
            inventory_css("@import url(book.css);"),
            Err(InventoryRejection::UnsupportedAtRule(name)) if name == "import"
        ));
        for property in [
            "font-feature-settings",
            "font-variation-settings",
            "border-image",
            "border-top-left-radius",
            "border-top-right-radius",
            "border-bottom-left-radius",
            "border-bottom-right-radius",
            "border-start-start-radius",
            "border-start-end-radius",
            "border-end-start-radius",
            "border-end-end-radius",
        ] {
            let css = format!("table {{ {property}: normal }}");
            assert!(matches!(
                inventory_css(&css),
                Err(InventoryRejection::UnsupportedProperty(name)) if name == property
            ));
        }
    }

    #[test]
    fn rejects_all_pseudo_elements_until_materialization_exists() {
        for pseudo in [
            "p::before",
            "p::after",
            "li::marker",
            "p::first-letter",
            "p::first-line",
            "p:before",
            "p:after",
            "p:first-letter",
            "p:first-line",
        ] {
            let css = format!("{pseudo} {{ color: red }}");
            assert!(matches!(
                inventory_css(&css),
                Err(InventoryRejection::UnsupportedPseudoElement(_))
            ));
        }
        assert_eq!(
            inventory_css(r#"[data-label="::before"] { color: red }"#),
            Ok(())
        );
    }

    #[test]
    fn rejects_escapes_nesting_and_unreliable_syntax() {
        assert_eq!(
            inventory_css(r#".\31 0 { color: red }"#),
            Err(InventoryRejection::BackslashEscape)
        );
        assert_eq!(
            inventory_css(r#"p { font-family: "/* \\ */" }"#),
            Err(InventoryRejection::BackslashEscape)
        );
        assert_eq!(
            inventory_css("@page_name { margin: 0 }").unwrap_err(),
            InventoryRejection::UnsupportedAtRule("page_name".to_owned())
        );
        assert!(matches!(
            inventory_css("/**/ { color: red }"),
            Err(InventoryRejection::Syntax(
                CssInventoryFailure::EmptyPrelude { .. }
            ))
        ));
        assert_eq!(
            inventory_css(".a { color: red; & .b { color: blue } }"),
            Err(InventoryRejection::CssNesting)
        );
        assert_eq!(
            inventory_css("p { color: red"),
            Err(InventoryRejection::Syntax(
                CssInventoryFailure::UnterminatedBlock
            ))
        );
    }

    #[test]
    fn constructs_stable_percent_encoded_publication_urls() {
        assert_eq!(
            publication_url("Text/chapter one.xhtml#start"),
            "https://rito.invalid/publication/Text/chapter%20one.xhtml"
        );
    }

    #[test]
    fn inventories_inline_style_declarations_without_the_legacy_parser() {
        assert_eq!(
            validate_stylo_inline_style(42, "font-size: 1rem; color: navy"),
            Ok(())
        );
        assert_eq!(validate_stylo_inline_style(42, "opacity: .5"), Ok(()));
    }

    #[test]
    fn admits_standard_and_legacy_page_break_aliases_to_the_typed_bridge() {
        assert_eq!(
            inventory_css(
                "p { break-before: page; break-after: auto; \
                      page-break-before: always; page-break-after: auto; }"
            ),
            Ok(())
        );
        assert_eq!(
            validate_stylo_inline_style(42, "page-break-before: always; break-after: page"),
            Ok(())
        );
        for name in [
            "--rito-internal-break-before-v1",
            "--rito-internal-break-after-v1",
        ] {
            let declarations = format!("{name}: always");
            assert!(matches!(
                validate_stylo_inline_style(42, &declarations),
                Err(StyloSourceRejection::UnsupportedProperty {
                    source_index: 42,
                    name: rejected,
                }) if rejected == name
            ));
        }
    }

    #[test]
    fn rejects_source_semantics_without_an_exact_stylo_bridge() {
        for (source, expected_name) in [
            (
                r#"<html><body bgcolor="transparent"><p>text</p></body></html>"#,
                "body@bgcolor",
            ),
            (
                r#"<html><body><p dir="auto">text</p></body></html>"#,
                "dir=auto",
            ),
        ] {
            let arena = SourceArena::from_xhtml(source).unwrap();
            assert!(matches!(
                validate_stylo_source_arena(&arena),
                Err(StyloSourceRejection::UnsupportedAttribute { name, .. })
                    if name == expected_name
            ));
        }
        let supported = SourceArena::from_xhtml(r##"<html xmlns="http://www.w3.org/1999/xhtml"><body bgcolor="#fff"><p>text</p></body></html>"##).unwrap();
        assert_eq!(validate_stylo_source_arena(&supported), Ok(()));

        let namespace_mismatch =
            SourceArena::from_xhtml(r##"<html><body bgcolor="#fff"><p>text</p></body></html>"##)
                .unwrap();
        assert!(matches!(
            validate_stylo_source_arena(&namespace_mismatch),
            Err(StyloSourceRejection::UnsupportedAttribute { name, .. })
                if name == "body@bgcolor"
        ));
    }
}
