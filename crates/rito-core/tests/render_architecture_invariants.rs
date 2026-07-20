use std::{
    fs,
    path::{Path, PathBuf},
};

const FORBIDDEN_RENDER_DEPENDENCIES: &[(&str, &str)] = &[
    ("rito_stylo", "the Stylo adapter"),
    ("rito_style_contract", "the style-engine contract crate"),
    ("crate::style", "the legacy style module"),
    ("crate::css", "the legacy CSS module"),
    (
        "InlineFormattingStyleV1",
        "the computed inline-style contract",
    ),
    ("ComputedValues", "Stylo computed values"),
    ("SourceArena", "the source DOM arena"),
    ("cssparser", "the CSS parser"),
];

const TEXT_PAINT_JSON_PATHS: &[(&str, &str)] = &[
    (r#".get("font")"#, "a get(\"font\") lookup"),
    (r#"["font"]"#, "a [\"font\"] lookup"),
    (r#".pointer("/font")"#, "a JSON pointer into font"),
    (".paint.as_object()", "as_object() on a command paint field"),
    (
        ".paint.as_object_mut()",
        "as_object_mut() on a command paint field",
    ),
    (
        "collect_paint_font_family",
        "the legacy JSON paint font-family helper",
    ),
];

#[test]
fn render_does_not_depend_on_style_dom_or_css_engines() {
    let mut violations = Vec::new();
    for source in render_sources() {
        for (line_index, line) in source.text.lines().enumerate() {
            for (needle, dependency) in FORBIDDEN_RENDER_DEPENDENCIES {
                if line.contains(needle) {
                    violations.push(format!(
                        "{}:{} imports or names {dependency} via `{needle}`: {}",
                        source.relative.display(),
                        line_index + 1,
                        line.trim(),
                    ));
                }
            }
        }
    }

    assert_no_violations(
        "render must consume paint-ready layout data, not style, DOM, or CSS engine internals",
        &violations,
    );
}

#[test]
fn render_text_commands_keep_the_typed_run_paint_input() {
    let crate_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let commands_path = crate_root.join("src/render/commands.rs");
    let source = fs::read_to_string(&commands_path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", commands_path.display()));
    let compact = without_whitespace(&source);
    let input = compact_struct_body(&compact, "pub(crate)structDisplayTextCommandInput{");

    assert!(
        input.contains("pubpaint:RunPaint,"),
        "DisplayTextCommandInput.paint must remain RunPaint: {input}",
    );
    assert!(
        compact.contains("PaintText(DisplayTextCommandInput)")
            && compact.contains("PaintRuby(DisplayTextCommandInput)"),
        "PaintText and PaintRuby must both consume DisplayTextCommandInput",
    );
}

#[test]
fn render_does_not_recover_text_paint_fields_through_json_paths() {
    let mut violations = Vec::new();
    for source in render_sources() {
        for (line_index, line) in source.text.lines().enumerate() {
            for (needle, description) in TEXT_PAINT_JSON_PATHS {
                if line.contains(needle) {
                    violations.push(format!(
                        "{}:{} contains {description}: {}",
                        source.relative.display(),
                        line_index + 1,
                        line.trim(),
                    ));
                }
            }
        }
    }

    assert_no_violations(
        "render must use typed RunPaint accessors; JSON traversal belongs only at wire boundaries",
        &violations,
    );
}

struct RenderSource {
    relative: PathBuf,
    text: String,
}

fn render_sources() -> Vec<RenderSource> {
    let crate_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let render_root = crate_root.join("src/render");
    let mut paths = vec![crate_root.join("src/render.rs")];
    collect_rust_sources(&render_root, &mut paths);
    paths.sort();

    assert!(
        !paths.is_empty(),
        "expected Rust sources below {}",
        render_root.display(),
    );

    paths
        .into_iter()
        .map(|path| {
            let relative = path
                .strip_prefix(&crate_root)
                .expect("render source must be inside the rito-core crate")
                .to_owned();
            let text = fs::read_to_string(&path)
                .unwrap_or_else(|error| panic!("failed to read {}: {error}", path.display()));
            RenderSource { relative, text }
        })
        .collect()
}

fn collect_rust_sources(directory: &Path, paths: &mut Vec<PathBuf>) {
    let mut entries = fs::read_dir(directory)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", directory.display()))
        .map(|entry| {
            entry.unwrap_or_else(|error| {
                panic!(
                    "failed to read an entry below {}: {error}",
                    directory.display()
                )
            })
        })
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.path());

    for entry in entries {
        let path = entry.path();
        if path.is_dir() {
            collect_rust_sources(&path, paths);
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            paths.push(path);
        }
    }
}

fn without_whitespace(source: &str) -> String {
    source
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect()
}

fn compact_struct_body<'a>(source: &'a str, declaration: &str) -> &'a str {
    let start = source
        .find(declaration)
        .unwrap_or_else(|| panic!("missing `{declaration}`"))
        + declaration.len();
    let end = source[start..]
        .find('}')
        .unwrap_or_else(|| panic!("unterminated `{declaration}`"))
        + start;
    &source[start..end]
}

fn assert_no_violations(rule: &str, violations: &[String]) {
    assert!(
        violations.is_empty(),
        "{rule}. Violations:\n{}",
        violations.join("\n"),
    );
}
