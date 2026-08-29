use std::{fs, path::Path};

#[test]
fn unsafe_is_isolated_to_abi_memory_bridge() {
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut violations = Vec::new();
    visit_rust_files(&source, &mut |path, text| {
        if path.ends_with("abi/memory.rs") {
            return;
        }
        for marker in ["unsafe {", "unsafe fn", "unsafe extern"] {
            if text.contains(marker) {
                violations.push(format!("{} contains {marker}", path.display()));
            }
        }
    });
    assert!(violations.is_empty(), "{}", violations.join("\n"));
}

#[test]
fn actor_registry_does_not_store_core_sessions() {
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/registry.rs");
    let text = fs::read_to_string(source).expect("registry source is readable");
    assert!(text.contains("actors: HashMap<u64, RegisteredActor>"));
    assert!(text.contains("handle: ActorHandle"));
    assert!(!text.contains("ReaderSessionV1"));
    assert!(!text.contains("RuntimeDocument"));
}

#[test]
fn actor_mailbox_stays_bounded_and_non_blocking_at_admission() {
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/actor.rs");
    let text = fs::read_to_string(source).expect("actor source is readable");
    assert!(text.contains("RITO_ACTOR_MAX_IN_FLIGHT_V1"));
    assert!(text.contains("mpsc::sync_channel(ACTOR_QUEUE_CAPACITY)"));
    assert!(text.contains("sender.try_send(envelope)"));
    assert!(!text.contains("mpsc::channel()"));
}

#[test]
fn foreground_navigation_is_a_single_latest_wins_slot() {
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/actor.rs");
    let text = fs::read_to_string(source).expect("actor source is readable");
    assert!(text.contains("queued_navigation: Option<QueuedNavigation>"));
    assert!(text.contains("ActorCommand::ForegroundNavigation"));
    assert!(text.contains("reject_superseded(replaced, request_id)"));
    assert!(text.contains("replaced.reply.try_send"));
    assert!(!text.contains("replaced.reply.send"));
}

#[test]
fn foreground_and_background_handoffs_remain_fifo_actor_commands() {
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/actor.rs");
    let text = fs::read_to_string(source).expect("actor source is readable");
    assert!(text.contains("ActorCommand::AdoptForegroundCandidate"));
    assert!(text.contains("ActorCommand::AdvanceBackground"));
    assert!(text.contains("ActorCommand::AdoptBackgroundCandidate"));
    assert_eq!(text.matches(".advance_background_once(request)").count(), 1);
    assert_eq!(
        text.matches(".adopt_background_candidate(request)").count(),
        1
    );
    assert_eq!(
        text.matches(".adopt_foreground_candidate(request)").count(),
        1
    );
    assert!(!text.contains("queued_background"));
    assert!(!text.contains("queued_handoff"));
}

#[test]
fn publication_metadata_is_binary_bounded_and_fifo() {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let actor =
        fs::read_to_string(manifest.join("src/actor.rs")).expect("actor source is readable");
    let header =
        fs::read_to_string(manifest.join("include/rito_ffi.h")).expect("public header is readable");
    assert!(actor.contains("ActorCommand::ReadPublication"));
    assert!(actor.contains("encode_reader_publication_v1(session.publication_v1())"));
    assert!(!actor.contains("queued_publication"));
    assert!(!actor.contains("publication_json"));
    assert!(header.contains("RITO_PUBLICATION_WIRE_BYTES_MAX_V1 UINT64_C(16777216)"));
    assert!(header.contains("rito_read_publication_v1"));
}

