use crate::xhtml::{DocumentNode, ElementAttributes, ElementNode};

const ALLOWED_TAGS: &[&str] = &[
    "a",
    "abbr",
    "address",
    "b",
    "bdi",
    "bdo",
    "blockquote",
    "cite",
    "code",
    "dd",
    "del",
    "dfn",
    "div",
    "dl",
    "dt",
    "em",
    "figcaption",
    "figure",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "i",
    "ins",
    "kbd",
    "li",
    "mark",
    "ol",
    "p",
    "pre",
    "q",
    "rp",
    "rt",
    "ruby",
    "s",
    "samp",
    "section",
    "small",
    "span",
    "strong",
    "sub",
    "sup",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "time",
    "tr",
    "u",
    "ul",
    "var",
];

const GLOBAL_ATTRIBUTES: &[&str] = &[
    "aria-describedby",
    "aria-hidden",
    "aria-label",
    "dir",
    "id",
    "lang",
    "role",
    "title",
    "xml:lang",
];

pub(super) fn footnote_content(nodes: &[DocumentNode]) -> (String, String) {
    (collect_text(nodes), serialize_html(nodes))
}

fn collect_text(nodes: &[DocumentNode]) -> String {
    let mut text = String::new();
    for node in nodes {
        match node {
            DocumentNode::Text(text_node) => text.push_str(&text_node.content),
            DocumentNode::Block(element) => push_block_text(&mut text, &element.children),
            DocumentNode::Inline(element) => text.push_str(&collect_text(&element.children)),
            DocumentNode::Image(_) => {}
        }
    }
    text.trim().to_owned()
}

fn push_block_text(text: &mut String, nodes: &[DocumentNode]) {
    let nested = collect_text(nodes);
    let nested = nested.trim();
    if nested.is_empty() {
        return;
    }
    if !text.is_empty() && !text.ends_with(' ') {
        text.push(' ');
    }
    text.push_str(nested);
}

fn serialize_html(nodes: &[DocumentNode]) -> String {
    nodes.iter().map(serialize_node_html).collect()
}

fn serialize_node_html(node: &DocumentNode) -> String {
    match node {
        DocumentNode::Text(text) => escape_html(&text.content),
        DocumentNode::Image(image) => {
            format!("<img{}>", serialize_attrs("img", image.attributes.as_ref()))
        }
        DocumentNode::Block(element) | DocumentNode::Inline(element) => {
            serialize_element_html(element)
        }
    }
}

fn serialize_element_html(element: &ElementNode) -> String {
    let children = serialize_html(&element.children);
    let tag = element.tag.to_ascii_lowercase();
    if !ALLOWED_TAGS.contains(&tag.as_str()) {
        return children;
    }
    format!(
        "<{tag}{}>{children}</{tag}>",
        serialize_attrs(&tag, element.attributes.as_ref())
    )
}

fn serialize_attrs(tag: &str, attributes: Option<&ElementAttributes>) -> String {
    let Some(all_attributes) = attributes.and_then(|attributes| attributes.all_attributes.as_ref())
    else {
        return String::new();
    };

    let mut serialized = String::new();
    for (raw_name, raw_value) in all_attributes {
        let name = raw_name.to_ascii_lowercase();
        if !is_allowed_attribute(tag, &name) {
            continue;
        }
        let Some(value) = sanitize_attribute(&name, raw_value) else {
            continue;
        };
        serialized.push_str(&format!(" {name}=\"{}\"", escape_attr(&value)));
    }
    serialized
}

fn is_allowed_attribute(tag: &str, name: &str) -> bool {
    GLOBAL_ATTRIBUTES.contains(&name)
        || match tag {
            "a" => matches!(name, "href"),
            "blockquote" | "q" => matches!(name, "cite"),
            "del" | "ins" => matches!(name, "cite" | "datetime"),
            "img" => matches!(name, "alt" | "height" | "width"),
            "li" => matches!(name, "value"),
            "ol" => matches!(name, "reversed" | "start" | "type"),
            "td" => matches!(name, "colspan" | "headers" | "rowspan"),
            "th" => matches!(name, "colspan" | "headers" | "rowspan" | "scope"),
            "time" => matches!(name, "datetime"),
            _ => false,
        }
}

fn sanitize_attribute(name: &str, value: &str) -> Option<String> {
    if matches!(name, "cite" | "href" | "src") {
        return is_safe_url(value, name == "src").then(|| value.trim().to_owned());
    }
    if matches!(
        name,
        "colspan" | "height" | "rowspan" | "start" | "value" | "width"
    ) {
        let value = value.trim();
        return (matches!(value.len(), 1..=6) && value.bytes().all(|byte| byte.is_ascii_digit()))
            .then(|| value.to_owned());
    }
    if name == "dir" {
        let value = value.trim();
        return matches!(value.to_ascii_lowercase().as_str(), "auto" | "ltr" | "rtl")
            .then(|| value.to_owned());
    }
    if name == "scope" {
        let value = value.trim();
        return matches!(
            value.to_ascii_lowercase().as_str(),
            "col" | "colgroup" | "row" | "rowgroup"
        )
        .then(|| value.to_owned());
    }
    if name == "reversed" {
        return Some("reversed".to_owned());
    }
    Some(value.to_owned())
}

fn is_safe_url(value: &str, is_source: bool) -> bool {
    let value = value.trim();
    if value.is_empty() || value.starts_with("//") || has_unsafe_url_character(value) {
        return false;
    }
    let Some(scheme) = uri_scheme(value) else {
        return true;
    };
    scheme.eq_ignore_ascii_case("http")
        || scheme.eq_ignore_ascii_case("https")
        || (!is_source
            && (scheme.eq_ignore_ascii_case("mailto") || scheme.eq_ignore_ascii_case("tel")))
}

fn uri_scheme(value: &str) -> Option<&str> {
    let mut chars = value.char_indices();
    let (_, first) = chars.next()?;
    if !first.is_ascii_alphabetic() {
        return None;
    }
    for (index, ch) in chars {
        if ch == ':' {
            return Some(&value[..index]);
        }
        if !ch.is_ascii_alphanumeric() && !matches!(ch, '+' | '-' | '.') {
            return None;
        }
    }
    None
}

fn has_unsafe_url_character(value: &str) -> bool {
    value.chars().any(|ch| ch.is_ascii_control() || ch == '\\')
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn escape_attr(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
}
