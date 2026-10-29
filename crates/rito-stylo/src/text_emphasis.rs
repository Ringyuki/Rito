//! `text-emphasis` and its longhands, which stylo's Servo profile does not
//! implement. Each declaration is checked against the browser's grammar
//! and rides a registered custom property: the style and the position as
//! one canonical keyword, the color as written. The shorthand splits into
//! its two longhands' carriers. A value the grammar rejects keeps its own
//! name and drops at parse time, as the browser drops it.

use std::sync::Arc;

use cssparser::{Parser, ParserInput, Token};
use rito_style_contract::{LineSide, WritingMode};
use style::{
    context::QuirksMode,
    properties::{parse_style_attribute, ComputedValues, PropertyDeclaration},
    stylesheets::{CssRuleType, UrlExtraData},
    values::computed,
    Atom,
};
use style_traits::ToCss;

pub(crate) const STYLE_CSS_NAME: &str = "--rito-internal-text-emphasis-style-v1";
pub(crate) const COLOR_CSS_NAME: &str = "--rito-internal-text-emphasis-color-v1";
pub(crate) const POSITION_CSS_NAME: &str = "--rito-internal-text-emphasis-position-v1";
const STYLE_ATOM_NAME: &str = "rito-internal-text-emphasis-style-v1";
const COLOR_ATOM_NAME: &str = "rito-internal-text-emphasis-color-v1";
const POSITION_ATOM_NAME: &str = "rito-internal-text-emphasis-position-v1";

