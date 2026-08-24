use style::{
    color::AbsoluteColor,
    context::QuirksMode,
    properties::{parse_style_attribute, PropertyDeclaration},
    servo::attr::parse_legacy_color,
    stylesheets::{CssRuleType, UrlExtraData},
};

/// Reports whether a `body@bgcolor` value can be represented exactly by the
/// DOM-independent Stylo adapter.
///
/// This follows HTML's legacy colour algorithm rather than CSS declaration
/// parsing. Callers can therefore use the same fail-closed predicate before
/// selecting the Stylo path without depending on a browser DOM or Stylo type.
pub fn supports_body_bgcolor_presentational_hint(value: &str) -> bool {
    parse_body_bgcolor_presentational_hint(value).is_some()
}

pub(crate) fn parse_body_bgcolor_presentational_hint(value: &str) -> Option<AbsoluteColor> {
    // Stylo implements the WHATWG algorithm exactly, but its 0.19 parser
    // assumes that stripping HTML spaces cannot make a non-empty input empty.
    // Guard that invalid edge case so hostile input fails closed instead of
    // reaching its first-code-point step with an empty string.
    if value.trim_matches(is_html_space).is_empty() {
        return None;
    }
    parse_legacy_color(value).ok()
}

fn is_html_space(character: char) -> bool {
    matches!(character, '\t' | '\n' | '\u{000c}' | '\r' | ' ')
}

/// Which CSS property an SVG geometry presentation attribute maps to.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum SvgGeometryAxis {
    Width,
    Height,
}

impl SvgGeometryAxis {
    fn property_name(self) -> &'static str {
        match self {
            Self::Width => "width",
            Self::Height => "height",
        }
    }
}

/// Reports whether an SVG `width`/`height` attribute value can be
/// represented exactly as a presentational hint by the DOM-independent
/// Stylo adapter.
///
/// `width` and `height` on `<svg>` are presentation attributes that map to
/// the CSS properties of the same name (SVG 2 §7.2), parsed per the
/// property's own grammar with SVG user units meaning `px`. A value the
/// grammar rejects makes the attribute invalid, and an invalid presentation
/// attribute is ignored — that is the browser behaviour, not a fail-open
/// shortcut, so `false` here means "no declaration", never "refuse the
/// publication".
pub fn supports_svg_geometry_presentational_hint(value: &str) -> bool {
    parse_svg_geometry_presentational_hint(SvgGeometryAxis::Width, value).is_some()
}

