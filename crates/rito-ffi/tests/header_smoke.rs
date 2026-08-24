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

fn c_compiler() -> String {
    std::env::var("CC").unwrap_or_else(|_| "cc".to_owned())
}

fn smoke_source() -> &'static str {
    r#"#include <stddef.h>
#include "rito_ffi.h"

_Static_assert(RITO_STATUS_STALE_REQUEST_V1 == 5, "stable stale status");
_Static_assert(RITO_STATUS_TARGET_NOT_PUBLISHED_V1 == 6, "stable target status");
_Static_assert(RITO_STATUS_UNSUPPORTED_PROFILE_V1 == 7, "stable profile status");
_Static_assert(RITO_STATUS_BUSY_V1 == 8, "stable busy status");
_Static_assert(RITO_STATUS_QUEUE_FULL_V1 == RITO_STATUS_BUSY_V1,
               "queue full aliases busy");
_Static_assert(RITO_STATUS_EXACT_SEEK_PENDING_V1 == 9,
               "stable exact-seek pending status");
_Static_assert(RITO_STATUS_ADJACENT_PENDING_V1 == 10,
               "stable adjacent pending status");
_Static_assert(RITO_ACTOR_MAX_IN_FLIGHT_V1 == 8, "stable actor owner cap");
_Static_assert(RITO_FOREGROUND_HANDOFF_WIRE_BYTES_V1 == 48,
               "stable foreground handoff width");
_Static_assert(RITO_FOREGROUND_HANDOFF_ACK_WIRE_BYTES_V1 == 48,
               "stable foreground handoff ack width");
_Static_assert(RITO_BACKGROUND_REQUEST_WIRE_BYTES_V1 == 40,
               "stable background request width");
_Static_assert(RITO_BACKGROUND_HANDOFF_WIRE_BYTES_V1 == 44,
               "stable background handoff width");
_Static_assert(RITO_PUBLICATION_WIRE_BYTES_MAX_V1 == 16777216,
               "stable publication wire cap");

static void consume(void) {
  rito_owned_buffer_v1 artifact = {0};
  rito_owned_buffer_v1 next_artifact = {0};
  rito_owned_buffer_v1 publication_metadata = {0};
  rito_owned_buffer_v1 foreground_handoff_ack = {0};
  rito_owned_buffer_v1 background_advance = {0};
  rito_owned_buffer_v1 handoff_ack = {0};
  rito_owned_buffer_v1 resource = {0};
  rito_owned_buffer_v1 error = {0};
  const uint8_t epub[] = {0};
  const uint8_t request[] = {'R','I','T','O','R','E','Q','1'};
  const uint8_t adjacent[] = {'R','I','T','O','N','A','V','1'};
  const uint8_t foreground_handoff[] = {'R','I','T','O','F','G','H','1'};
  const uint8_t background[] = {'R','I','T','O','B','G','Q','1'};
  const uint8_t handoff[] = {'R','I','T','O','H','O','F','1'};
  const uint8_t href[] = {'i','m','a','g','e','.','j','p','g'};
  (void)rito_open_v1(epub, 1, request, 8, &artifact, &error);
  (void)rito_request_artifact_v1(1, request, 8, &next_artifact, &error);
  (void)rito_read_publication_v1(1, &publication_metadata, &error);
  (void)rito_request_adjacent_v1(1, adjacent, 8, &next_artifact, &error);
  (void)rito_adopt_foreground_candidate_v1(
      1, foreground_handoff, 8, &foreground_handoff_ack, &error);
  (void)rito_advance_background_v1(1, background, 8,
                                   &background_advance, &error);
  (void)rito_adopt_background_candidate_v1(1, handoff, 8,
                                            &handoff_ack, &error);
  (void)rito_read_resource_v1(1, 1, RITO_RESOURCE_KIND_IMAGE_V1,
                              href, sizeof(href), &resource, &error);
  (void)rito_release_artifact_v1(1, 1, &error);
  (void)rito_dispose_v1(1, &error);
  rito_buffer_free_v1(&artifact);
  rito_buffer_free_v1(&next_artifact);
  rito_buffer_free_v1(&publication_metadata);
  rito_buffer_free_v1(&foreground_handoff_ack);
  rito_buffer_free_v1(&background_advance);
  rito_buffer_free_v1(&handoff_ack);
  rito_buffer_free_v1(&resource);
  rito_buffer_free_v1(&error);
}

int main(void) {
  consume();
  return (int)(RITO_ABI_VERSION_V1 - 1);
}
"#
}
