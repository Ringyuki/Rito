use super::super::{block_role, LayoutSemanticRole};

#[test]
fn maps_only_provable_block_roles_and_heading_levels() {
    for level in 1..=6 {
        let tag = format!("h{level}");
        assert_eq!(
            block_role(Some(&tag)),
            (LayoutSemanticRole::Heading, Some(level))
        );
    }
    assert_eq!(
        block_role(Some("article")),
        (LayoutSemanticRole::Generic, None)
    );
    assert_eq!(block_role(None), (LayoutSemanticRole::Generic, None));
}
