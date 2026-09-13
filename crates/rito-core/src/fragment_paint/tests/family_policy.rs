//! The pinned-font family policy applied to a painted run.

use super::*;

#[test]
fn the_family_policy_drops_unresolvable_families_and_appends_aliases() {
    let fixture = two_color_flow(|red, _| vec![text_item("x", red, 0.0)]);
    let root = boxed_line(vec![text_run(0.0, 8.0, 0, 1)]);
    let policy = PaintFamilyPolicy {
        available: ["tinos".to_owned()].into_iter().collect(),
        aliases: vec!["__RitoPinned_test".to_owned()],
    };
    let mut commands = Vec::new();
    append_fragment_display_commands(
        &mut commands,
        &fixture.tree,
        &root,
        0.0,
        0.0,
        FragmentPaintContext {
            image_border_paints: None,
            family_policy: Some(&policy),
            node_paints: None,
            list_markers: None,
            ruby_annotation_runs: None,
            vertical_frame: None,
            flow_item_sources: None,
            ratio: 1.0,
        },
    )
    .expect("fragments paint");
    let DisplayCommand::PaintText(command) = &commands[0] else {
        panic!("expected a text command, got {:?}", commands[0]);
    };
    // The fixture stack is just "Tinos" with no generic, so the alias
    // lands after it and the injected generic closes the stack; a
    // host-only family would have been dropped.
    assert_eq!(command.paint.font.family, "Tinos, __RitoPinned_test, serif");
}
