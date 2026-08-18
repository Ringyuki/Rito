//! Construction of production Stylo stylesheet inputs.
//!
//! This module deliberately inventories CSS with a small lexer instead of
//! invoking the compatibility parser. Declarations outside the production
//! style contract are recorded as capability divergences and admitted —
//! Stylo still parses them, and the typed projection only reads contracted
//! fields — so a publication is never refused for asking more than the
//! engine can represent. Only the reserved engine-internal property
//! namespace keeps a hard rejection. `@page` remains a compatibility no-op;
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
    pub(crate) capabilities: StyleCapabilityReport,
}

/// How a publication's CSS diverges from what this engine can represent.
///
/// CSS is designed so that content an engine cannot understand is dropped and
/// the rest still applies; that is the mechanism which lets stylesheets target
/// many engines at once. Rito therefore records divergence instead of refusing
/// the publication, and reserves failure for damage a reader would act on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum StyleCapabilityImpact {
    /// The declaration cannot change this engine's layout or paint, so
    /// dropping it renders exactly what a supporting engine would render.
    Ignored,
    /// The declaration would have changed rendering. Output stays readable and
    /// self-consistent, but it is not what the author specified.
    Degraded,
}

/// One recorded divergence between a publication's CSS and this engine.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StyleCapabilityNote {
    pub(crate) impact: StyleCapabilityImpact,
    pub(crate) source_index: usize,
    pub(crate) subject: String,
}

/// Per-chapter capability observations, ordered and deduplicated so a
/// publication-level report stays stable and bounded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StyleCapabilityReport {
    notes: Vec<StyleCapabilityNote>,
    complete: bool,
}

impl Default for StyleCapabilityReport {
    fn default() -> Self {
        Self {
            notes: Vec::new(),
            complete: true,
        }
    }
}

impl StyleCapabilityReport {
    pub(crate) fn record(
        &mut self,
        impact: StyleCapabilityImpact,
        source_index: usize,
        subject: impl Into<String>,
    ) {
        let note = StyleCapabilityNote {
            impact,
            source_index,
            subject: subject.into(),
        };
        if let Err(position) = self.notes.binary_search(&note) {
            self.notes.insert(position, note);
        }
    }

    /// Production reads this record through [`Self::summary`]; these expose
    /// the pre-projection state so tests can lock the classification itself.
    #[cfg(test)]
    pub(crate) fn notes(&self) -> &[StyleCapabilityNote] {
        &self.notes
    }

    #[cfg(test)]
    pub(crate) fn is_empty(&self) -> bool {
        self.notes.is_empty()
    }

    #[cfg(test)]
    pub(crate) fn is_complete(&self) -> bool {
        self.complete
    }

    pub(crate) fn mark_incomplete(&mut self) {
        self.complete = false;
    }

    /// Merges another chapter's observations into a publication-wide record.
    pub(crate) fn absorb(&mut self, other: Self) {
        self.complete &= other.complete;
        for note in other.notes {
            if let Err(position) = self.notes.binary_search(&note) {
                self.notes.insert(position, note);
            }
        }
    }

    /// Projects the publication-facing summary.
    pub(crate) fn summary(&self) -> crate::epub::StyleCapabilitySummary {
        let subjects = |impact| {
            self.notes
                .iter()
                .filter(|note| note.impact == impact)
                .map(|note| note.subject.clone())
                .collect::<Vec<_>>()
        };
        crate::epub::StyleCapabilitySummary {
            ignored: subjects(StyleCapabilityImpact::Ignored),
            degraded: subjects(StyleCapabilityImpact::Degraded),
            complete: self.complete,
        }
    }
}

impl Ord for StyleCapabilityNote {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        (self.impact, self.source_index, &self.subject).cmp(&(
            other.impact,
            other.source_index,
            &other.subject,
        ))
    }
}

impl PartialOrd for StyleCapabilityNote {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
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
    let mut capabilities = StyleCapabilityReport::default();

