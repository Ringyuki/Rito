//! Every painted piece names the exact face shaping drew it from.

use super::*;

use rito_fragment::{ClusterPosition, FontFaceId};

fn paint_with_faces(
    root: &Fragment,
    tree: &FormattingTree,
    faces: &[String],
) -> Vec<DisplayCommand> {
    let mut commands = Vec::new();
    append_fragment_display_commands(
        &mut commands,
        tree,
        root,
        0.0,
        0.0,
        FragmentPaintContext {
            faces: Some(faces),
            ..FragmentPaintContext::default()
        },
    )
    .expect("fragments paint");
    commands
}

fn run_with_faces(width: f64, clusters: &[(u32, f64, u32)]) -> Fragment {
    let mut run = text_run(0.0, width, 0, clusters.len() as u32);
    if let Fragment::Text(text) = &mut run {
        text.clusters = clusters
            .iter()
            .map(|(byte, x, face)| ClusterPosition {
                byte: *byte,
                x: *x,
                face: FontFaceId(*face),
                joins: false,
            })
            .collect();
    }
    run
}

fn texts(commands: &[DisplayCommand]) -> Vec<(&str, &str, f64, f64)> {
    commands
        .iter()
        .filter_map(|command| match command {
            DisplayCommand::PaintText(text) => Some((
                text.text.as_str(),
                text.paint.font.family.as_str(),
                text.rect.x,
                text.rect.width,
            )),
            _ => None,
        })
        .collect()
}

#[test]
fn a_run_paints_with_the_alias_of_the_face_that_shaped_it() {
    let fixture = two_color_flow(|red, _| vec![text_item("ab", red, 0.0)]);
    let root = boxed_line(vec![run_with_faces(16.0, &[(0, 0.0, 1), (1, 8.0, 1)])]);
    let faces = [
        "__RitoPinned_serif".to_owned(),
        "__RitoPinned_cjk".to_owned(),
    ];
    let commands = paint_with_faces(&root, &fixture.tree, &faces);
    // Never the computed family list: exactly one face, by its alias.
    assert_eq!(
        texts(&commands),
        vec![("ab", "__RitoPinned_cjk", 14.0, 16.0)]
    );
}

#[test]
fn a_run_drawn_from_two_faces_paints_once_per_face() {
    let fixture = two_color_flow(|red, _| vec![text_item("abc", red, 0.0)]);
    let root = boxed_line(vec![run_with_faces(
        24.0,
        &[(0, 0.0, 0), (1, 8.0, 1), (2, 16.0, 1)],
    )]);
    let faces = ["latin".to_owned(), "cjk".to_owned()];
    let commands = paint_with_faces(&root, &fixture.tree, &faces);
    // Each piece spans from its first cluster to the next piece's, and
    // its clusters are re-based onto its own text.
    assert_eq!(
        texts(&commands),
        vec![("a", "latin", 14.0, 8.0), ("bc", "cjk", 22.0, 16.0)]
    );
    let DisplayCommand::PaintText(second) = &commands[1] else {
        panic!("expected a text command");
    };
    assert_eq!(
        second
            .clusters
            .iter()
            .map(|cluster| cluster.0)
            .collect::<Vec<_>>(),
        vec![0, 1]
    );
}

#[test]
fn a_face_the_engine_never_registered_fails_closed() {
    let fixture = two_color_flow(|red, _| vec![text_item("a", red, 0.0)]);
    let root = boxed_line(vec![run_with_faces(8.0, &[(0, 0.0, 5)])]);
    let mut commands = Vec::new();
    let faces = ["only".to_owned()];
    let result = append_fragment_display_commands(
        &mut commands,
        &fixture.tree,
        &root,
        0.0,
        0.0,
        FragmentPaintContext {
            faces: Some(&faces),
            ..FragmentPaintContext::default()
        },
    );
    assert!(result.is_err());
}
