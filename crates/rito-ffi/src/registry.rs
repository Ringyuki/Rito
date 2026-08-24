use std::{
    collections::HashMap,
    sync::{mpsc::Receiver, Mutex, MutexGuard, OnceLock},
};

use rito_core::runtime::{
    ReaderAdjacentRequestV1, ReaderArtifactRequestV1, ReaderBackgroundHandoffV1,
    ReaderBackgroundRequestV1, ReaderForegroundHandoffV1, ReaderResourceKindV1,
    ReaderSearchRequestV1, ReaderTextRangeRequestV1, RuntimePinnedFontPolicyInput,
};

use crate::{
    actor::{self, ActorHandle, CommandAdmission, InitialArtifactReply},
    error::FfiError,
};

#[derive(Default)]
struct Registry {
    actors: HashMap<u64, RegisteredActor>,
    starting: HashMap<u64, u64>,
    next_generation: u64,
}

struct RegisteredActor {
    generation: u64,
    handle: ActorHandle,
}

static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();

pub(crate) struct OpenReservation {
    session_id: u64,
    generation: u64,
}

impl Drop for OpenReservation {
    fn drop(&mut self) {
        cancel_reservation(self.session_id, self.generation);
    }
}

fn registry() -> &'static Mutex<Registry> {
    REGISTRY.get_or_init(|| Mutex::new(Registry::default()))
}

fn lock_registry() -> MutexGuard<'static, Registry> {
    registry()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

pub(crate) fn reserve_open(session_id: u64) -> Result<OpenReservation, FfiError> {
    let mut registry = lock_registry();
    if registry.actors.contains_key(&session_id) || registry.starting.contains_key(&session_id) {
        return Err(FfiError::exists(format!(
            "reader session already exists: {session_id}"
        )));
    }
    let generation = registry.next_generation;
    registry.next_generation = generation
        .checked_add(1)
        .ok_or_else(|| FfiError::engine("reader actor generation exhausted"))?;
    registry.starting.insert(session_id, generation);
    Ok(OpenReservation {
        session_id,
        generation,
    })
}

pub(crate) fn open(
    reservation: OpenReservation,
    publication: Vec<u8>,
    request: ReaderArtifactRequestV1,
    pinned_font_policy: Option<RuntimePinnedFontPolicyInput>,
) -> Result<Vec<u8>, FfiError> {
    let session_id = request.session_id;
    if reservation.session_id != session_id {
        return Err(FfiError::invalid(
            "open reservation belongs to a different session",
        ));
    }
    let generation = reservation.generation;
    let receiver = start_registered(
        session_id,
        generation,
        publication,
        request,
        pinned_font_policy,
    )?;
    receive_initial(session_id, generation, receiver)
}

fn start_registered(
    session_id: u64,
    generation: u64,
    publication: Vec<u8>,
    request: ReaderArtifactRequestV1,
    pinned_font_policy: Option<RuntimePinnedFontPolicyInput>,
) -> Result<Receiver<InitialArtifactReply>, FfiError> {
    let mut registry = lock_registry();
    if registry.starting.get(&session_id) != Some(&generation) {
        return Err(FfiError::not_found(format!(
            "reader session was disposed before opening: {session_id}"
        )));
    }
    let spawned = actor::spawn(
        publication,
        request,
        pinned_font_policy,
        Box::new(move || retire_actor(session_id, generation)),
    )?;
    registry.actors.insert(
        session_id,
        RegisteredActor {
            generation,
            handle: spawned.handle,
        },
    );
    Ok(spawned.initial_artifact)
}

fn receive_initial(
    session_id: u64,
    generation: u64,
    initial_artifact: Receiver<InitialArtifactReply>,
) -> Result<Vec<u8>, FfiError> {
    match initial_artifact.recv() {
        Ok(InitialArtifactReply::Ready(result)) if mark_ready(session_id, generation) => result,
        Ok(InitialArtifactReply::Ready(_)) => {
            join_failed(session_id, generation);
            Err(FfiError::not_found(format!(
                "reader session was disposed while opening: {session_id}"
            )))
        }
        Ok(InitialArtifactReply::Failed(error)) => {
            join_failed(session_id, generation);
            Err(error)
        }
        Err(_) => {
            join_failed(session_id, generation);
            Err(FfiError::engine("reader actor stopped during open"))
        }
    }
}

fn mark_ready(session_id: u64, generation: u64) -> bool {
    let mut registry = lock_registry();
    if registry.starting.get(&session_id) != Some(&generation)
        || !registry.actors.contains_key(&session_id)
    {
        return false;
    }
    registry.starting.remove(&session_id);
    true
}