    // Preserve the compatibility contract used by documents constructed
    // through the public LoadedEpubDocument API: when XHTML has no link
    // occurrence, every publication stylesheet precedes embedded sheets.
    if !has_external_source {
        for source in stylesheet_ledger.sources() {
            let source_index = stylesheets.len();
            let expanded = expand_css_imports(
                source.text(),
                source.href(),
                stylesheet_ledger,
                &mut vec![normalize_path(source.href())],
            );
            inventory_selected_css(source_index, source.href(), &expanded, &mut capabilities)?;
            stylesheets.push(StylesheetInput::author(
                expanded,
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
                    // Publications routinely list one stylesheet twice.
                    // Identical duplicates carry no choice to get wrong; only
                    // differing texts are genuinely ambiguous.
                    [first, rest @ ..] if rest.iter().all(|c| c.text() == first.text()) => *first,
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
        let import_base = match source {
            AuthorStylesheetSource::Embedded { .. } => chapter_href.to_owned(),
            AuthorStylesheetSource::External { href, .. } => {
                resolve_stylesheet_href(chapter_href, href)
            }
        };
        let expanded = expand_css_imports(
            css,
            &import_base,
            stylesheet_ledger,
            &mut vec![normalize_path(&import_base)],
        );
        inventory_selected_css(source_index, &base_url, &expanded, &mut capabilities)?;
        stylesheets.push(StylesheetInput::author(expanded, base_url));
    }
    Ok(StyloSourceSelection {
        document_url,
        stylesheets,
        capabilities,
    })
}

/// Inventories one selected stylesheet.
///
/// Content this engine cannot represent is recorded rather than rejected: CSS
/// drops what an engine does not understand and applies the rest, so refusing
/// the publication would make Rito the only engine that cannot open a book its
/// author styled for several. Only damage a reader would act on — content this
/// scanner cannot even traverse, or an injection guard — still fails closed.
fn inventory_selected_css(
    source_index: usize,
    label: &str,
    css: &str,
    capabilities: &mut StyleCapabilityReport,
) -> Result<(), StyloSourceRejection> {
    let Err(failure) = inventory_css(css) else {
        return Ok(());
    };
    if let Some((impact, subject)) = failure.capability_note() {
        capabilities.record(impact, source_index, subject);
        return Ok(());
    }
    if failure.leaves_inventory_incomplete() {
        capabilities.mark_incomplete();
        return Ok(());
    }
    #[cfg(feature = "bench-internals")]
    if std::env::var_os("RITO_STYLO_FALLBACK_DIAGNOSTICS").is_some() {
        eprintln!(
            "rito Stylo source gate rejected {label:?}; prefix={:?}",
            css.chars().take(96).collect::<String>()
        );
    }
    #[cfg(not(feature = "bench-internals"))]
    let _ = label;
    Err(failure.with_source_index(source_index))
}

/// Applies the same capability inventory to one `style` attribute. Content
/// the engine cannot represent is recorded and admitted — Stylo still parses
/// the attribute, and the typed projection only reads contracted fields — so
/// only the reserved-namespace escape hatch keeps a hard rejection.
pub(crate) fn validate_stylo_inline_style(
    source_node_index: usize,
    declarations: &str,
    capabilities: &mut StyleCapabilityReport,
) -> Result<(), StyloSourceRejection> {
    let wrapped = format!("*{{{declarations}}}");
    let Err(failure) = inventory_css(&wrapped) else {
        return Ok(());
    };
    if let Some((impact, subject)) = failure.capability_note() {
        capabilities.record(impact, source_node_index, subject);
        return Ok(());
    }
    if failure.leaves_inventory_incomplete() {
        capabilities.mark_incomplete();
        return Ok(());
    }
    Err(failure.with_source_index(source_node_index))
}

/// Validates source-level inputs that are not stylesheet rules. Legacy
/// presentational hints and HTML algorithms the DOM-independent adapter
/// cannot express are recorded as capability divergences and skipped, so a
/// single attribute never refuses a publication.
pub(crate) fn validate_stylo_source_arena(
    source_arena: &SourceArena,
    capabilities: &mut StyleCapabilityReport,
) -> Result<(), StyloSourceRejection> {
    for (node_id, node) in source_arena.iter() {
        let Some(element) = node.as_element() else {
            continue;
        };
        if let Some(declarations) = element.attribute("style") {
            validate_stylo_inline_style(node_id.index(), declarations, capabilities)?;
        }
        if element
            .attribute("dir")
            .is_some_and(|value| value.trim().eq_ignore_ascii_case("auto"))
        {
            // First-strong bidi detection is not implemented; the element
            // keeps its inherited direction.
            capabilities.record(
                StyleCapabilityImpact::Degraded,
                node_id.index(),
                "attribute dir=auto",
            );
        }
        if element.name.local_name.eq_ignore_ascii_case("body") {
            if let Some(value) = element.attribute("bgcolor") {
                const HTML_NAMESPACE: &str = "http://www.w3.org/1999/xhtml";
                if element.name.namespace.as_deref() != Some(HTML_NAMESPACE)
                    || !rito_stylo::supports_body_bgcolor_presentational_hint(value)
                {
                    capabilities.record(
                        StyleCapabilityImpact::Degraded,
                        node_id.index(),
                        "attribute body@bgcolor",
                    );
                }
            }
        }
        // `width`/`height` on `<svg>` are presentation attributes (SVG 2
        // §7.2) that the Stylo adapter synthesizes as hints. An invalid
        // value is ignored by browsers just as it is here, and outside the
        // SVG namespace neither side applies the attribute, so the only
        // divergence worth recording is an in-namespace, non-empty value
        // the adapter cannot represent while a browser's own grammar might.
        if element.name.local_name == "svg" {
            const SVG_NAMESPACE: &str = "http://www.w3.org/2000/svg";
            if element.name.namespace.as_deref() == Some(SVG_NAMESPACE) {
                for (name, subject) in
                    [("width", "attribute svg@width"), ("height", "attribute svg@height")]
                {
                    let Some(value) = element.attribute(name) else {
                        continue;
                    };
                    if !value.trim().is_empty()
                        && !rito_stylo::supports_svg_geometry_presentational_hint(value)
                    {
                        capabilities.record(
                            StyleCapabilityImpact::Degraded,
                            node_id.index(),
                            subject,
                        );
                    }
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


/// Expands a sheet's `@import` rules by inlining the imported
/// publication sheet's text at the rule's position, recursively. CSS
/// honours imports only in the sheet's prelude — before any rule other
/// than `@charset`/`@import` — and so does this expansion; later
/// `@import` text stays put and drops in the parser like the browser's.
/// A missing target, an import cycle, or a media list naming anything
/// beyond `all`/`screen` drops the import the way the browser would in
/// this environment. Without the expansion a publication styled through
/// `@import` chains lost its entire author cascade (a real book's
/// paragraphs fell to UA defaults: `line-height: normal`, uncollapsed
/// 1em margins, no text-indent — every page paginated apart from the
/// browser's).
/// Skips a CSS comment body, returning the index after `*/` (or the end).
fn skip_css_comment(bytes: &[u8], mut index: usize) -> usize {
    while index + 1 < bytes.len() {
        if bytes[index] == b'*' && bytes[index + 1] == b'/' {
            return index + 2;
        }
        index += 1;
    }
    bytes.len()
}

fn expand_css_imports(
    css: &str,
    sheet_href: &str,
    ledger: &StylesheetSourceLedger,
    seen: &mut Vec<String>,
) -> String {
    if seen.len() > 8 {
        return css.to_owned();
    }
    let bytes = css.as_bytes();
    let mut out = String::with_capacity(css.len());
    let mut index = 0;
    loop {
        let rest_start = index;
        // Skip prelude whitespace and comments, copying them through.
        while index < bytes.len() {
            if bytes[index].is_ascii_whitespace() {
                index += 1;
                continue;
            }
            if bytes[index..].starts_with(b"/*") {
                index = skip_css_comment(bytes, index + 2);
                continue;
            }
            break;
        }
        out.push_str(&css[rest_start..index]);
        let lower = css[index..].as_bytes();
        if lower.len() >= 8 && css[index..index + 8].eq_ignore_ascii_case("@charset") {
            let end = css[index..].find(';').map_or(css.len(), |at| index + at + 1);
            out.push_str(&css[index..end]);
            index = end;
            continue;
        }
        if !(lower.len() >= 7 && css[index..index + 7].eq_ignore_ascii_case("@import")) {
            out.push_str(&css[index..]);
            return out;
        }
        let end = css[index..].find(';').map_or(css.len(), |at| index + at + 1);
        let statement = &css[index + 7..end.saturating_sub(1).max(index + 7)];
        index = end;
        let Some((target, media)) = parse_import_target(statement) else {
            continue;
        };
        let media = media.trim();
        if !media.is_empty()
            && !media
                .split(',')
                .all(|entry| matches!(entry.trim().to_ascii_lowercase().as_str(), "all" | "screen"))
        {
            continue;
        }
        let sheet_dir = opf_dir(sheet_href);
        let resolved = if target.starts_with('/') {
            normalize_path(target.trim_start_matches('/'))
        } else {
            normalize_path(&join_epub_href(sheet_dir, &target))
        };
        if seen.iter().any(|entry| *entry == resolved) {
            continue;
        }
        let Some(imported) = ledger
            .sources()
            .iter()
            .find(|candidate| normalize_path(candidate.href()) == resolved)
        else {
            continue;
        };
        seen.push(resolved);
        let expanded = expand_css_imports(imported.text(), imported.href(), ledger, seen);
        out.push_str(&expanded);
        out.push('\n');
    }
}

/// The import target (unquoted) and the trailing media text of one
/// `@import` statement body (everything between `@import` and `;`).
fn parse_import_target(statement: &str) -> Option<(String, String)> {
    let trimmed = statement.trim_start();
    if trimmed.len() >= 4 && trimmed[..4].eq_ignore_ascii_case("url(") {
        let inner_start = 4;
        let close = trimmed.find(')')?;
        let inner = trimmed[inner_start..close].trim();
        let target = inner.trim_matches('"').trim_matches('\'');
        return Some((target.to_owned(), trimmed[close + 1..].to_owned()));
    }
    let quote = trimmed.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let body = &trimmed[1..];
    let close = body.find(quote)?;
    Some((body[..close].to_owned(), body[close + 1..].to_owned()))
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
    /// Classifies content this engine cannot represent, or `None` when the
    /// publication must fail closed.
    fn capability_note(&self) -> Option<(StyleCapabilityImpact, String)> {
        match self {
            // The reserved engine-internal namespace must never be
            // author-declarable, so it keeps a hard rejection.
            Self::UnsupportedProperty(name) if name.starts_with(RITO_INTERNAL_PROPERTY_PREFIX) => {
                None
            }
            // A property outside the typed contract cannot reach layout or
            // paint at all, so dropping it matches what CSS itself specifies.
            Self::UnsupportedProperty(name) => {
                Some((StyleCapabilityImpact::Ignored, format!("property {name}")))
            }
            // An unhandled at-rule may carry declarations that would have
            // applied, so its content is lost rather than inert.
            Self::UnsupportedAtRule(name) => {
                Some((StyleCapabilityImpact::Degraded, format!("@{name}")))
            }
            // Generated content is skipped; surrounding text still renders.
            Self::UnsupportedPseudoElement(pseudo) => {
                Some((StyleCapabilityImpact::Degraded, format!("pseudo {pseudo}")))
            }
            // This crude scanner sits in front of a real CSS parser: Stylo
            // resolves nesting natively and recovers from syntax this scanner
            // cannot traverse. Its own limits must not refuse a publication;
            // they only bound what this report can claim.
            Self::CssNesting | Self::Syntax(_) => None,
            // The reserved `--rito-internal-` namespace is enforced on raw
            // property names, so an escape that could spell one past this
            // scanner is the one case that must still fail closed.
            Self::BackslashEscape => None,
        }
    }

    /// Whether this scanner simply could not finish, leaving Stylo as the
    /// only authority on the stylesheet's content.
    fn leaves_inventory_incomplete(&self) -> bool {
        matches!(self, Self::CssNesting | Self::Syntax(_))
    }

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
    inventory_rules(&mut scanner, 0)
}

/// Maximum conditional-group nesting this inventory walks. Deeper nesting is
/// rejected rather than scanned so a publication cannot drive unbounded
/// recursion here.
const MAX_CONDITIONAL_GROUP_DEPTH: usize = 8;

fn inventory_rules(scanner: &mut CssScanner<'_>, depth: usize) -> Result<(), InventoryRejection> {
    while scanner.skip_trivia()? {
        if depth > 0 && scanner.peek() == Some('}') {
            scanner.bump();
            return Ok(());
        }
        if scanner.peek() == Some('@') {
            let name = scanner.consume_at_rule_name()?;
            // `@charset` is a parser directive that carries no style content
            // and terminates with a semicolon rather than a block.
            if name == "charset" {
                scanner.consume_statement_at_rule()?;
                continue;
            }
            // `@media` is a conditional group: Stylo evaluates the query
            // against the real device, so this inventory only has to keep
            // validating the declarations it guards.
            if name == "media" {
                if depth + 1 > MAX_CONDITIONAL_GROUP_DEPTH {
                    return Err(InventoryRejection::UnsupportedAtRule(name));
                }
                scanner.consume_prelude_open_brace(true)?;
                inventory_rules(scanner, depth + 1)?;
                continue;
            }
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

    /// Consumes a statement at-rule through its terminating semicolon.
    fn consume_statement_at_rule(&mut self) -> Result<(), InventoryRejection> {
        loop {
            match self.peek() {
                Some(';') => {
                    self.bump();
                    return Ok(());
                }
                Some('{') | None => {
                    return Err(InventoryRejection::Syntax(
                        CssInventoryFailure::UnterminatedBlock,
                    ));
                }
                Some(quote @ ('"' | '\'')) => {
                    self.bump();
                    self.consume_string(quote)?;
                }
                Some(_) => {
                    self.bump();
                }
            }
        }
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
            // A declaration CSS itself does not define — an author typo, a
            // tool-injected custom property, an unknown vendor prefix — is
            // dropped by every browser while the rest of the rule applies.
            // Only a property CSS defines can be a real capability gap.
            // A custom property is always valid CSS but reaches the typed
            // contract only through a `var()` reference, where the
            // *referencing* declaration is what this gate must judge. Rito's
            // own reserved namespace stays rejected so a publication cannot
            // spoof engine-internal signalling.
            let is_custom_property =
                property.starts_with("--") && !property.starts_with(RITO_INTERNAL_PROPERTY_PREFIX);
            if !property_is_supported(&property, declaration.value, context)
                && !is_custom_property
                && rito_stylo::css_defines_property(&property)
            {
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

/// Reserved namespace for engine-internal custom properties. Author content
/// must never be able to declare these.
const RITO_INTERNAL_PROPERTY_PREFIX: &str = "--rito-internal-";

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
            // Paint order for positioned boxes. The current flow consumer
            // paints in document order and has no stacking-context model, so
            // the value is admitted without behavior rather than failing a
            // publication that merely declares it alongside `position`.
            | "z-index"
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
            | "position"
            | "top"
            | "right"
            | "bottom"
            | "left"
            | "white-space"
            // `white-space` longhand; the typed contract already carries it
            // as `text_flow.text_wrap_mode`.
            | "text-wrap-mode"
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
        validate_stylo_source_arena, CssInventoryFailure, InventoryRejection,
        StyleCapabilityImpact, StyleCapabilityNote, StyleCapabilityReport, StyloSourceRejection,
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
    fn unrepresentable_css_is_classified_rather_than_refusing_the_publication() {
        let ledger = ledger(&[]);
        let embedded = |css: &str| AuthorStylesheetSource::Embedded {
            source_node_id: source_id(),
            css: css.to_owned(),
            selection_issues: Vec::new(),
            media_environment_issues: Vec::new(),
        };

        // A real property outside the typed contract cannot reach layout or
        // paint, so the publication opens and the loss is recorded as inert.
        let selection = select_stylo_sources(
            &ledger,
            "Text/chapter.xhtml",
            &[embedded("p { cursor: help }")],
        )
        .expect("an unrepresentable property must not refuse the publication");
        assert_eq!(selection.stylesheets.len(), 1);
        assert!(selection.capabilities.is_complete());
        assert_eq!(
            selection.capabilities.notes(),
            [StyleCapabilityNote {
                impact: StyleCapabilityImpact::Ignored,
                source_index: 0,
                subject: "property cursor".to_owned(),
            }]
        );

        // Generated content is skipped, which changes rendering, so it is
        // recorded as degraded rather than inert.
        let selection = select_stylo_sources(
            &ledger,
            "Text/chapter.xhtml",
            &[embedded("p::before { content: \"x\" }")],
        )
        .expect("a skipped pseudo-element must not refuse the publication");
        assert_eq!(
            selection.capabilities.notes()[0].impact,
            StyleCapabilityImpact::Degraded
        );
    }

    #[test]
    fn this_scanner_s_own_limits_only_bound_the_report() {
        let ledger = ledger(&[]);
        // Stylo resolves nesting natively; this crude scanner cannot, so the
        // publication still opens and only the report admits it is partial.
        let nested = AuthorStylesheetSource::Embedded {
            source_node_id: source_id(),
            css: "p { color: red; & span { color: blue } }".to_owned(),
            selection_issues: Vec::new(),
            media_environment_issues: Vec::new(),
        };
        let selection = select_stylo_sources(&ledger, "Text/chapter.xhtml", &[nested])
            .expect("nesting is Stylo's to resolve, not this scanner's to refuse");

        assert!(!selection.capabilities.is_complete());
        assert!(selection.capabilities.is_empty());
    }

    #[test]
    fn reserved_internal_property_escapes_still_fail_closed() {
        let ledger = ledger(&[]);
        // The reserved namespace is enforced on raw names, so an escape that
        // could spell one past this scanner must not be admitted.
        let escaped = AuthorStylesheetSource::Embedded {
            source_node_id: source_id(),
            css: "p { \\2D\\2D rito-internal-break-before-v1: always }".to_owned(),
            selection_issues: Vec::new(),
            media_environment_issues: Vec::new(),
        };

        assert!(matches!(
            select_stylo_sources(&ledger, "Text/chapter.xhtml", &[escaped]),
            Err(StyloSourceRejection::BackslashEscape { .. })
        ));
    }

    #[test]
    fn rejects_known_unsupported_contract_properties_and_at_rules() {
        assert!(matches!(
            inventory_css("p { background-origin: content-box }"),
            Err(InventoryRejection::UnsupportedProperty(name)) if name == "background-origin"
        ));
        // `@media` is a conditional group Stylo evaluates itself; the
        // inventory keeps validating the declarations it guards.
        assert_eq!(inventory_css("@media print { p { color: black } }"), Ok(()));
        assert!(matches!(
            inventory_css("@media print { p { border-image: none } }"),
            Err(InventoryRejection::UnsupportedProperty(name)) if name == "border-image"
        ));
        assert!(matches!(
            inventory_css("@import url(book.css);"),
            Err(InventoryRejection::UnsupportedAtRule(name)) if name == "import"
        ));
        // `font-variation-settings` is deliberately absent: this engine's Stylo
        // profile does not define it, so it is dropped as unknown CSS rather
        // than reported as a representability gap.
        for property in [
            "font-feature-settings",
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
        let mut capabilities = StyleCapabilityReport::default();
        assert_eq!(
            validate_stylo_inline_style(42, "font-size: 1rem; color: navy", &mut capabilities),
            Ok(())
        );
        assert_eq!(
            validate_stylo_inline_style(42, "opacity: .5", &mut capabilities),
            Ok(())
        );
        assert!(capabilities.is_empty());
    }

    #[test]
    fn records_and_admits_uncontracted_inline_style_properties() {
        let mut capabilities = StyleCapabilityReport::default();
        assert_eq!(
            validate_stylo_inline_style(15, "box-sizing: border-box", &mut capabilities),
            Ok(())
        );
        assert_eq!(
            validate_stylo_inline_style(16, "font-variant: small-caps", &mut capabilities),
            Ok(())
        );
        let subjects: Vec<_> = capabilities
            .notes()
            .iter()
            .map(|note| note.subject.as_str())
            .collect();
        assert_eq!(subjects, ["property box-sizing", "property font-variant"]);
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
            validate_stylo_inline_style(
                42,
                "page-break-before: always; break-after: page",
                &mut StyleCapabilityReport::default()
            ),
            Ok(())
        );
        for name in [
            "--rito-internal-break-before-v1",
            "--rito-internal-break-after-v1",
        ] {
            let declarations = format!("{name}: always");
            assert!(matches!(
                validate_stylo_inline_style(
                    42,
                    &declarations,
                    &mut StyleCapabilityReport::default()
                ),
                Err(StyloSourceRejection::UnsupportedProperty {
                    source_index: 42,
                    name: rejected,
                }) if rejected == name
            ));
        }
    }

    #[test]
    fn degrades_source_semantics_without_an_exact_stylo_bridge() {
        for (source, expected_subject) in [
            (
                r#"<html><body bgcolor="transparent"><p>text</p></body></html>"#,
                "attribute body@bgcolor",
            ),
            (
                r#"<html><body><p dir="auto">text</p></body></html>"#,
                "attribute dir=auto",
            ),
        ] {
            let arena = SourceArena::from_xhtml(source).unwrap();
            let mut capabilities = StyleCapabilityReport::default();
            assert_eq!(
                validate_stylo_source_arena(&arena, &mut capabilities),
                Ok(())
            );
            let subjects: Vec<_> = capabilities
                .notes()
                .iter()
                .map(|note| note.subject.as_str())
                .collect();
            assert_eq!(subjects, [expected_subject]);
        }
        let supported = SourceArena::from_xhtml(r##"<html xmlns="http://www.w3.org/1999/xhtml"><body bgcolor="#fff"><p>text</p></body></html>"##).unwrap();
        let mut capabilities = StyleCapabilityReport::default();
        assert_eq!(
            validate_stylo_source_arena(&supported, &mut capabilities),
            Ok(())
        );
        assert!(capabilities.is_empty());

        let namespace_mismatch =
            SourceArena::from_xhtml(r##"<html><body bgcolor="#fff"><p>text</p></body></html>"##)
                .unwrap();
        let mut capabilities = StyleCapabilityReport::default();
        assert_eq!(
            validate_stylo_source_arena(&namespace_mismatch, &mut capabilities),
            Ok(())
        );
        let subjects: Vec<_> = capabilities
            .notes()
            .iter()
            .map(|note| note.subject.as_str())
            .collect();
        assert_eq!(subjects, ["attribute body@bgcolor"]);
    }
}