/// The declarations one emphasis declaration becomes: each carrier with
/// the value it carries.
pub(crate) type Carried = Vec<(&'static str, String)>;

const CSS_WIDE: [&str; 5] = ["inherit", "initial", "unset", "revert", "revert-layer"];
const FILLS: [&str; 2] = ["filled", "open"];
const SHAPES: [&str; 5] = ["dot", "circle", "double-circle", "triangle", "sesame"];

/// One top-level component of a declaration value: what it is, and its
/// source text.
#[derive(Clone, Debug, PartialEq)]
enum Component<'a> {
    Ident(String, &'a str),
    String(&'a str),
    Other(&'a str),
}

impl<'a> Component<'a> {
    fn source(&self) -> &'a str {
        match self {
            Self::Ident(_, source) | Self::String(source) | Self::Other(source) => source,
        }
    }

    fn keyword(&self) -> Option<&str> {
        match self {
            Self::Ident(keyword, _) => Some(keyword),
            _ => None,
        }
    }
}

/// The value's top-level components, comments and white space skipped, or
/// none when it does not tokenize.
fn components(value: &str) -> Option<Vec<Component<'_>>> {
    let mut input = ParserInput::new(value);
    let mut parser = Parser::new(&mut input);
    let mut out = Vec::new();
    loop {
        parser.skip_whitespace();
        let start = parser.position();
        let token = match parser.next() {
            Ok(token) => token.clone(),
            Err(_) => break,
        };
        let nested = matches!(
            token,
            Token::Function(_)
                | Token::ParenthesisBlock
                | Token::SquareBracketBlock
                | Token::CurlyBracketBlock
        );
        if nested {
            parser
                .parse_nested_block(|block| {
                    while block.next().is_ok() {}
                    Ok::<_, cssparser::ParseError<'_, ()>>(())
                })
                .ok()?;
        }
        let source = parser.slice_from(start).trim_end();
        out.push(match token {
            Token::Ident(ident) => Component::Ident(ident.to_ascii_lowercase(), source),
            Token::QuotedString(_) => Component::String(source),
            Token::BadString(_) | Token::BadUrl(_) => return None,
            _ => Component::Other(source),
        });
    }
    Some(out)
}

/// A CSS-wide keyword value, which every longhand takes as it is.
fn css_wide(components: &[Component<'_>]) -> Option<&'static str> {
    let [component] = components else {
        return None;
    };
    let keyword = component.keyword()?;
    CSS_WIDE.iter().copied().find(|wide| *wide == keyword)
}

/// `text-emphasis-style`'s canonical keyword for `components`: `none`, a
/// string as written, or `<fill>-<shape>` with the shape `auto` when only
/// the fill is given and the fill `filled` when only the shape is.
fn style_keyword(components: &[Component<'_>]) -> Option<String> {
    if let [Component::String(source)] = components {
        return Some((*source).to_owned());
    }
    if let [Component::Ident(keyword, _)] = components {
        if keyword == "none" {
            return Some("none".to_owned());
        }
    }
    let mut fill = None;
    let mut shape = None;
    if components.is_empty() || components.len() > 2 {
        return None;
    }
    for component in components {
        let keyword = component.keyword()?;
        if let Some(found) = FILLS.iter().find(|fill| **fill == keyword) {
            if fill.replace(*found).is_some() {
                return None;
            }
        } else if let Some(found) = SHAPES.iter().find(|shape| **shape == keyword) {
            if shape.replace(*found).is_some() {
                return None;
            }
        } else {
            return None;
        }
    }
    Some(format!(
        "{}-{}",
        fill.unwrap_or("filled"),
        shape.unwrap_or("auto")
    ))
}

/// Whether `value` is one `<color>` the browser's parser accepts.
fn parse_color(value: &str) -> Option<computed::Color> {
    if value.contains([';', '!', '{', '}']) {
        return None;
    }
    let url_data = UrlExtraData::from(url::Url::parse("about:blank").ok()?);
    let block = parse_style_attribute(
        &format!("color:{value}"),
        &url_data,
        None,
        QuirksMode::NoQuirks,
        CssRuleType::Style,
    );
    let mut declarations = block.declarations().iter();
    let declaration = declarations.next()?;
    if declarations.next().is_some() {
        return None;
    }
    match declaration {
        PropertyDeclaration::Color(color) => color.0.to_computed_color(None).ok(),
        _ => None,
    }
}

/// `text-emphasis-style: <value>` as its carrier declaration.
pub(crate) fn carry_style(value: &str) -> Option<Carried> {
    let components = components(value)?;
    let carried = match css_wide(&components) {
        Some(wide) => wide.to_owned(),
        None => style_keyword(&components)?,
    };
    Some(vec![(STYLE_CSS_NAME, carried)])
}

/// `text-emphasis-color: <value>` as its carrier declaration.
pub(crate) fn carry_color(value: &str) -> Option<Carried> {
    let components = components(value)?;
    if let Some(wide) = css_wide(&components) {
        return Some(vec![(COLOR_CSS_NAME, wide.to_owned())]);
    }
    parse_color(value)?;
    Some(vec![(COLOR_CSS_NAME, value.trim().to_owned())])
}

/// `text-emphasis-position: <value>` as its carrier declaration: one of
/// `over` and `under`, and optionally one of `right` (the initial) and
/// `left`, in either order.
pub(crate) fn carry_position(value: &str) -> Option<Carried> {
    let components = components(value)?;
    if let Some(wide) = css_wide(&components) {
        return Some(vec![(POSITION_CSS_NAME, wide.to_owned())]);
    }
    let mut over = None;
    let mut right = None;
    if components.is_empty() || components.len() > 2 {
        return None;
    }
    for component in &components {
        let (slot, value) = match component.keyword()? {
            "over" => (&mut over, true),
            "under" => (&mut over, false),
            "right" => (&mut right, true),
            "left" => (&mut right, false),
            _ => return None,
        };
        if slot.replace(value).is_some() {
            return None;
        }
    }
    let over = over?;
    let right = right.unwrap_or(true);
    let keyword = match (over, right) {
        (true, true) => "over-right",
        (true, false) => "over-left",
        (false, true) => "under-right",
        (false, false) => "under-left",
    };
    Some(vec![(POSITION_CSS_NAME, keyword.to_owned())])
}

/// `text-emphasis: <value>` as its two longhands' carrier declarations:
/// a style (one string, `none`, or its fill and shape keywords together)
/// and a color, each at most once and in either order, the one left out
/// taking its initial.
pub(crate) fn carry_shorthand(value: &str) -> Option<Carried> {
    let components = components(value)?;
    if let Some(wide) = css_wide(&components) {
        return Some(vec![
            (STYLE_CSS_NAME, wide.to_owned()),
            (COLOR_CSS_NAME, wide.to_owned()),
        ]);
    }
    let is_style = |component: &Component<'_>| match component {
        Component::String(_) => true,
        Component::Ident(keyword, _) => {
            keyword == "none"
                || FILLS.contains(&keyword.as_str())
                || SHAPES.contains(&keyword.as_str())
        }
        Component::Other(_) => false,
    };
    // The style is one run of style components at either end; the color
    // is everything else.
    let leading = components.iter().take_while(|c| is_style(c)).count();
    let trailing = components.iter().rev().take_while(|c| is_style(c)).count();
    let (style, color) = if leading == components.len() {
        (&components[..], &components[..0])
    } else if leading > 0 {
        (&components[..leading], &components[leading..])
    } else {
        let split = components.len() - trailing;
        (&components[split..], &components[..split])
    };
    if color.iter().any(is_style) {
        return None;
    }
    let style = if style.is_empty() {
        "none".to_owned()
    } else {
        style_keyword(style)?
    };
    let color = match (color.first(), color.last()) {
        (Some(first), Some(last)) => {
            let start = first.source().as_ptr() as usize - value.as_ptr() as usize;
            let end =
                last.source().as_ptr() as usize - value.as_ptr() as usize + last.source().len();
            let text = &value[start..end];
            parse_color(text)?;
            text.to_owned()
        }
        _ => "currentcolor".to_owned(),
    };
    Some(vec![(STYLE_CSS_NAME, style), (COLOR_CSS_NAME, color)])
}

/// The computed emphasis an element's text takes, read off the carriers:
/// its mark (a keyword's character, `auto` resolving by typographic
/// mode, or the custom string), the line side it stands on, and its
/// color. `None` for `none`.
pub(crate) fn project(
    styles: &ComputedValues,
    writing_mode: WritingMode,
) -> Option<(Arc<str>, LineSide, computed::Color)> {
    let read = |atom: &str| {
        styles
            .custom_properties()
            .inherited
            .get(&Atom::from(atom))
            .map(|value| value.to_css_string().trim().to_owned())
    };
    let style = read(STYLE_ATOM_NAME)?;
    let vertical = writing_mode != WritingMode::HorizontalTopToBottom;
    let mark: Arc<str> = if style.starts_with(['"', '\'']) {
        let mut input = ParserInput::new(&style);
        let mut parser = Parser::new(&mut input);
        let string = parser.expect_string().ok()?.to_string();
        if string.is_empty() {
            return None;
        }
        Arc::from(string)
    } else {
        let (fill, shape) = style.split_once('-')?;
        let filled = fill == "filled";
        let shape = match shape {
            "auto" if vertical => "sesame",
            "auto" => "dot",
            shape => shape,
        };
        let mark = match (shape, filled) {
            ("dot", true) => '\u{2022}',
            ("dot", false) => '\u{25E6}',
            ("circle", true) => '\u{25CF}',
            ("circle", false) => '\u{25CB}',
            ("double-circle", true) => '\u{25C9}',
            ("double-circle", false) => '\u{25CE}',
            ("triangle", true) => '\u{25B2}',
            ("triangle", false) => '\u{25B3}',
            ("sesame", true) => '\u{FE45}',
            ("sesame", false) => '\u{FE46}',
            _ => return None,
        };
        Arc::from(mark.to_string())
    };
    // A horizontal line's marks stand over or under it; a vertical one's
    // right (its line-over side) or left.
    let position = read(POSITION_ATOM_NAME).unwrap_or_else(|| "over-right".to_owned());
    let side = match (vertical, position.as_str()) {
        (false, "under-right" | "under-left") | (true, "over-left" | "under-left") => {
            LineSide::Under
        }
        _ => LineSide::Over,
    };
    let color = read(COLOR_ATOM_NAME)
        .and_then(|color| parse_color(&color))
        .unwrap_or(computed::Color::CurrentColor);
    Some((mark, side, color))
}

#[cfg(test)]
mod tests {
    use super::{carry_color, carry_position, carry_shorthand, carry_style};

    fn values(carried: Option<super::Carried>) -> Vec<String> {
        carried
            .unwrap_or_default()
            .into_iter()
            .map(|(_, value)| value)
            .collect()
    }

    #[test]
    fn a_style_carries_one_canonical_keyword() {
        assert_eq!(values(carry_style("filled sesame")), ["filled-sesame"]);
        assert_eq!(values(carry_style(" SESAME /*x*/ open ")), ["open-sesame"]);
        assert_eq!(values(carry_style("dot")), ["filled-dot"]);
        assert_eq!(values(carry_style("open")), ["open-auto"]);
        assert_eq!(values(carry_style("none")), ["none"]);
        assert_eq!(values(carry_style("'*'")), ["'*'"]);
        assert_eq!(values(carry_style("inherit")), ["inherit"]);
        for invalid in ["filled open", "dot circle", "filled none", "", "auto", "x"] {
            assert_eq!(carry_style(invalid), None, "{invalid}");
        }
    }

    #[test]
    fn a_position_carries_its_side_and_column_side() {
        assert_eq!(values(carry_position("under")), ["under-right"]);
        assert_eq!(values(carry_position("left over")), ["over-left"]);
        assert_eq!(values(carry_position("over right")), ["over-right"]);
        for invalid in ["right", "over under", "under left left", "auto"] {
            assert_eq!(carry_position(invalid), None, "{invalid}");
        }
    }

    #[test]
    fn a_color_carries_as_written_when_it_parses() {
        assert_eq!(values(carry_color("#000000")), ["#000000"]);
        assert_eq!(values(carry_color("rgb(1, 2, 3)")), ["rgb(1, 2, 3)"]);
        assert_eq!(carry_color("nocolor"), None);
    }

    #[test]
    fn the_shorthand_splits_into_style_and_color() {
        assert_eq!(
            values(carry_shorthand("circle #000")),
            ["filled-circle", "#000"]
        );
        assert_eq!(
            values(carry_shorthand("rgb(0, 0, 0) open dot")),
            ["open-dot", "rgb(0, 0, 0)"]
        );
        assert_eq!(
            values(carry_shorthand("filled dot")),
            ["filled-dot", "currentcolor"]
        );
        assert_eq!(values(carry_shorthand("red")), ["none", "red"]);
        assert_eq!(carry_shorthand("filled red dot"), None);
        assert_eq!(carry_shorthand("dot circle"), None);
    }
}
