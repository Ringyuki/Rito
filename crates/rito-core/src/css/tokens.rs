#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CssDeclaration<'a> {
    pub(crate) property: &'a str,
    pub(crate) value: &'a str,
}

#[derive(Debug, Clone, Copy, Default)]
struct TokenState {
    depth: usize,
    quote: Option<char>,
    escaped: bool,
}

impl TokenState {
    fn advance(&mut self, ch: char) {
        if self.escaped {
            self.escaped = false;
            return;
        }
        if ch == '\\' && self.quote.is_some() {
            self.escaped = true;
            return;
        }
        if let Some(quote) = self.quote {
            if ch == quote {
                self.quote = None;
            }
            return;
        }
        match ch {
            '"' | '\'' => self.quote = Some(ch),
            '(' => self.depth += 1,
            ')' => self.depth = self.depth.saturating_sub(1),
            _ => {}
        }
    }

    fn is_top_level(self) -> bool {
        self.depth == 0 && self.quote.is_none()
    }
}

pub(crate) fn split_declarations(input: &str) -> Vec<CssDeclaration<'_>> {
    split_top_level(input, ';')
        .into_iter()
        .filter_map(|declaration| split_declaration(declaration.trim()))
        .collect()
}

fn split_declaration(declaration: &str) -> Option<CssDeclaration<'_>> {
    let colon = find_top_level_char(declaration, ':')?;
    let property = declaration[..colon].trim();
    let value = declaration[colon + 1..].trim();
    (!property.is_empty() && !value.is_empty()).then_some(CssDeclaration { property, value })
}

pub(crate) fn split_top_level_commas(input: &str) -> Vec<&str> {
    split_top_level(input, ',')
}

pub(crate) fn split_component_values(input: &str) -> Vec<&str> {
    let mut values = Vec::new();
    let mut state = TokenState::default();
    let mut start = None;

    for (index, ch) in input.char_indices() {
        if ch.is_whitespace() && state.is_top_level() {
            if let Some(token_start) = start.take() {
                values.push(input[token_start..index].trim());
            }
            state.advance(ch);
            continue;
        }

        start.get_or_insert(index);
        state.advance(ch);
    }

    if let Some(token_start) = start {
        values.push(input[token_start..].trim());
    }
    values.retain(|value| !value.is_empty());
    values
}

pub(crate) fn split_top_level_slashes(input: &str) -> Vec<&str> {
    split_top_level(input, '/')
}

pub(crate) fn extract_function_argument<'a>(input: &'a str, name: &str) -> Option<&'a str> {
    let start = input.find(name)?;
    let rest = input[start + name.len()..].trim_start();
    let rest = rest.strip_prefix('(')?;
    let end = matching_closing_paren(rest)?;
    Some(rest[..end].trim())
}

fn split_top_level(input: &str, delimiter: char) -> Vec<&str> {
    let mut result = Vec::new();
    let mut state = TokenState::default();
    let mut start = 0;

    for (index, ch) in input.char_indices() {
        if ch == delimiter && state.is_top_level() {
            let item = input[start..index].trim();
            if !item.is_empty() {
                result.push(item);
            }
            start = index + ch.len_utf8();
            continue;
        }
        state.advance(ch);
    }

    let item = input[start..].trim();
    if !item.is_empty() {
        result.push(item);
    }
    result
}

fn find_top_level_char(input: &str, needle: char) -> Option<usize> {
    let mut state = TokenState::default();
    for (index, ch) in input.char_indices() {
        if ch == needle && state.is_top_level() {
            return Some(index);
        }
        state.advance(ch);
    }
    None
}

fn matching_closing_paren(input: &str) -> Option<usize> {
    let mut state = TokenState::default();
    for (index, ch) in input.char_indices() {
        if ch == ')' && state.is_top_level() {
            return Some(index);
        }
        state.advance(ch);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{
        extract_function_argument, split_component_values, split_declarations,
        split_top_level_commas, split_top_level_slashes,
    };

    #[test]
    fn declarations_ignore_semicolons_inside_functions_and_quotes() {
        let declarations = split_declarations(
            r#"background-image: url("data:image/svg+xml;utf8,<svg/>"); color: red"#,
        );

        assert_eq!(declarations.len(), 2);
        assert_eq!(declarations[0].property, "background-image");
        assert_eq!(
            declarations[0].value,
            r#"url("data:image/svg+xml;utf8,<svg/>")"#
        );
        assert_eq!(declarations[1].property, "color");
    }

    #[test]
    fn component_values_keep_parenthesized_and_quoted_groups() {
        assert_eq!(
            split_component_values(r#"url("Images/cover art.png") center / cover no-repeat"#),
            vec![
                r#"url("Images/cover art.png")"#,
                "center",
                "/",
                "cover",
                "no-repeat"
            ]
        );
    }

    #[test]
    fn comma_splitting_respects_color_functions() {
        assert_eq!(
            split_top_level_commas("1px 2px rgb(1, 2, 3), inset 0 0 4px #000"),
            vec!["1px 2px rgb(1, 2, 3)", "inset 0 0 4px #000"]
        );
    }

    #[test]
    fn slash_splitting_respects_urls() {
        assert_eq!(
            split_top_level_slashes(r#"center/url("a/b.png")/cover"#),
            vec!["center", r#"url("a/b.png")"#, "cover"]
        );
    }

    #[test]
    fn extracts_function_arguments_with_quotes() {
        assert_eq!(
            extract_function_argument(r#"url("Images/cover art.png")"#, "url"),
            Some(r#""Images/cover art.png""#)
        );
    }
}