#[test]
fn exact_seek_pending_status_requires_core_owned_resumable_state() {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let actor =
        fs::read_to_string(manifest.join("src/actor.rs")).expect("actor source is readable");
    let registry =
        fs::read_to_string(manifest.join("src/registry.rs")).expect("registry source is readable");
    let header =
        fs::read_to_string(manifest.join("include/rito_ffi.h")).expect("public header is readable");
    let production_actor = actor
        .split("#[cfg(test)]")
        .next()
        .expect("actor has production source");

    assert!(actor.contains("error.status == RITO_STATUS_TARGET_NOT_PUBLISHED_V1"));
    assert!(actor.contains("error.status = RITO_STATUS_EXACT_SEEK_PENDING_V1"));
    assert!(actor.contains("error.status = RITO_STATUS_ADJACENT_PENDING_V1"));
    assert!(actor.contains("reader.has_pending_exact_seek_v1()"));
    assert!(actor.contains("session.has_pending_adjacent_v1()"));
    assert_eq!(
        production_actor
            .matches("classify_exact_seek_result(")
            .count(),
        2
    );
    assert!(actor.contains("InitialArtifactReply::Ready(initial)"));
    assert!(actor.contains("InitialArtifactReply::Failed(error)"));
    assert!(registry.contains("InitialArtifactReply::Ready(result)"));
    assert!(registry.contains("InitialArtifactReply::Failed(error)"));
    assert!(header.contains("RITO_STATUS_EXACT_SEEK_PENDING_V1"));
    assert!(header.contains("RITO_STATUS_ADJACENT_PENDING_V1"));
    assert!(header.contains("paginated whole in\n * this one call"));
    assert!(header.contains("never\n * returned by the current core"));
    assert!(header.contains("without\n * a pinned font policy fails closed"));
    assert!(header.contains("RITO_STATUS_TARGET_NOT_PUBLISHED_V1 is terminal"));
}

#[test]
fn mutating_wire_failures_terminate_the_owner_actor() {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let actor =
        fs::read_to_string(manifest.join("src/actor.rs")).expect("actor source is readable");
    let production_actor = actor
        .split("#[cfg(test)]")
        .next()
        .expect("actor has production source");

    assert!(production_actor.contains("fn encode_mutation_result<T>("));
    assert!(production_actor.contains("session.request_adjacent(request),"));
    assert!(production_actor.contains("session.advance_background_once(request),"));
    assert!(production_actor.contains("if terminate {"));
    assert!(production_actor.contains("let disposed = session.dispose().map(|_| ())"));
    assert!(production_actor.contains("return disposed;"));
}

#[test]
fn fixed_handoff_and_background_messages_are_validated_before_actor_admission() {
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/abi/memory.rs");
    let text = fs::read_to_string(source).expect("ABI source is readable");
    assert_before_admission(
        &text,
        "pub extern \"C\" fn rito_adopt_foreground_candidate_v1",
        "input::foreground_handoff",
    );
    assert_before_admission(
        &text,
        "pub extern \"C\" fn rito_advance_background_v1",
        "input::background_request",
    );
    assert_before_admission(
        &text,
        "pub extern \"C\" fn rito_adopt_background_candidate_v1",
        "input::background_handoff",
    );
    let header =
        fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("include/rito_ffi.h"))
            .expect("public header is readable");
    assert!(header.contains("RITO_FOREGROUND_HANDOFF_WIRE_BYTES_V1 UINT64_C(48)"));
    assert!(header.contains("RITO_FOREGROUND_HANDOFF_ACK_WIRE_BYTES_V1 UINT64_C(48)"));
    assert!(header.contains("rito_adopt_foreground_candidate_v1"));
}

fn assert_before_admission(source: &str, function: &str, validation: &str) {
    let function_start = source.find(function).expect("ABI function exists");
    let body = &source[function_start..];
    let next_function = body[function.len()..]
        .find("#[no_mangle]")
        .map_or(body.len(), |offset| function.len() + offset);
    let body = &body[..next_function];
    let validation = body.find(validation).expect("wire validation exists");
    let admission = body
        .find("registry::try_admit")
        .expect("actor admission exists");
    assert!(
        validation < admission,
        "wire validation must precede admission"
    );
}

fn visit_rust_files(root: &Path, visit: &mut impl FnMut(&Path, &str)) {
    for entry in fs::read_dir(root).expect("source directory is readable") {
        let path = entry.expect("directory entry is readable").path();
        if path.is_dir() {
            visit_rust_files(&path, visit);
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            let text = fs::read_to_string(&path).expect("Rust source is readable");
            visit(&path, &text);
        }
    }
}
