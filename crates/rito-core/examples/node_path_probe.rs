//! Walks a node path through every chapter of an EPUB-extracted directory
//! and reports what lives there. Usage:
//!   cargo run -p rito-core --example node_path_probe -- <dir-of-xhtml> 13,1,1,0

use rito_core::xhtml::{parse_xhtml, DocumentNode};

fn describe(node: &DocumentNode) -> String {
    match node {
        DocumentNode::Block(el) => format!("<{}> block", el.tag),
        DocumentNode::Inline(el) => format!("<{}> inline", el.tag),
        DocumentNode::Text(text) => format!("text {:?}", text.content.chars().take(24).collect::<String>()),
        DocumentNode::Image(image) => format!("IMG src={} alt={:?}", image.src, image.alt),
    }
}

fn children(node: &DocumentNode) -> &[DocumentNode] {
    match node {
        DocumentNode::Block(el) | DocumentNode::Inline(el) => &el.children,
        _ => &[],
    }
}

fn main() {
    let mut args = std::env::args().skip(1);
    let dir = args.next().expect("dir");
    let path: Vec<usize> = args
        .next()
        .expect("path")
        .split(',')
        .map(|part| part.parse().expect("index"))
        .collect();
    let mut entries: Vec<_> = std::fs::read_dir(&dir)
        .expect("read dir")
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|p| p.extension().is_some_and(|ext| ext == "xhtml"))
        .collect();
    entries.sort();
    for file in entries {
        let source = std::fs::read_to_string(&file).expect("read");
        let Ok(parsed) = parse_xhtml(&source) else {
            continue;
        };
        let mut cursor: Option<&DocumentNode> = parsed.nodes.get(path[0]);
        for index in &path[1..] {
            cursor = cursor.and_then(|node| children(node).get(*index));
        }
        if let Some(node) = cursor {
            println!(
                "{}: {}",
                file.file_name().unwrap().to_string_lossy(),
                describe(node)
            );
        }
    }
}
