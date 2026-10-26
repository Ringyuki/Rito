//! Inline-block descendants must keep their ink in a vertical line.
use super::fixture::{fixture_epub_with_chapter_and_stylesheet, layout};
use super::pinned_font_policy_fixtures::{bundled_font, face, policy};
use super::revisions::revision_by_id;
use crate::layout::{
    create_layout_config, LayoutConfig, LayoutConfigInput, MarginInput, SpreadMode,
};
use crate::render::DisplayCommand;
use crate::runtime::{RuntimeDocument, RuntimePinnedFontGenericRole};

fn open(mode: &str, body: &str) -> RuntimeDocument {
    let chapter = format!(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="style.css"/></head><body>{body}</body></html>"#
    );
    let css = format!(
        "html {{ {mode}: vertical-rl; }} body, p {{ margin: 0; }} .box {{ display: inline-block; }} img {{ width: 20px; height: 30px; object-fit: fill; }}"
    );
    RuntimeDocument::open_with_pinned_font_policy(
        &fixture_epub_with_chapter_and_stylesheet(chapter.as_bytes(), &css),
        policy(vec![face(
            bundled_font("SourceHanSerifCN-Regular.otf"),
            RuntimePinnedFontGenericRole::Serif,
            None,
        )]),
    )
    .expect("inline-block document opens")
}

fn paint(document: &mut RuntimeDocument, config: &LayoutConfig) -> Vec<DisplayCommand> {
    let summary = document.create_revision(config).expect("revision");
    let revision = revision_by_id(document, &summary.revision_id);
    let session = revision.chapter_engine_session();
    let mut commands = Vec::new();
    for page in 0..revision.fragment_layout.page_count() {
        let frame = session.frame(page, 1.0).expect("paint").expect("frame");
        commands.extend(frame.commands.iter().cloned());
    }
    commands
}

fn painted_text(commands: &[DisplayCommand]) -> String {
    commands
        .iter()
        .filter_map(|command| match command {
            DisplayCommand::PaintText(run) => Some(run.text.as_ref()),
            _ => None,
        })
        .flat_map(str::chars)
        .filter(|character| !character.is_whitespace())
        .collect()
}

#[test]
fn vertical_inline_block_text_keeps_reading_order_and_link_metadata() {
    for mode in ["writing-mode", "-epub-writing-mode"] {
        let mut document = open(
            mode,
            r##"<p>外前<span class="box"><a href="#target">盒内文字</a></span>外后</p>"##,
        );
        let commands = paint(&mut document, &layout());
        assert_eq!(painted_text(&commands), "外前盒内文字外后");
        let inside = commands
            .iter()
            .find_map(|command| match command {
                DisplayCommand::PaintText(run) if run.text.contains("盒内") => Some(run),
                _ => None,
            })
            .expect("inner glyphs paint");
        assert_eq!(inside.href.as_deref(), Some("#target"));
        assert!(inside.rect.width > 0.0 && inside.rect.height > 0.0);
    }
}

#[test]
fn vertical_nested_inline_blocks_keep_every_descendant() {
    for mode in ["writing-mode", "-epub-writing-mode"] {
        let mut document = open(
            mode,
            r#"<p>外<span class="box">一级<span class="box">二级<span class="box">三级</span>二末</span>一末</span>后</p>"#,
        );
        assert_eq!(
            painted_text(&paint(&mut document, &layout())),
            "外一级二级三级二末一末后"
        );
    }
}

#[test]
fn vertical_inline_block_images_keep_physical_size_alt_and_link() {
    // A portrait author box isolates paint projection from the separate
    // landscape-image shrink-to-fit clamp in vertical inline layout.
    for mode in ["writing-mode", "-epub-writing-mode"] {
        let mut document = open(
            mode,
            r##"<p>甲<span class="box"><a href="#target"><img src="Images/cover.png" alt="boxed"/></a></span>乙<img src="Images/cover.png" alt="direct"/>丙</p>"##,
        );
        let commands = paint(&mut document, &layout());
        let images: Vec<_> = commands
            .iter()
            .filter_map(|command| match command {
                DisplayCommand::PaintImage {
                    rect, alt, href, ..
                } => Some((rect, alt, href)),
                _ => None,
            })
            .collect();
        assert_eq!(images.len(), 2, "both the boxed and direct image paint");
        for (rect, _, _) in &images {
            assert!((rect.width - 20.0).abs() < 1e-6, "physical width: {rect:?}");
            assert!(
                (rect.height - 30.0).abs() < 1e-6,
                "physical height: {rect:?}"
            );
            assert!(rect.x.is_finite() && rect.y.is_finite());
        }
        assert_eq!(images[0].1.as_deref(), Some("boxed"));
        assert_eq!(images[0].2.as_deref(), Some("#target"));
        assert_eq!(images[1].1.as_deref(), Some("direct"));
        assert_ne!(images[0].0, images[1].0);
    }
}

#[test]
fn vertical_inline_blocks_keep_text_and_images_after_relayout() {
    let body = r#"<p>前<span class="box">盒内<span class="box">嵌套</span>末尾<img src="Images/cover.png" alt="boxed"/></span>后</p><p>对照<img src="Images/cover.png" alt="direct"/>结束</p>"#;
    for mode in ["writing-mode", "-epub-writing-mode"] {
        let mut document = open(mode, body);
        for (width, height, size) in [
            (420.0, 640.0, 16.0),
            (160.0, 260.0, 22.0),
            (420.0, 640.0, 16.0),
        ] {
            let config = create_layout_config(LayoutConfigInput {
                width,
                height,
                margin: MarginInput::All(24.0),
                spread: SpreadMode::Single,
                first_page_alone: true,
                spread_gap: 0.0,
                root_font_size: size,
                line_height_override: None,
                line_height_force: None,
                font_family_override: None,
                font_family_force: None,
                device_pixel_ratio: 1.0,
            });
            let commands = paint(&mut document, &config);
            assert_eq!(painted_text(&commands), "前盒内嵌套末尾后对照结束");
            assert_eq!(
                commands
                    .iter()
                    .filter(|c| matches!(c, DisplayCommand::PaintImage { .. }))
                    .count(),
                2
            );
        }
    }
}
