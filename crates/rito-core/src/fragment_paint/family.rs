//! Font family stacks under the pinned-font policy, for paint (from the
//! computed family list) and for host metric lookup (from a comma-joined
//! family key): families the engine cannot resolve drop, the pinned alias
//! names ride ahead of the first generic keyword, and the stack always
//! ends in a generic. Also the colour conversion and the fail-closed
//! error every unpaintable property reports through.

use rito_style_contract::{AbsoluteColor, InlineFormattingStyle};

use crate::epub::{EpubError, EpubResult};
use crate::render::contract::ReaderColor;
use crate::style::{paint_color, serialize_font_families};

use super::PaintFamilyPolicy;

/// The `font-family` string painted for a run: the computed stack as-is
/// without a policy, or the policy's rewrite of it (see
/// Applies the paint family rewrite to a host-metric family key (the
/// comma-joined computed list rito-inline requests metrics under): named
/// families the engine cannot resolve are dropped, the pinned aliases
/// ride ahead of the first generic keyword, and the stack keeps a generic
/// tail. The host must measure line metrics through exactly the faces
/// paint resolves to, or the strut is sized by one font while the glyphs
/// come from another (measured: `serif` struts sized by the browser's
/// Times while SourceHan painted — every body baseline one pixel off).
pub(crate) fn measure_family_stack(family_key: &str, policy: &PaintFamilyPolicy) -> String {
    let is_generic = |name: &str| {
        matches!(
            name,
            "serif" | "sans-serif" | "monospace" | "cursive" | "fantasy" | "system-ui"
        )
    };
    let quoted = |name: &str| format!("\"{}\"", name.replace('\\', "\\\\").replace('"', "\\\""));
    let mut parts: Vec<String> = Vec::new();
    let mut aliases_added = false;
    for raw in family_key
        .split(',')
        .map(str::trim)
        .filter(|n| !n.is_empty())
    {
        let bare = raw.trim_matches('"');
        let lower = bare.to_ascii_lowercase();
        if is_generic(lower.as_str()) {
            if !aliases_added {
                parts.extend(policy.aliases.iter().map(|alias| quoted(alias)));
                aliases_added = true;
            }
            parts.push(lower);
            continue;
        }
        if !policy.available.contains(&lower) {
            continue;
        }
        parts.push(quoted(bare));
    }
    if !aliases_added {
        parts.extend(policy.aliases.iter().map(|alias| quoted(alias)));
    }
    let has_generic_tail = parts.last().is_some_and(|part| is_generic(part.as_str()));
    if !has_generic_tail {
        parts.push("serif".to_owned());
    }
    parts.join(", ")
}

/// [`PaintFamilyPolicy`]).
pub(super) fn paint_family_stack(
    style: &InlineFormattingStyle,
    family_policy: Option<&PaintFamilyPolicy>,
) -> EpubResult<String> {
    use rito_style_contract::{FontFamily, FontFamilyNameSyntax, GenericFontFamily};
    let Some(policy) = family_policy else {
        return serialize_font_families(&style.font)
            .map_err(|error| not_paintable(&format!("font family list: {error:?}")));
    };
    let generic_keyword = |generic: GenericFontFamily| -> &'static str {
        match generic {
            GenericFontFamily::Serif => "serif",
            GenericFontFamily::SansSerif => "sans-serif",
            GenericFontFamily::Monospace => "monospace",
            GenericFontFamily::Cursive => "cursive",
            GenericFontFamily::Fantasy => "fantasy",
            GenericFontFamily::SystemUi => "system-ui",
        }
    };
    let mut parts: Vec<String> = Vec::new();
    let mut aliases_added = false;
    for family in style.font.families.iter() {
        match family {
            FontFamily::Named(name) => {
                let lower = name.as_str().to_ascii_lowercase();
                // CSS generic keywords ride through even in named form:
                // the canvas needs them as its final fallback exactly as
                // the retained stack carried them, or an unavailable
                // stack drops to the renderer's default sans.
                let generic_keyword_name = matches!(
                    lower.as_str(),
                    "serif" | "sans-serif" | "monospace" | "cursive" | "fantasy" | "system-ui"
                );
                if generic_keyword_name {
                    if !aliases_added {
                        parts.extend(policy.aliases.iter().cloned());
                        aliases_added = true;
                    }
                    parts.push(lower);
                    continue;
                }
                if !policy.available.contains(&lower) {
                    continue;
                }
                parts.push(match name.syntax() {
                    FontFamilyNameSyntax::Quoted => format!(
                        "\"{}\"",
                        name.as_str().replace('\\', "\\\\").replace('"', "\\\"")
                    ),
                    FontFamilyNameSyntax::Identifiers => name.as_str().to_owned(),
                });
            }
            FontFamily::Generic(generic) => {
                if !aliases_added {
                    parts.extend(policy.aliases.iter().cloned());
                    aliases_added = true;
                }
                parts.push(generic_keyword(*generic).to_owned());
            }
        }
    }
    if !aliases_added {
        parts.extend(policy.aliases.iter().cloned());
    }
    // The retained pipeline injected a generic keyword at the stack tail;
    // the canvas needs one too, or an unavailable stack silently drops to
    // the renderer's default sans instead of the book's serif shape.
    let has_generic_tail = parts.last().is_some_and(|part| {
        matches!(
            part.as_str(),
            "serif" | "sans-serif" | "monospace" | "cursive" | "fantasy" | "system-ui"
        )
    });
    if !has_generic_tail {
        parts.push("serif".to_owned());
    }
    Ok(parts.join(", "))
}

pub(super) fn css_color(color: AbsoluteColor) -> EpubResult<ReaderColor> {
    paint_color(color).map_err(|error| not_paintable(&format!("color: {error:?}")))
}

fn not_paintable(what: &str) -> EpubError {
    EpubError::new(format!("{what} is not paintable yet"))
}
