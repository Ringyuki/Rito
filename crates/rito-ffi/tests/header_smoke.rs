use std::{
    fs,
    path::Path,
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

#[test]
fn public_header_compiles_as_c11() {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock follows Unix epoch")
        .as_nanos();
    let scratch = std::env::temp_dir().join(format!("rito-ffi-header-{nonce}"));
    fs::create_dir_all(&scratch).expect("scratch directory is created");
    let source = scratch.join("header_smoke.c");
    let object = scratch.join("header_smoke.o");
    fs::write(&source, smoke_source()).expect("C smoke source is written");

    let output = Command::new(c_compiler())
        .args(["-std=c11", "-Wall", "-Wextra", "-Werror", "-c"])
        .arg(&source)
        .arg("-I")
        .arg(manifest.join("include"))
        .arg("-o")
        .arg(&object)
        .output()
        .expect("a C compiler is required to validate rito_ffi.h");
    assert!(
        output.status.success(),
        "C header smoke failed:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let _ = fs::remove_dir_all(scratch);
}

/// The header and the C smoke above are hand-written mirrors of the
/// crate's exports, and neither is generated. Three exports
/// (`rito_open_with_pinned_fonts`, `rito_peek_adjacent`,
/// `rito_commit_peeked_artifact`) were absent from the header for as
/// long as the smoke never called them: nothing in this repository
/// compiles the header except this file, so a missing declaration is
/// invisible here and only surfaces in a consumer's build — or worse,
/// in a consumer who hand-writes a prototype and gets it wrong.
#[test]
fn every_exported_function_is_declared_and_exercised() {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut exported = collect_exports(&manifest.join("src"));
    exported.sort();
    exported.dedup();
    assert!(
        exported.len() > 10,
        "the export scan found only {exported:?}; it stopped matching the source"
    );

    let header = fs::read_to_string(manifest.join("include/rito_ffi.h"))
        .expect("the public header is readable");
    let smoke = smoke_source();
    for name in &exported {
        let declaration = format!("uint32_t {name}(");
        let void_declaration = format!("void {name}(");
        assert!(
            header.contains(&declaration) || header.contains(&void_declaration),
            "rito_ffi.h does not declare {name}"
        );
        assert!(
            smoke.contains(&format!("{name}(")),
            "the C smoke never calls {name}, so a wrong declaration would compile"
        );
    }
}

fn collect_exports(directory: &Path) -> Vec<String> {
    let mut names = Vec::new();
    let entries = fs::read_dir(directory).expect("the crate source directory is readable");
    for entry in entries {
        let path = entry.expect("a readable directory entry").path();
        if path.is_dir() {
            names.extend(collect_exports(&path));
            continue;
        }
        if path.extension().is_none_or(|extension| extension != "rs") {
            continue;
        }
        let source = fs::read_to_string(&path).expect("a readable Rust source file");
        for rest in source.split("pub extern \"C\" fn ").skip(1) {
            let name: String = rest
                .chars()
                .take_while(|character| character.is_alphanumeric() || *character == '_')
                .collect();
            if !name.is_empty() {
                names.push(name);
            }
        }
    }
    names
}

fn c_compiler() -> String {
    std::env::var("CC").unwrap_or_else(|_| "cc".to_owned())
}

fn smoke_source() -> &'static str {
    r#"#include <stddef.h>
#include "rito_ffi.h"

_Static_assert(RITO_STATUS_STALE_REQUEST == 5, "stable stale status");
_Static_assert(RITO_STATUS_TARGET_NOT_PUBLISHED == 6, "stable target status");
_Static_assert(RITO_STATUS_UNSUPPORTED_PROFILE == 7, "stable profile status");
_Static_assert(RITO_STATUS_BUSY == 8, "stable busy status");
_Static_assert(RITO_STATUS_QUEUE_FULL == RITO_STATUS_BUSY,
               "queue full aliases busy");
_Static_assert(RITO_STATUS_ADJACENT_PENDING == 10,
               "stable adjacent pending status");
_Static_assert(RITO_ACTOR_MAX_IN_FLIGHT == 8, "stable actor owner cap");
_Static_assert(RITO_FOREGROUND_HANDOFF_WIRE_BYTES == 48,
               "stable foreground handoff width");
_Static_assert(RITO_FOREGROUND_HANDOFF_ACK_WIRE_BYTES == 48,
               "stable foreground handoff ack width");
_Static_assert(RITO_BACKGROUND_REQUEST_WIRE_BYTES == 40,
               "stable background request width");
_Static_assert(RITO_BACKGROUND_HANDOFF_WIRE_BYTES == 44,
               "stable background handoff width");
_Static_assert(RITO_PUBLICATION_WIRE_BYTES_MAX == 16777216,
               "stable publication wire cap");

static void consume(void) {
  rito_owned_buffer artifact = {0};
  rito_owned_buffer next_artifact = {0};
  rito_owned_buffer publication_metadata = {0};
  rito_owned_buffer foreground_handoff_ack = {0};
  rito_owned_buffer background_advance = {0};
  rito_owned_buffer handoff_ack = {0};
  rito_owned_buffer resource = {0};
  rito_owned_buffer error = {0};
  const uint8_t epub[] = {0};
  const uint8_t request[] = {'R','I','T','O','R','E','Q','1'};
  const uint8_t adjacent[] = {'R','I','T','O','N','A','V','1'};
  const uint8_t foreground_handoff[] = {'R','I','T','O','F','G','H','1'};
  const uint8_t background[] = {'R','I','T','O','B','G','Q','1'};
  const uint8_t handoff[] = {'R','I','T','O','H','O','F','1'};
  const uint8_t href[] = {'i','m','a','g','e','.','j','p','g'};
  const uint8_t search[] = {'R','I','T','O','S','R','Q','1'};
  const uint8_t text_range[] = {'R','I','T','O','T','R','Q','1'};
  const uint8_t source_range[] = {'R','I','T','O','E','S','Q','1'};
  const uint8_t interaction[] = {'R','I','T','O','T','I','Q','1'};
  const uint8_t annotation[] = {'R','I','T','O','A','N','Q','1'};
  const uint8_t footnote_key[] = {'c','h','.','x','h','t','m','l','#','n'};
  rito_owned_buffer peeked = {0};
  rito_owned_buffer commit_ack = {0};
  rito_owned_buffer search_response = {0};
  rito_owned_buffer text_geometry = {0};
  rito_owned_buffer source_geometry = {0};
  rito_owned_buffer interaction_response = {0};
  rito_owned_buffer annotation_response = {0};
  rito_owned_buffer footnote = {0};
  rito_pinned_font_face face = {0};
  face.generic_role = RITO_PINNED_FONT_ROLE_SERIF;
  (void)rito_open(epub, 1, request, 8, &artifact, &error);
  (void)rito_open_with_pinned_fonts(epub, 1, request, 8, &face, 1,
                                       &artifact, &error);
  (void)rito_peek_adjacent(1, adjacent, 8, &peeked, &error);
  (void)rito_commit_peeked_artifact(1, foreground_handoff, 8,
                                       &commit_ack, &error);
  (void)rito_search(1, search, 8, &search_response, &error);
  (void)rito_get_text_range_geometry(1, text_range, 8,
                                        &text_geometry, &error);
  (void)rito_resolve_exact_source_range(1, source_range, 8,
                                           &source_geometry, &error);
  (void)rito_resolve_text_interaction(1, interaction, 8,
                                         &interaction_response, &error);
  (void)rito_resolve_annotation(1, annotation, 8, &annotation_response,
                                   &error);
  (void)rito_read_footnote(1, 1, footnote_key, sizeof(footnote_key),
                              &footnote, &error);
  (void)rito_request_artifact(1, request, 8, &next_artifact, &error);
  (void)rito_read_publication(1, &publication_metadata, &error);
  (void)rito_request_adjacent(1, adjacent, 8, &next_artifact, &error);
  (void)rito_adopt_foreground_candidate(
      1, foreground_handoff, 8, &foreground_handoff_ack, &error);
  (void)rito_advance_background(1, background, 8,
                                   &background_advance, &error);
  (void)rito_adopt_background_candidate(1, handoff, 8,
                                            &handoff_ack, &error);
  (void)rito_read_resource(1, 1, RITO_RESOURCE_KIND_IMAGE,
                              href, sizeof(href), &resource, &error);
  (void)rito_release_artifact(1, 1, &error);
  (void)rito_dispose(1, &error);
  rito_buffer_free(&artifact);
  rito_buffer_free(&next_artifact);
  rito_buffer_free(&publication_metadata);
  rito_buffer_free(&foreground_handoff_ack);
  rito_buffer_free(&background_advance);
  rito_buffer_free(&handoff_ack);
  rito_buffer_free(&resource);
  rito_buffer_free(&peeked);
  rito_buffer_free(&commit_ack);
  rito_buffer_free(&search_response);
  rito_buffer_free(&text_geometry);
  rito_buffer_free(&source_geometry);
  rito_buffer_free(&footnote);
  rito_buffer_free(&error);
}

int main(void) {
  consume();
  return (int)(RITO_ABI_VERSION - 1);
}
"#
}
