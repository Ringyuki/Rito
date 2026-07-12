use super::{
    content::{RuntimeBlock, RuntimeChild, RuntimeImage},
    line::{AtomRunBox, LineBox, LineRun, TextRunBox},
    page::RuntimePage,
    visual_geometry::{VisualGeometry, VisualRect},
};

type SemanticPage = RuntimePage<RuntimeBlock<LineBox>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LayoutSemanticRole {
    Heading,
    Paragraph,
    List,
    ListItem,
    Image,
    Link,
    Blockquote,
    Table,
    Generic,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct LayoutSemanticNode {
    pub(crate) role: LayoutSemanticRole,
    pub(crate) level: Option<u8>,
    pub(crate) text: Option<String>,
    pub(crate) alt: Option<String>,
    pub(crate) href: Option<String>,
    pub(crate) bounds: VisualRect,
    pub(crate) children: Vec<LayoutSemanticNode>,
}

pub(crate) fn build_page_semantic_tree(page: &SemanticPage) -> Vec<LayoutSemanticNode> {
    let visual = VisualGeometry::page();
    page.content
        .iter()
        .filter_map(|block| block_node(block, 0.0, 0.0, visual))
        .collect()
}

fn block_node(
    block: &RuntimeBlock<LineBox>,
    offset_x: f64,
    offset_y: f64,
    parent_visual: VisualGeometry,
) -> Option<LayoutSemanticNode> {
    let block_x = offset_x + block.x;
    let block_y = offset_y + block.y;
    let visual = parent_visual.enter_block(block, block_x, block_y);
    let bounds =
        visual.resolve_rect(VisualRect::new(block_x, block_y, block.width, block.height))?;
    let mut children = Vec::new();
    let mut text = String::new();

    for child in &block.children {
        match child {
            RuntimeChild::Line(line) => {
                collect_line_semantics(line, block_x, block_y, visual, &mut children, &mut text);
            }
            RuntimeChild::Block(child) => {
                if let Some(child) = block_node(child, block_x, block_y, visual) {
                    children.push(child);
                }
            }
            RuntimeChild::Image(image) => {
                if let Some(image) = block_image_node(image, block_x, block_y, visual) {
                    children.push(image);
                }
            }
            RuntimeChild::Hr(_) => {}
        }
    }

    let (role, level) = block_role(block.semantic_tag.as_deref());
    let text = non_empty_text(text.trim());
    Some(LayoutSemanticNode {
        role,
        level,
        text,
        alt: None,
        href: None,
        bounds,
        children,
    })
}

fn collect_line_semantics(
    line: &LineBox,
    block_x: f64,
    block_y: f64,
    visual: VisualGeometry,
    children: &mut Vec<LayoutSemanticNode>,
    text: &mut String,
) {
    let line_x = block_x + line.x;
    let line_y = block_y + line.y;
    for run in &line.runs {
        match run {
            LineRun::Text(run) => {
                text.push_str(&run.text);
                if let Some(node) = text_node(run, line_x, line_y, visual) {
                    children.push(node);
                }
            }
            LineRun::Atom(run) => {
                if let Some(node) = atom_node(run, line_x, line_y, visual) {
                    children.push(node);
                }
            }
            // The base text run already carries the spoken content. Exposing
            // ruby paint annotations separately would make screen readers
            // announce the same source text twice.
            LineRun::Ruby(_) => {}
        }
    }
}

fn text_node(
    run: &TextRunBox,
    line_x: f64,
    line_y: f64,
    visual: VisualGeometry,
) -> Option<LayoutSemanticNode> {
    let bounds = child_bounds(run.x, run.y, run.width, run.height, line_x, line_y, visual)?;
    let href = non_empty_value(run.href.as_ref());
    Some(LayoutSemanticNode {
        role: if href.is_some() {
            LayoutSemanticRole::Link
        } else {
            LayoutSemanticRole::Generic
        },
        level: None,
        text: non_empty_text(&run.text),
        alt: None,
        href,
        bounds,
        children: Vec::new(),
    })
}

fn atom_node(
    run: &AtomRunBox,
    line_x: f64,
    line_y: f64,
    visual: VisualGeometry,
) -> Option<LayoutSemanticNode> {
    let bounds = child_bounds(run.x, run.y, run.width, run.height, line_x, line_y, visual)?;
    let href = non_empty_value(run.href.as_ref());
    if has_non_empty_value(run.image_src.as_ref()) {
        return Some(image_node(bounds, run.alt.clone(), href));
    }
    href.map(|href| link_node(bounds, href, Vec::new()))
}

fn block_image_node(
    image: &RuntimeImage,
    block_x: f64,
    block_y: f64,
    visual: VisualGeometry,
) -> Option<LayoutSemanticNode> {
    let bounds = child_bounds(
        image.x,
        image.y,
        image.width,
        image.height,
        block_x,
        block_y,
        visual,
    )?;
    Some(image_node(
        bounds,
        image.alt.clone(),
        non_empty_value(image.href.as_ref()),
    ))
}

fn image_node(bounds: VisualRect, alt: Option<String>, href: Option<String>) -> LayoutSemanticNode {
    let image = LayoutSemanticNode {
        role: LayoutSemanticRole::Image,
        level: None,
        text: None,
        alt,
        href: None,
        bounds,
        children: Vec::new(),
    };
    match href {
        Some(href) => link_node(bounds, href, vec![image]),
        None => image,
    }
}

fn link_node(
    bounds: VisualRect,
    href: String,
    children: Vec<LayoutSemanticNode>,
) -> LayoutSemanticNode {
    LayoutSemanticNode {
        role: LayoutSemanticRole::Link,
        level: None,
        text: None,
        alt: None,
        href: Some(href),
        bounds,
        children,
    }
}

fn child_bounds(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    offset_x: f64,
    offset_y: f64,
    visual: VisualGeometry,
) -> Option<VisualRect> {
    visual.resolve_rect(VisualRect::new(offset_x + x, offset_y + y, width, height))
}

fn block_role(tag: Option<&str>) -> (LayoutSemanticRole, Option<u8>) {
    match tag {
        Some("h1") => (LayoutSemanticRole::Heading, Some(1)),
        Some("h2") => (LayoutSemanticRole::Heading, Some(2)),
        Some("h3") => (LayoutSemanticRole::Heading, Some(3)),
        Some("h4") => (LayoutSemanticRole::Heading, Some(4)),
        Some("h5") => (LayoutSemanticRole::Heading, Some(5)),
        Some("h6") => (LayoutSemanticRole::Heading, Some(6)),
        Some("p") => (LayoutSemanticRole::Paragraph, None),
        Some("ul" | "ol") => (LayoutSemanticRole::List, None),
        Some("li") => (LayoutSemanticRole::ListItem, None),
        Some("blockquote") => (LayoutSemanticRole::Blockquote, None),
        Some("table") => (LayoutSemanticRole::Table, None),
        _ => (LayoutSemanticRole::Generic, None),
    }
}

fn non_empty_text(text: &str) -> Option<String> {
    (!text.is_empty()).then(|| text.to_owned())
}

fn non_empty_value(value: Option<&String>) -> Option<String> {
    value.filter(|value| !value.trim().is_empty()).cloned()
}

fn has_non_empty_value(value: Option<&String>) -> bool {
    value.is_some_and(|value| !value.trim().is_empty())
}

#[cfg(test)]
mod tests;