fn join_failed(session_id: u64, generation: u64) {
    let handle = {
        let mut registry = lock_registry();
        if registry.starting.get(&session_id) != Some(&generation) {
            return;
        }
        registry.starting.remove(&session_id);
        registry.actors.remove(&session_id)
    };
    if let Some(actor) = handle {
        let _ = actor::join_finished(actor.handle);
    }
}

fn cancel_reservation(session_id: u64, generation: u64) {
    let mut registry = lock_registry();
    if registry.starting.get(&session_id) == Some(&generation)
        && !registry.actors.contains_key(&session_id)
    {
        registry.starting.remove(&session_id);
    }
}

pub(crate) fn try_admit(session_id: u64) -> Result<CommandAdmission, FfiError> {
    let client = {
        let registry = lock_registry();
        if registry.starting.contains_key(&session_id) {
            return Err(FfiError::not_found(format!(
                "reader session is still opening: {session_id}"
            )));
        }
        registry
            .actors
            .get(&session_id)
            .ok_or_else(|| {
                FfiError::not_found(format!("reader session does not exist: {session_id}"))
            })?
            .handle
            .client
            .clone()
    };
    client.try_admit()
}

pub(crate) fn request_artifact(
    admission: CommandAdmission,
    request: ReaderArtifactRequestV1,
) -> Result<Vec<u8>, FfiError> {
    actor::request_artifact(admission, request)
}

pub(crate) fn request_adjacent(
    admission: CommandAdmission,
    request: ReaderAdjacentRequestV1,
) -> Result<Vec<u8>, FfiError> {
    actor::request_adjacent(admission, request)
}

pub(crate) fn peek_adjacent(
    admission: CommandAdmission,
    request: ReaderAdjacentRequestV1,
) -> Result<Vec<u8>, FfiError> {
    actor::peek_adjacent(admission, request)
}

pub(crate) fn adopt_foreground_candidate(
    admission: CommandAdmission,
    request: ReaderForegroundHandoffV1,
) -> Result<Vec<u8>, FfiError> {
    actor::adopt_foreground_candidate(admission, request)
}

pub(crate) fn commit_peeked_artifact(
    admission: CommandAdmission,
    request: ReaderForegroundHandoffV1,
) -> Result<Vec<u8>, FfiError> {
    actor::commit_peeked_artifact(admission, request)
}

pub(crate) fn advance_background(
    admission: CommandAdmission,
    request: ReaderBackgroundRequestV1,
) -> Result<Vec<u8>, FfiError> {
    actor::advance_background(admission, request)
}

pub(crate) fn adopt_background_candidate(
    admission: CommandAdmission,
    request: ReaderBackgroundHandoffV1,
) -> Result<Vec<u8>, FfiError> {
    actor::adopt_background_candidate(admission, request)
}

pub(crate) fn read_publication(admission: CommandAdmission) -> Result<Vec<u8>, FfiError> {
    actor::request_publication(admission)
}

pub(crate) fn read_resource(
    admission: CommandAdmission,
    artifact_id: u64,
    kind: ReaderResourceKindV1,
    href: String,
) -> Result<Vec<u8>, FfiError> {
    actor::request_resource(admission, artifact_id, kind, href)
}

pub(crate) fn search(
    admission: CommandAdmission,
    request: ReaderSearchRequestV1,
) -> Result<Vec<u8>, FfiError> {
    actor::request_search(admission, request)
}

pub(crate) fn text_range_geometry(
    admission: CommandAdmission,
    request: ReaderTextRangeRequestV1,
) -> Result<Vec<u8>, FfiError> {
    actor::request_text_range_geometry(admission, request)
}

pub(crate) fn read_footnote(
    admission: CommandAdmission,
    artifact_id: u64,
    key: String,
) -> Result<Vec<u8>, FfiError> {
    actor::request_footnote(admission, artifact_id, key)
}

pub(crate) fn release_artifact(
    admission: CommandAdmission,
    artifact_id: u64,
) -> Result<(), FfiError> {
    actor::request_release(admission, artifact_id)
}

pub(crate) fn dispose(session_id: u64) -> Result<(), FfiError> {
    let handle = {
        let mut registry = lock_registry();
        registry.starting.remove(&session_id);
        registry.actors.remove(&session_id)
    };
    let Some(handle) = handle else {
        return Ok(());
    };
    actor::shutdown(handle.handle)
}

/// Removes only the actor generation that actually exited. This prevents a
/// late callback from an explicitly disposed actor from deleting a newly
/// opened session that reused the same external session id.
fn retire_actor(session_id: u64, generation: u64) {
    let mut registry = lock_registry();
    if registry
        .actors
        .get(&session_id)
        .is_some_and(|actor| actor.generation == generation)
    {
        registry.actors.remove(&session_id);
    }
}
