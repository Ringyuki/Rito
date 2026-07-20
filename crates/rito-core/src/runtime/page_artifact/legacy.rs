use crate::layout::{
    build_hit_targets, build_page_semantic_tree, build_text_position_page,
    build_text_range_geometry, LayoutHitTarget, LayoutRuntimePage, LayoutSemanticNode,
    LayoutSemanticRole, SearchTextPosition, TextRangeRect, TextRunOffset,
};

use super::{
    PageArtifact, PageArtifactMetadata, PageArtifactRect, PageArtifactSemanticNode,
    PageArtifactSemanticRole, PageArtifactTarget, PageArtifactTargets, PageArtifactTextPosition,
    PageArtifactTextPositions, PageArtifactTextRangeGeometry, PageArtifactTextRangeRect,
    PageArtifactTextRunOffset,
};

impl PageArtifact for LayoutRuntimePage {
    fn metadata(&self) -> PageArtifactMetadata {
        PageArtifactMetadata {
            page_index: self.index,
            width: self.width,
            height: self.height,
        }
    }

    fn semantic_nodes(&self) -> Vec<PageArtifactSemanticNode> {
        build_page_semantic_tree(self)
            .into_iter()
            .map(semantic_node)
            .collect()
    }

    fn targets(&self) -> PageArtifactTargets {
        let (entries, text_hash) = build_hit_targets(self);
        PageArtifactTargets {
            entries: entries.into_iter().map(target).collect(),
            text_hash,
        }
    }

    fn text_positions(&self) -> PageArtifactTextPositions {
        let page = build_text_position_page(self);
        PageArtifactTextPositions {
            text: page.text,
            text_length: page.text_length,
            text_hash: page.text_hash,
            offsets: page.offsets.into_iter().map(text_run_offset).collect(),
        }
    }

    fn text_range_geometry(
        &self,
        start: PageArtifactTextPosition,
        end: PageArtifactTextPosition,
    ) -> PageArtifactTextRangeGeometry {
        let geometry = build_text_range_geometry(self, text_position(start), text_position(end));
        PageArtifactTextRangeGeometry {
            rects: geometry.rects.into_iter().map(text_range_rect).collect(),
        }
    }
}

fn target(target: LayoutHitTarget) -> PageArtifactTarget {
    let bounds = target.rounded_bounds();
    PageArtifactTarget {
        block_index: target.block_index,
        line_index: target.line_index,
        run_index: target.run_index,
        bounds: PageArtifactRect {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
        },
        text_hash: target.text_hash(),
        text_length: target.text_length(),
        text: target.text,
        href: target.href,
        source_path: target.source_path,
        source_text_offset: target.source_text_offset,
        image_src: target.image_src,
        image_alt: target.image_alt,
    }
}

fn text_run_offset(offset: TextRunOffset) -> PageArtifactTextRunOffset {
    PageArtifactTextRunOffset {
        start: offset.start,
        end: offset.end,
        block_index: offset.block_index,
        line_index: offset.line_index,
        run_index: offset.run_index,
    }
}

fn text_position(position: PageArtifactTextPosition) -> SearchTextPosition {
    SearchTextPosition {
        block_index: position.block_index,
        line_index: position.line_index,
        run_index: position.run_index,
        char_index: position.char_index,
    }
}

fn text_range_rect(rect: TextRangeRect) -> PageArtifactTextRangeRect {
    PageArtifactTextRangeRect {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        block_index: rect.block_index,
        line_index: rect.line_index,
        run_index: rect.run_index,
        start_char_index: rect.start_char_index,
        end_char_index: rect.end_char_index,
    }
}

fn semantic_node(node: LayoutSemanticNode) -> PageArtifactSemanticNode {
    PageArtifactSemanticNode {
        role: semantic_role(node.role),
        level: node.level,
        text: node.text,
        alt: node.alt,
        href: node.href,
        bounds: PageArtifactRect {
            x: node.bounds.x,
            y: node.bounds.y,
            width: node.bounds.width,
            height: node.bounds.height,
        },
        children: node.children.into_iter().map(semantic_node).collect(),
    }
}

fn semantic_role(role: LayoutSemanticRole) -> PageArtifactSemanticRole {
    match role {
        LayoutSemanticRole::Heading => PageArtifactSemanticRole::Heading,
        LayoutSemanticRole::Paragraph => PageArtifactSemanticRole::Paragraph,
        LayoutSemanticRole::List => PageArtifactSemanticRole::List,
        LayoutSemanticRole::ListItem => PageArtifactSemanticRole::ListItem,
        LayoutSemanticRole::Image => PageArtifactSemanticRole::Image,
        LayoutSemanticRole::Link => PageArtifactSemanticRole::Link,
        LayoutSemanticRole::Blockquote => PageArtifactSemanticRole::Blockquote,
        LayoutSemanticRole::Table => PageArtifactSemanticRole::Table,
        LayoutSemanticRole::Generic => PageArtifactSemanticRole::Generic,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_page_exposes_only_artifact_metadata() {
        let page = LayoutRuntimePage::new(7, 600.0, 800.0, None, Vec::new());
        let artifact: &dyn PageArtifact = &page;

        assert_eq!(
            artifact.metadata(),
            PageArtifactMetadata {
                page_index: 7,
                width: 600.0,
                height: 800.0,
            }
        );
        assert!(artifact.semantic_nodes().is_empty());
    }
}