pub(crate) fn parse_svg_geometry_presentational_hint(
    axis: SvgGeometryAxis,
    value: &str,
) -> Option<PropertyDeclaration> {
    let value = value.trim_matches(is_xml_space);
    if value.is_empty() {
        return None;
    }
    // The attribute grammar is a single component value. Reject declaration
    // syntax outright so a value cannot smuggle a priority, extra
    // declarations, or a block through the CSS declaration parser below.
    if value.contains([';', '!', '{', '}']) {
        return None;
    }
    // A bare SVG <number> is a user-unit length: one user unit is one px.
    let css_value = match value.parse::<f64>() {
        Ok(number) if number.is_finite() => format!("{value}px"),
        _ => value.to_owned(),
    };
    let url_data = UrlExtraData::from(url::Url::parse("about:blank").ok()?);
    let block = parse_style_attribute(
        &format!("{}:{}", axis.property_name(), css_value),
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
    // An exact typed declaration only: `var()` references and other unparsed
    // values are not part of the presentation attribute grammar.
    match (axis, declaration) {
        (SvgGeometryAxis::Width, PropertyDeclaration::Width(_))
        | (SvgGeometryAxis::Height, PropertyDeclaration::Height(_)) => Some(declaration.clone()),
        _ => None,
    }
}

/// XML white space (XML 1.0 §2.3 S production), which is what may surround
/// an SVG attribute value.
fn is_xml_space(character: char) -> bool {
    matches!(character, '\t' | '\n' | '\r' | ' ')
}

#[cfg(test)]
mod tests {
    use style::properties::PropertyDeclaration;

    use super::{
        parse_body_bgcolor_presentational_hint, parse_svg_geometry_presentational_hint,
        supports_body_bgcolor_presentational_hint, supports_svg_geometry_presentational_hint,
        SvgGeometryAxis,
    };

    #[test]
    fn accepts_exact_html_legacy_colour_forms() {
        for value in [
            "#fff",        // book-08 corpus value
            "#ED7A81",     // six-digit simple colour
            " ReD\t",      // named colour and HTML spaces
            "chucknorris", // legacy error-recovery algorithm
            "\u{00a0}",    // non-HTML whitespace is legacy input
            "#",           // legacy error recovery produces black
        ] {
            assert!(
                supports_body_bgcolor_presentational_hint(value),
                "expected exact support for {value:?}"
            );
            assert!(parse_body_bgcolor_presentational_hint(value).is_some());
        }
    }

    #[test]
    fn rejects_values_for_which_html_produces_no_colour() {
        for value in ["", " \t\n\u{000c}\r", "transparent", " TRANSPARENT\t"] {
            assert!(
                !supports_body_bgcolor_presentational_hint(value),
                "expected fail-closed rejection for {value:?}"
            );
            assert!(parse_body_bgcolor_presentational_hint(value).is_none());
        }
    }

    #[test]
    fn accepts_svg_geometry_values_the_css_grammar_accepts() {
        for value in [
            "100%",   // the SVG-wrapped image idiom
            "240",    // bare user units are px
            " 613\t", // XML white space around the value
            "12.5",   // fractional user units
            "1e2",    // SVG number grammar carries an exponent
            "40px",   // explicit CSS length
            "auto",   // width/height accept auto
            "10em",   // font-relative lengths are valid CSS widths
        ] {
            assert!(
                supports_svg_geometry_presentational_hint(value),
                "expected support for {value:?}"
            );
            for axis in [SvgGeometryAxis::Width, SvgGeometryAxis::Height] {
                assert!(
                    parse_svg_geometry_presentational_hint(axis, value).is_some(),
                    "expected {axis:?} declaration for {value:?}"
                );
            }
        }
    }

    #[test]
    fn svg_geometry_hints_map_to_the_matching_axis_declaration() {
        assert!(matches!(
            parse_svg_geometry_presentational_hint(SvgGeometryAxis::Width, "100%"),
            Some(PropertyDeclaration::Width(_))
        ));
        assert!(matches!(
            parse_svg_geometry_presentational_hint(SvgGeometryAxis::Height, "480"),
            Some(PropertyDeclaration::Height(_))
        ));
    }

    #[test]
    fn rejects_svg_geometry_values_browsers_also_ignore() {
        for value in [
            "",                 // empty attribute
            " \t\r\n",          // white space only
            "-5",               // negative lengths are invalid for width/height
            "abc",              // not a length
            "100 %",            // broken percentage
            "100%;height:3px",  // declaration smuggling
            "100% ! important", // priority smuggling
            "var(--x)",         // custom-property references are not attribute grammar
            "calc(",            // unbalanced
            "nan",              // f64-parseable but not an SVG number
            "inf",              // likewise
        ] {
            assert!(
                !supports_svg_geometry_presentational_hint(value),
                "expected rejection for {value:?}"
            );
        }
    }

    #[test]
    fn preserves_exact_legacy_rgb_results() {
        for (value, expected) in [
            ("#fff", [1.0, 1.0, 1.0, 1.0]),
            (
                "#ED7A81",
                [237.0 / 255.0, 122.0 / 255.0, 129.0 / 255.0, 1.0],
            ),
            ("ReD", [1.0, 0.0, 0.0, 1.0]),
            ("chucknorris", [192.0 / 255.0, 0.0, 0.0, 1.0]),
        ] {
            let color = parse_body_bgcolor_presentational_hint(value).expect("legacy colour");
            assert_eq!(*color.raw_components(), expected, "value {value:?}");
        }
    }
}
