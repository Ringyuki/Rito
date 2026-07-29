use std::{
    sync::{
        mpsc::{self, Receiver, SyncSender, TrySendError},
        Arc, Mutex, MutexGuard, Weak,
    },
    thread::{self, JoinHandle},
};

use rito_core::runtime::{
    encode_reader_artifact_v1, encode_reader_background_advance_v1,
    encode_reader_background_handoff_ack_v1, encode_reader_foreground_handoff_ack_v1,
    encode_reader_publication_v1, encode_reader_resource_v1, ReaderAdjacentRequestV1,
    ReaderArtifactRequestV1, ReaderBackgroundHandoffV1, ReaderBackgroundRequestV1, ReaderErrorV1,
    ReaderForegroundHandoffV1, ReaderResourceKindV1, ReaderSessionV1,
    RuntimePinnedFontPolicyInput,
};

use crate::error::{
    FfiError, RITO_STATUS_ADJACENT_PENDING_V1, RITO_STATUS_EXACT_SEEK_PENDING_V1,
    RITO_STATUS_TARGET_NOT_PUBLISHED_V1,
};

pub const RITO_ACTOR_MAX_IN_FLIGHT_V1: u32 = 8;

const ACTOR_QUEUE_CAPACITY: usize = RITO_ACTOR_MAX_IN_FLIGHT_V1 as usize;

type Reply<T> = SyncSender<Result<T, FfiError>>;

pub(crate) enum ActorCommand {
    ForegroundNavigation {
        marker_sequence: u64,
    },
    RequestAdjacent {
        request: ReaderAdjacentRequestV1,
        reply: Reply<Vec<u8>>,
    },
    PeekAdjacent {
        request: ReaderAdjacentRequestV1,
        reply: Reply<Vec<u8>>,
    },
    AdoptForegroundCandidate {
        request: ReaderForegroundHandoffV1,
        reply: Reply<Vec<u8>>,
    },
    CommitPeekedArtifact {
        request: ReaderForegroundHandoffV1,
        reply: Reply<Vec<u8>>,
    },
    AdvanceBackground {
        request: ReaderBackgroundRequestV1,
        reply: Reply<Vec<u8>>,
    },
    AdoptBackgroundCandidate {
        request: ReaderBackgroundHandoffV1,
        reply: Reply<Vec<u8>>,
    },
    ReadPublication {
        reply: Reply<Vec<u8>>,
    },
    ReadResource {
        artifact_id: u64,
        kind: ReaderResourceKindV1,
        href: String,
        reply: Reply<Vec<u8>>,
    },
    ReleaseArtifact {
        artifact_id: u64,
        reply: Reply<()>,
    },
}

struct ActorEnvelope {
    command: ActorCommand,
    _permit: Option<CommandPermit>,
}

// The channel carries only a small marker for replaceable foreground work.
// Keeping the owned request here makes replacement O(1) and prevents a seek
// burst from filling the FIFO with work that is already obsolete.
struct QueuedNavigation {
    marker_sequence: u64,
    request: ReaderArtifactRequestV1,
    reply: Reply<Vec<u8>>,
    _permit: CommandPermit,
}

struct AdmissionState {
    sender: Option<SyncSender<ActorEnvelope>>,
    in_flight: usize,
    last_enqueued_sequence: u64,
    queued_navigation: Option<QueuedNavigation>,
}

struct ActorShared {
    admission: Mutex<AdmissionState>,
}

#[derive(Clone)]
pub(crate) struct ActorClient {
    shared: Arc<ActorShared>,
}

pub(crate) struct CommandAdmission {
    client: ActorClient,
    permit: CommandPermit,
}

struct CommandPermit {
    shared: Weak<ActorShared>,
}

impl Drop for CommandPermit {
    fn drop(&mut self) {
        let Some(shared) = self.shared.upgrade() else {
            return;
        };
        let mut state = lock_admission(&shared);
        debug_assert!(state.in_flight > 0);
        state.in_flight = state.in_flight.saturating_sub(1);
    }
}

impl ActorClient {
    pub(crate) fn try_admit(&self) -> Result<CommandAdmission, FfiError> {
        let mut state = lock_admission(&self.shared);
        if state.sender.is_none() {
            return Err(FfiError::not_found("reader actor is closing or closed"));
        }
        if state.in_flight >= ACTOR_QUEUE_CAPACITY {
            return Err(FfiError::busy(format!(
                "reader actor already owns the maximum {RITO_ACTOR_MAX_IN_FLIGHT_V1} active and queued commands"
            )));
        }
        state.in_flight += 1;
        Ok(CommandAdmission {
            client: self.clone(),
            permit: CommandPermit {
                shared: Arc::downgrade(&self.shared),
            },
        })
    }

    fn close(&self) {
        lock_admission(&self.shared).sender.take();
    }
}

impl CommandAdmission {
    fn submit(self, command: ActorCommand) -> Result<(), FfiError> {
        debug_assert!(!matches!(
            &command,
            ActorCommand::ForegroundNavigation { .. }
        ));
        let envelope = ActorEnvelope {
            command,
            _permit: Some(self.permit),
        };
        let mut state = lock_admission(&self.client.shared);
        let Some(sender) = state.sender.as_ref() else {
            drop(state);
            drop(envelope);
            return Err(FfiError::not_found("reader actor is closing or closed"));
        };
        let sequence = next_sequence(&state)?;
        let result = sender.try_send(envelope);
        if result.is_ok() {
            state.last_enqueued_sequence = sequence;
        }
        drop(state);
        match result {
            Ok(()) => Ok(()),
            Err(TrySendError::Full(_)) => Err(FfiError::busy(
                "reader actor command queue is full; the command was not queued",
            )),
            Err(TrySendError::Disconnected(_)) => Err(FfiError::engine(
                "reader actor stopped before accepting the command",
            )),
        }
    }

    fn submit_navigation(
        self,
        request: ReaderArtifactRequestV1,
        reply: Reply<Vec<u8>>,
    ) -> Result<(), FfiError> {
        let request_id = request.request_id;
        let mut state = lock_admission(&self.client.shared);
        if state.sender.is_none() {
            drop(state);
            return Err(FfiError::not_found("reader actor is closing or closed"));
        }

        let replace_tail = state
            .queued_navigation
            .as_ref()
            .is_some_and(|queued| queued.marker_sequence == state.last_enqueued_sequence);
        let replaced = if replace_tail {
            // No ownership-sensitive command follows this marker, so its queue
            // position can safely serve the replacement request as well.
            let marker_sequence = state.last_enqueued_sequence;
            state.queued_navigation.replace(QueuedNavigation {
                marker_sequence,
                request,
                reply,
                _permit: self.permit,
            })
        } else {
            // Another FIFO command followed the older marker. Leave that
            // marker as a tombstone and append the latest request so it cannot
            // jump across publication, resource, adjacent, background,
            // handoff, or release.
            let marker_sequence = next_sequence(&state)?;
            let envelope = ActorEnvelope {
                command: ActorCommand::ForegroundNavigation { marker_sequence },
                _permit: None,
            };
            let result = state
                .sender
                .as_ref()
                .expect("sender was checked above")
                .try_send(envelope);
            if result.is_err() {
                drop(state);
                return map_send_error(result);
            }
            state.last_enqueued_sequence = marker_sequence;
            state.queued_navigation.replace(QueuedNavigation {
                marker_sequence,
                request,
                reply,
                _permit: self.permit,
            })
        };
        drop(state);

        if let Some(replaced) = replaced {
            reject_superseded(replaced, request_id);
        }
        Ok(())
    }
}

fn next_sequence(state: &AdmissionState) -> Result<u64, FfiError> {
    state
        .last_enqueued_sequence
        .checked_add(1)
        .ok_or_else(|| FfiError::engine("reader actor command sequence exhausted"))
}

fn map_send_error(result: Result<(), TrySendError<ActorEnvelope>>) -> Result<(), FfiError> {
    match result {
        Ok(()) => Ok(()),
        Err(TrySendError::Full(_)) => Err(FfiError::busy(
            "reader actor command queue is full; the command was not queued",
        )),
        Err(TrySendError::Disconnected(_)) => Err(FfiError::engine(
            "reader actor stopped before accepting the command",
        )),
    }
}

fn reject_superseded(replaced: QueuedNavigation, replacement_request_id: u64) {
    let message = format!(
        "reader foreground request {} was superseded by request {replacement_request_id}",
        replaced.request.request_id
    );
    let _ = replaced.reply.try_send(Err(FfiError::stale(message)));
}

pub(crate) struct ActorHandle {
    pub(crate) client: ActorClient,
    join: JoinHandle<Result<(), FfiError>>,
}

pub(crate) struct SpawnedActor {
    pub(crate) handle: ActorHandle,
    pub(crate) initial_artifact: Receiver<InitialArtifactReply>,
}

pub(crate) type ActorExitCallback = Box<dyn FnOnce() + Send + 'static>;

pub(crate) enum InitialArtifactReply {
    /// The actor owns a usable session. The result is either the first
    /// artifact or `RITO_STATUS_EXACT_SEEK_PENDING_V1`.
    Ready(Result<Vec<u8>, FfiError>),
    /// No usable session survived initial request processing.
    Failed(FfiError),
}

pub(crate) fn spawn(
    publication: Vec<u8>,
    request: ReaderArtifactRequestV1,
    pinned_font_policy: Option<RuntimePinnedFontPolicyInput>,
    on_exit: ActorExitCallback,
) -> Result<SpawnedActor, FfiError> {
    let session_id = request.session_id;
    let (client, command_rx) = actor_channel();
    let actor_client = client.clone();
    let exit_client = client.clone();
    let (initial_tx, initial_rx) = mpsc::sync_channel(1);
    let join = thread::Builder::new()
        .name(format!("rito-reader-{session_id}"))
        .spawn(move || {
            let _exit = ActorExitGuard::new(exit_client, on_exit);
            run(
                publication,
                request,
                pinned_font_policy,
                initial_tx,
                command_rx,
                actor_client,
            )
        })
        .map_err(|error| FfiError::engine(format!("failed to spawn reader actor: {error}")))?;
    Ok(SpawnedActor {
        handle: ActorHandle { client, join },
        initial_artifact: initial_rx,
    })
}

/// Closes admission and retires registry ownership on every actor exit,
/// including unwinding panics and post-mutation wire failures.
struct ActorExitGuard {
    client: ActorClient,
    on_exit: Option<ActorExitCallback>,
}

impl ActorExitGuard {
    fn new(client: ActorClient, on_exit: ActorExitCallback) -> Self {
        Self {
            client,
            on_exit: Some(on_exit),
        }
    }
}

impl Drop for ActorExitGuard {
    fn drop(&mut self) {
        self.client.close();
        if let Some(on_exit) = self.on_exit.take() {
            on_exit();
        }
    }
}

fn actor_channel() -> (ActorClient, Receiver<ActorEnvelope>) {
    let (sender, receiver) = mpsc::sync_channel(ACTOR_QUEUE_CAPACITY);
    let client = ActorClient {
        shared: Arc::new(ActorShared {
            admission: Mutex::new(AdmissionState {
                sender: Some(sender),
                in_flight: 0,
                last_enqueued_sequence: 0,
                queued_navigation: None,
            }),
        }),
    };
    (client, receiver)
}

fn lock_admission(shared: &ActorShared) -> MutexGuard<'_, AdmissionState> {
    shared
        .admission
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn run(
    publication: Vec<u8>,
    request: ReaderArtifactRequestV1,
    pinned_font_policy: Option<RuntimePinnedFontPolicyInput>,
    initial_reply: SyncSender<InitialArtifactReply>,
    commands: Receiver<ActorEnvelope>,
    client: ActorClient,
) -> Result<(), FfiError> {
    let opened = match pinned_font_policy {
        Some(policy) => ReaderSessionV1::open_owned_with_pinned_font_policy(
            request.session_id,
            publication,
            policy,
        ),
        None => ReaderSessionV1::open_owned(request.session_id, publication),
    };
    let mut reader = match opened {
        Ok(reader) => reader,
        Err(error) => {
            let _ = initial_reply.send(InitialArtifactReply::Failed(FfiError::from(error)));
            return Ok(());
        }
    };
    let initial = reader
        .request_artifact(request)
        .map_err(FfiError::from)
        .and_then(|artifact| encode_reader_artifact_v1(&artifact).map_err(FfiError::from));
    let initial = classify_exact_seek_result(initial, reader.has_pending_exact_seek_v1());
    let session_is_ready = initial_session_is_ready(&initial);
    if session_is_ready {
        if initial_reply
            .send(InitialArtifactReply::Ready(initial))
            .is_err()
        {
            return reader.dispose().map(|_| ()).map_err(FfiError::from);
        }
        run_commands(reader, commands, client)
    } else {
        let error = initial.expect_err("a non-ready initial result cannot contain an artifact");
        if initial_reply
            .send(InitialArtifactReply::Failed(error))
            .is_err()
        {
            return reader.dispose().map(|_| ()).map_err(FfiError::from);
        }
        reader.dispose().map(|_| ()).map_err(FfiError::from)
    }
}

fn initial_session_is_ready(initial: &Result<Vec<u8>, FfiError>) -> bool {
    match initial {
        Ok(_) => true,
        Err(error) => error.status == RITO_STATUS_EXACT_SEEK_PENDING_V1,
    }
}

fn classify_exact_seek_result<T>(
    result: Result<T, FfiError>,
    has_pending_exact_seek: bool,
) -> Result<T, FfiError> {
    match result {
        Err(mut error)
            if error.status == RITO_STATUS_TARGET_NOT_PUBLISHED_V1 && has_pending_exact_seek =>
        {
            error.status = RITO_STATUS_EXACT_SEEK_PENDING_V1;
            Err(error)
        }
        result => result,
    }
}

fn classify_adjacent_result<T>(
    result: Result<T, FfiError>,
    has_pending_adjacent: bool,
) -> Result<T, FfiError> {
    match result {
        Err(mut error)
            if error.status == RITO_STATUS_TARGET_NOT_PUBLISHED_V1 && has_pending_adjacent =>
        {
            error.status = RITO_STATUS_ADJACENT_PENDING_V1;
            Err(error)
        }
        result => result,
    }
}

/// Distinguishes a deterministic Core rejection from failures that can occur
/// after a mutation has begun. Engine and identity-overflow failures are not
/// transactional across every Reader v1 path, so they must terminate the
/// actor just like a wire failure after a successful ownership mutation.
fn encode_mutation_result<T>(
    result: Result<T, ReaderErrorV1>,
    encode: impl FnOnce(&T) -> Result<Vec<u8>, ReaderErrorV1>,
) -> (Result<Vec<u8>, FfiError>, bool) {
    match result {
        Err(error) => {
            let (error, terminate) = classify_mutation_error(error);
            (Err(error), terminate)
        }
        Ok(value) => match encode(&value) {
            Ok(bytes) => (Ok(bytes), false),
            Err(error) => (
                Err(FfiError::session_terminated(format!(
                    "reader session terminated after a committed mutation could not be encoded: {error}"
                ))),
                true,
            ),
        },
    }
}

fn classify_mutation_error(error: ReaderErrorV1) -> (FfiError, bool) {
    if matches!(
        error.kind,
        rito_core::runtime::ReaderErrorKindV1::NumericOverflow
            | rito_core::runtime::ReaderErrorKindV1::EngineFailure
    ) {
        return (
            FfiError::session_terminated(format!(
                "reader session terminated because a mutation failed after state changes may have begun: {error}"
            )),
            true,
        );
    }
    (FfiError::from(error), false)
}

fn run_commands(
    mut session: ReaderSessionV1,
    commands: Receiver<ActorEnvelope>,
    client: ActorClient,
) -> Result<(), FfiError> {
    for envelope in commands {
        match envelope.command {
            ActorCommand::ForegroundNavigation { marker_sequence } => {
                let Some(navigation) = take_navigation(&client, marker_sequence) else {
                    continue;
                };
                let (result, terminate) = encode_mutation_result(
                    session.request_artifact(navigation.request),
                    encode_reader_artifact_v1,
                );
                let result =
                    classify_exact_seek_result(result, session.has_pending_exact_seek_v1());
                if terminate {
                    let disposed = session.dispose().map(|_| ()).map_err(FfiError::from);
                    let _ = navigation.reply.send(result);
                    return disposed;
                }
                let _ = navigation.reply.send(result);
            }
            ActorCommand::RequestAdjacent { request, reply } => {
                let (result, terminate) = encode_mutation_result(
                    session.request_adjacent(request),
                    encode_reader_artifact_v1,
                );
                let result = classify_adjacent_result(result, session.has_pending_adjacent_v1());
                if terminate {
                    let disposed = session.dispose().map(|_| ()).map_err(FfiError::from);
                    let _ = reply.send(result);
                    return disposed;
                }
                let _ = reply.send(result);
            }
            ActorCommand::PeekAdjacent { request, reply } => {
                let (result, terminate) = encode_mutation_result(
                    session.peek_adjacent(request),
                    encode_reader_artifact_v1,
                );
                if terminate {
                    let disposed = session.dispose().map(|_| ()).map_err(FfiError::from);
                    let _ = reply.send(result);
                    return disposed;
                }
                let _ = reply.send(result);
            }
            ActorCommand::AdoptForegroundCandidate { request, reply } => {
                let (result, terminate) = encode_mutation_result(
                    session.adopt_foreground_candidate(request),
                    encode_reader_foreground_handoff_ack_v1,
                );
                if terminate {
                    let disposed = session.dispose().map(|_| ()).map_err(FfiError::from);
                    let _ = reply.send(result);
                    return disposed;
                }
                let _ = reply.send(result);
            }
            ActorCommand::CommitPeekedArtifact { request, reply } => {
                let (result, terminate) = encode_mutation_result(
                    session.commit_peeked_artifact(request),
                    encode_reader_foreground_handoff_ack_v1,
                );
                if terminate {
                    let disposed = session.dispose().map(|_| ()).map_err(FfiError::from);
                    let _ = reply.send(result);
                    return disposed;
                }
                let _ = reply.send(result);
            }
            ActorCommand::AdvanceBackground { request, reply } => {
                let (result, terminate) = encode_mutation_result(
                    session.advance_background_once(request),
                    encode_reader_background_advance_v1,
                );
                if terminate {
                    let disposed = session.dispose().map(|_| ()).map_err(FfiError::from);
                    let _ = reply.send(result);
                    return disposed;
                }
                let _ = reply.send(result);
            }
            ActorCommand::AdoptBackgroundCandidate { request, reply } => {
                let (result, terminate) = encode_mutation_result(
                    session.adopt_background_candidate(request),
                    encode_reader_background_handoff_ack_v1,
                );
                if terminate {
                    let disposed = session.dispose().map(|_| ()).map_err(FfiError::from);
                    let _ = reply.send(result);
                    return disposed;
                }
                let _ = reply.send(result);
            }
            ActorCommand::ReadPublication { reply } => {
                let result =
                    encode_reader_publication_v1(session.publication_v1()).map_err(FfiError::from);
                let _ = reply.send(result);
            }
            ActorCommand::ReadResource {
                artifact_id,
                kind,
                href,
                reply,
            } => {
                let result = session
                    .read_resource(artifact_id, kind, &href)
                    .and_then(|resource| encode_reader_resource_v1(&resource))
                    .map_err(FfiError::from);
                let _ = reply.send(result);
            }
            ActorCommand::ReleaseArtifact { artifact_id, reply } => {
                let (result, terminate) = match session.release_artifact(artifact_id) {
                    Ok(_) => (Ok(()), false),
                    Err(error) => {
                        let (error, terminate) = classify_mutation_error(error);
                        (Err(error), terminate)
                    }
                };
                if terminate {
                    let disposed = session.dispose().map(|_| ()).map_err(FfiError::from);
                    let _ = reply.send(result);
                    return disposed;
                }
                let _ = reply.send(result);
            }
        }
    }
    session.dispose().map(|_| ()).map_err(FfiError::from)
}

fn take_navigation(client: &ActorClient, marker_sequence: u64) -> Option<QueuedNavigation> {
    let mut state = lock_admission(&client.shared);
    if state
        .queued_navigation
        .as_ref()
        .is_some_and(|queued| queued.marker_sequence == marker_sequence)
    {
        // Removing the slot before entering Core deliberately makes this work
        // active and non-replaceable. A later request receives a fresh marker.
        state.queued_navigation.take()
    } else {
        None
    }
}

pub(crate) fn request_artifact(
    admission: CommandAdmission,
    request: ReaderArtifactRequestV1,
) -> Result<Vec<u8>, FfiError> {
    let (reply_tx, reply_rx) = mpsc::sync_channel(1);
    admission.submit_navigation(request, reply_tx)?;
    reply_rx
        .recv()
        .map_err(|_| FfiError::session_terminated("reader actor dropped the artifact response"))?
}

pub(crate) fn request_adjacent(
    admission: CommandAdmission,
    request: ReaderAdjacentRequestV1,
) -> Result<Vec<u8>, FfiError> {
    call(
        admission,
        |reply| ActorCommand::RequestAdjacent { request, reply },
        "adjacent artifact",
    )
}

pub(crate) fn peek_adjacent(
    admission: CommandAdmission,
    request: ReaderAdjacentRequestV1,
) -> Result<Vec<u8>, FfiError> {
    call(
        admission,
        |reply| ActorCommand::PeekAdjacent { request, reply },
        "peeked artifact",
    )
}

pub(crate) fn adopt_foreground_candidate(
    admission: CommandAdmission,
    request: ReaderForegroundHandoffV1,
) -> Result<Vec<u8>, FfiError> {
    call(
        admission,
        |reply| ActorCommand::AdoptForegroundCandidate { request, reply },
        "foreground handoff acknowledgement",
    )
}

pub(crate) fn commit_peeked_artifact(
    admission: CommandAdmission,
    request: ReaderForegroundHandoffV1,
) -> Result<Vec<u8>, FfiError> {
    call(
        admission,
        |reply| ActorCommand::CommitPeekedArtifact { request, reply },
        "peeked commit acknowledgement",
    )
}

pub(crate) fn advance_background(
    admission: CommandAdmission,
    request: ReaderBackgroundRequestV1,
) -> Result<Vec<u8>, FfiError> {
    call(
        admission,
        |reply| ActorCommand::AdvanceBackground { request, reply },
        "background advance",
    )
}

pub(crate) fn adopt_background_candidate(
    admission: CommandAdmission,
    request: ReaderBackgroundHandoffV1,
) -> Result<Vec<u8>, FfiError> {
    call(
        admission,
        |reply| ActorCommand::AdoptBackgroundCandidate { request, reply },
        "background handoff acknowledgement",
    )
}

pub(crate) fn request_publication(admission: CommandAdmission) -> Result<Vec<u8>, FfiError> {
    call(
        admission,
        |reply| ActorCommand::ReadPublication { reply },
        "publication metadata",
    )
}

pub(crate) fn request_resource(
    admission: CommandAdmission,
    artifact_id: u64,
    kind: ReaderResourceKindV1,
    href: String,
) -> Result<Vec<u8>, FfiError> {
    call(
        admission,
        |reply| ActorCommand::ReadResource {
            artifact_id,
            kind,
            href,
            reply,
        },
        "resource",
    )
}

pub(crate) fn request_release(
    admission: CommandAdmission,
    artifact_id: u64,
) -> Result<(), FfiError> {
    call(
        admission,
        |reply| ActorCommand::ReleaseArtifact { artifact_id, reply },
        "release",
    )
}

fn call<T>(
    admission: CommandAdmission,
    make_command: impl FnOnce(Reply<T>) -> ActorCommand,
    response_name: &str,
) -> Result<T, FfiError> {
    let (reply_tx, reply_rx) = mpsc::sync_channel(1);
    admission.submit(make_command(reply_tx))?;
    reply_rx.recv().map_err(|_| {
        FfiError::session_terminated(format!("reader actor dropped the {response_name} response"))
    })?
}

pub(crate) fn shutdown(handle: ActorHandle) -> Result<(), FfiError> {
    handle.client.close();
    join(handle, "dispose")
}

pub(crate) fn join_finished(handle: ActorHandle) -> Result<(), FfiError> {
    join(handle, "open")
}

fn join(handle: ActorHandle, operation: &str) -> Result<(), FfiError> {
    match handle.join.join() {
        Ok(result) => result,
        Err(_) => Err(FfiError::engine(format!(
            "reader actor panicked during {operation}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use std::{
        sync::{
            atomic::{AtomicBool, Ordering},
            mpsc::TryRecvError,
            Arc, Barrier,
        },
        thread,
    };

    use rito_core::runtime::{
        ReaderAdjacentDirectionV1, ReaderErrorKindV1, ReaderLayoutV1, ReaderLocatorV1,
        ReaderSpreadModeV1, ReaderTextRenderingProfileV1, ReaderWorkBudgetV1,
    };

    use super::*;
    use crate::error::{
        RITO_STATUS_ADJACENT_PENDING_V1, RITO_STATUS_BUSY_V1, RITO_STATUS_ENGINE_ERROR_V1,
        RITO_STATUS_NOT_FOUND_V1, RITO_STATUS_SESSION_TERMINATED_V1, RITO_STATUS_STALE_REQUEST_V1,
    };

    #[test]
    fn pending_exact_seek_becomes_terminal_when_core_owner_is_gone() {
        let target_error = || FfiError {
            status: RITO_STATUS_TARGET_NOT_PUBLISHED_V1,
            message: "terminal target".to_owned(),
        };
        let pending: Result<Vec<u8>, FfiError> =
            classify_exact_seek_result(Err(target_error()), true);
        assert_eq!(
            pending
                .as_ref()
                .expect_err("pending remains an error")
                .status,
            RITO_STATUS_EXACT_SEEK_PENDING_V1
        );
        assert!(initial_session_is_ready(&pending));

        let terminal: Result<Vec<u8>, FfiError> =
            classify_exact_seek_result(Err(target_error()), false);
        assert_eq!(
            terminal
                .as_ref()
                .expect_err("completed unresolved seek is terminal")
                .status,
            RITO_STATUS_TARGET_NOT_PUBLISHED_V1
        );
        assert!(!initial_session_is_ready(&terminal));

        assert!(initial_session_is_ready(&Ok(vec![1])));
    }

    #[test]
    fn pending_query_cannot_reclassify_an_engine_failure() {
        let engine: Result<Vec<u8>, FfiError> =
            classify_exact_seek_result(Err(FfiError::engine("not pending")), true);
        assert_eq!(
            engine
                .as_ref()
                .expect_err("engine failure remains typed")
                .status,
            RITO_STATUS_ENGINE_ERROR_V1
        );
        assert!(!initial_session_is_ready(&engine));
    }

    #[test]
    fn adjacent_pending_requires_a_core_retained_owner() {
        let target_error = || FfiError {
            status: RITO_STATUS_TARGET_NOT_PUBLISHED_V1,
            message: "wording is not an ABI contract".to_owned(),
        };
        let pending: Result<Vec<u8>, FfiError> =
            classify_adjacent_result(Err(target_error()), true);
        assert_eq!(
            pending.expect_err("retained adjacent stays pending").status,
            RITO_STATUS_ADJACENT_PENDING_V1
        );

        let terminal: Result<Vec<u8>, FfiError> =
            classify_adjacent_result(Err(target_error()), false);
        assert_eq!(
            terminal.expect_err("ownerless adjacent is terminal").status,
            RITO_STATUS_TARGET_NOT_PUBLISHED_V1
        );

        let engine: Result<Vec<u8>, FfiError> =
            classify_adjacent_result(Err(FfiError::engine("not pending")), true);
        assert_eq!(
            engine.expect_err("engine failure remains typed").status,
            RITO_STATUS_ENGINE_ERROR_V1
        );
    }

    #[test]
    fn ambiguous_core_or_wire_mutation_failure_requires_actor_termination() {
        let operation_error = ReaderErrorV1 {
            kind: ReaderErrorKindV1::InvalidRequest,
            message: "operation failed before ownership changed".to_owned(),
        };
        let (operation_result, terminate) =
            encode_mutation_result::<u8>(Err(operation_error), |_| {
                panic!("failed operations must not be encoded")
            });
        assert!(operation_result.is_err());
        assert!(!terminate);

        for kind in [
            ReaderErrorKindV1::EngineFailure,
            ReaderErrorKindV1::NumericOverflow,
        ] {
            let mutation_error = ReaderErrorV1 {
                kind,
                message: "mutation may already have changed owned state".to_owned(),
            };
            let (mutation_result, terminate) =
                encode_mutation_result::<u8>(Err(mutation_error), |_| {
                    panic!("failed mutations must not be encoded")
                });
            assert_eq!(
                mutation_result
                    .expect_err("ambiguous Core mutation failure must be terminal")
                    .status,
                RITO_STATUS_SESSION_TERMINATED_V1
            );
            assert!(terminate);
        }

        let (release_error, terminate) = classify_mutation_error(ReaderErrorV1 {
            kind: ReaderErrorKindV1::EngineFailure,
            message: "release cleanup failed after ownership work began".to_owned(),
        });
        assert_eq!(release_error.status, RITO_STATUS_SESSION_TERMINATED_V1);
        assert!(terminate);

        let wire_error = ReaderErrorV1 {
            kind: ReaderErrorKindV1::NumericOverflow,
            message: "owned artifact exceeds wire limits".to_owned(),
        };
        let (wire_result, terminate) = encode_mutation_result(Ok(7_u8), |_| Err(wire_error));
        assert_eq!(
            wire_result
                .expect_err("post-mutation wire failure must be terminal")
                .status,
            RITO_STATUS_SESSION_TERMINATED_V1
        );
        assert!(terminate);

        let (success, terminate) = encode_mutation_result(Ok(7_u8), |value| Ok(vec![*value]));
        assert_eq!(success.expect("wire result"), vec![7]);
        assert!(!terminate);
    }

    #[test]
    fn actor_exit_guard_closes_admission_and_reports_exit() {
        let (client, commands) = actor_channel();
        let exited = Arc::new(AtomicBool::new(false));
        {
            let exited = Arc::clone(&exited);
            let _guard = ActorExitGuard::new(
                client.clone(),
                Box::new(move || exited.store(true, Ordering::SeqCst)),
            );
        }

        assert!(exited.load(Ordering::SeqCst));
        let error = match client.try_admit() {
            Ok(_) => panic!("closed actor cannot admit work"),
            Err(error) => error,
        };
        assert_eq!(error.status, RITO_STATUS_NOT_FOUND_V1);
        drop(commands);
    }

    #[test]
    fn rapid_foreground_navigation_keeps_only_the_latest_queued_request() {
        let (client, commands) = actor_channel();
        let replies = (1..=32)
            .map(|request_id| enqueue_navigation(&client, request_id))
            .collect::<Vec<_>>();

        for (index, reply) in replies.iter().take(31).enumerate() {
            let error = reply
                .try_recv()
                .expect("superseded request is rejected immediately")
                .expect_err("superseded request cannot produce an artifact");
            assert_eq!(error.status, RITO_STATUS_STALE_REQUEST_V1);
            assert!(error.message.contains(&(index + 1).to_string()));
        }
        assert!(matches!(replies[31].try_recv(), Err(TryRecvError::Empty)));
        assert_eq!(in_flight(&client), 1);

        let marker = receive_navigation_marker(&commands);
        let latest = take_navigation(&client, marker).expect("latest request owns the marker");
        assert_eq!(latest.request.request_id, 32);
        assert!(matches!(commands.try_recv(), Err(TryRecvError::Empty)));
        drop(latest);
        assert_eq!(in_flight(&client), 0);

        client.close();
        drop(commands);
    }

    #[test]
    fn replacement_does_not_cross_publication_resource_adjacent_or_release_order() {
        let (client, commands) = actor_channel();
        let first_reply = enqueue_navigation(&client, 10);
        enqueue_resource(&client, 41).expect("resource is queued");
        enqueue_publication(&client).expect("publication is queued");
        enqueue_adjacent(&client, 42).expect("adjacent turn is queued");
        enqueue_release(&client, 43).expect("release is queued");
        let latest_reply = enqueue_navigation(&client, 14);

        let stale = first_reply
            .try_recv()
            .expect("older navigation is rejected")
            .expect_err("older navigation cannot complete");
        assert_eq!(stale.status, RITO_STATUS_STALE_REQUEST_V1);
        assert!(matches!(latest_reply.try_recv(), Err(TryRecvError::Empty)));

        let stale_marker = receive_navigation_marker(&commands);
        assert!(take_navigation(&client, stale_marker).is_none());
        match commands
            .try_recv()
            .expect("resource retains FIFO position")
            .command
        {
            ActorCommand::ReadResource { artifact_id, .. } => assert_eq!(artifact_id, 41),
            _ => panic!("resource command must follow the stale marker"),
        }
        match commands
            .try_recv()
            .expect("publication retains FIFO position")
            .command
        {
            ActorCommand::ReadPublication { .. } => {}
            _ => panic!("publication command must follow the resource"),
        }
        match commands
            .try_recv()
            .expect("adjacent retains FIFO position")
            .command
        {
            ActorCommand::RequestAdjacent { request, .. } => {
                assert_eq!(request.request_id, 42);
            }
            _ => panic!("adjacent command must follow the publication read"),
        }
        match commands
            .try_recv()
            .expect("release retains FIFO position")
            .command
        {
            ActorCommand::ReleaseArtifact { artifact_id, .. } => assert_eq!(artifact_id, 43),
            _ => panic!("release command must follow the adjacent turn"),
        }
        let latest_marker = receive_navigation_marker(&commands);
        let latest = take_navigation(&client, latest_marker).expect("replacement remains queued");
        assert_eq!(latest.request.request_id, 14);
        drop(latest);
        assert_eq!(in_flight(&client), 0);

        client.close();
        drop(commands);
    }

    #[test]
    fn active_core_navigation_is_not_interrupted_by_latest_wins() {
        let (client, commands) = actor_channel();
        let active_reply = enqueue_navigation(&client, 21);
        let active_marker = receive_navigation_marker(&commands);
        let active = take_navigation(&client, active_marker).expect("first request becomes active");

        let queued_reply = enqueue_navigation(&client, 22);
        assert!(matches!(active_reply.try_recv(), Err(TryRecvError::Empty)));
        assert!(matches!(queued_reply.try_recv(), Err(TryRecvError::Empty)));
        assert_eq!(in_flight(&client), 2);

        let queued_marker = receive_navigation_marker(&commands);
        let queued =
            take_navigation(&client, queued_marker).expect("new request waits behind active");
        assert_eq!(active.request.request_id, 21);
        assert_eq!(queued.request.request_id, 22);
        drop(active);
        drop(queued);
        assert_eq!(in_flight(&client), 0);

        client.close();
        drop(commands);
    }

    #[test]
    fn foreground_and_background_handoffs_keep_fifo_position_around_navigation() {
        let (client, commands) = actor_channel();
        let first_reply = enqueue_navigation(&client, 31);
        enqueue_foreground_handoff(&client, None, 40).expect("foreground handoff is queued");
        enqueue_background(&client, 41).expect("background is queued");
        enqueue_handoff(&client, 41, 42).expect("handoff is queued");
        let latest_reply = enqueue_navigation(&client, 32);

        assert_eq!(
            first_reply
                .try_recv()
                .expect("old navigation is rejected")
                .expect_err("old navigation is stale")
                .status,
            RITO_STATUS_STALE_REQUEST_V1
        );
        assert!(matches!(latest_reply.try_recv(), Err(TryRecvError::Empty)));
        let stale_marker = receive_navigation_marker(&commands);
        assert!(take_navigation(&client, stale_marker).is_none());
        match commands
            .try_recv()
            .expect("foreground handoff stays FIFO")
            .command
        {
            ActorCommand::AdoptForegroundCandidate { request, .. } => {
                assert_eq!(request.expected_visible_artifact_id, None);
                assert_eq!(request.candidate_artifact_id, 40);
            }
            _ => panic!("foreground handoff must follow the stale marker"),
        }
        match commands.try_recv().expect("background stays FIFO").command {
            ActorCommand::AdvanceBackground { request, .. } => {
                assert_eq!(request.expected_visible_artifact_id, 41);
            }
            _ => panic!("background must follow the stale marker"),
        }
        match commands.try_recv().expect("handoff stays FIFO").command {
            ActorCommand::AdoptBackgroundCandidate { request, .. } => {
                assert_eq!(request.expected_visible_artifact_id, 41);
                assert_eq!(request.candidate_artifact_id, 42);
            }
            _ => panic!("handoff must follow background"),
        }
        let latest_marker = receive_navigation_marker(&commands);
        let latest = take_navigation(&client, latest_marker).expect("latest remains queued");
        assert_eq!(latest.request.request_id, 32);
        drop(latest);
        assert_eq!(in_flight(&client), 0);

        client.close();
        drop(commands);
    }

    #[test]
    fn queue_cap_rejects_without_owning_an_extra_command() {
        let (client, receiver) = actor_channel();
        for artifact_id in 1..=u64::from(RITO_ACTOR_MAX_IN_FLIGHT_V1) {
            enqueue_release(&client, artifact_id).expect("bounded slot is admitted");
        }

        let error = enqueue_release(&client, 999).expect_err("overflow must fail closed");
        assert_eq!(error.status, RITO_STATUS_BUSY_V1);
        assert_eq!(in_flight(&client), ACTOR_QUEUE_CAPACITY);

        client.close();
        drop(receiver);
        assert_eq!(in_flight(&client), 0);
    }

    #[test]
    fn concurrent_flood_admits_only_the_fixed_owner_cap() {
        let (client, receiver) = actor_channel();
        let caller_count = ACTOR_QUEUE_CAPACITY * 4;
        let barrier = Arc::new(Barrier::new(caller_count + 1));
        let callers = (0..caller_count)
            .map(|index| {
                let client = client.clone();
                let barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    barrier.wait();
                    enqueue_release(&client, index as u64 + 1).map_err(|error| error.status)
                })
            })
            .collect::<Vec<_>>();

        barrier.wait();
        let statuses = callers
            .into_iter()
            .map(|caller| caller.join().expect("flood caller does not panic"))
            .collect::<Vec<_>>();
        assert_eq!(
            statuses.iter().filter(|status| status.is_ok()).count(),
            ACTOR_QUEUE_CAPACITY
        );
        assert_eq!(
            statuses
                .iter()
                .filter(|status| **status == Err(RITO_STATUS_BUSY_V1))
                .count(),
            caller_count - ACTOR_QUEUE_CAPACITY
        );

        client.close();
        drop(receiver);
        assert_eq!(in_flight(&client), 0);
    }

    #[test]
    fn close_drains_admitted_commands_and_terminates_without_polling() {
        let (client, receiver) = actor_channel();
        let gate = Arc::new(Barrier::new(2));
        let actor_gate = Arc::clone(&gate);
        let actor = thread::spawn(move || {
            actor_gate.wait();
            receiver.into_iter().count()
        });
        for artifact_id in 1..=u64::from(RITO_ACTOR_MAX_IN_FLIGHT_V1) {
            enqueue_release(&client, artifact_id).expect("bounded slot is admitted");
        }

        client.close();
        gate.wait();
        assert_eq!(
            actor.join().expect("closed receiver terminates"),
            ACTOR_QUEUE_CAPACITY
        );
        assert_eq!(in_flight(&client), 0);
        let error = client
            .try_admit()
            .err()
            .expect("closed actor rejects admission");
        assert_eq!(error.status, RITO_STATUS_NOT_FOUND_V1);
    }

    #[test]
    fn unexpected_receiver_disconnect_is_an_engine_failure() {
        let (client, receiver) = actor_channel();
        let admission = client.try_admit().expect("slot is reserved");
        drop(receiver);
        let error = admission
            .submit(release_command(1))
            .expect_err("disconnected actor rejects command");
        assert_eq!(error.status, RITO_STATUS_ENGINE_ERROR_V1);
        assert_eq!(in_flight(&client), 0);
    }

    #[test]
    fn dropped_mutation_reply_is_an_explicit_terminal_status() {
        let (client, receiver) = actor_channel();
        let actor = thread::spawn(move || {
            let _command = receiver.recv().expect("release command is received");
        });

        let error = request_release(client.try_admit().expect("release slot is admitted"), 1)
            .expect_err("a dropped reply cannot prove mutation outcome");
        assert_eq!(error.status, RITO_STATUS_SESSION_TERMINATED_V1);
        actor.join().expect("reply-dropping actor exits");
    }

    fn enqueue_release(client: &ActorClient, artifact_id: u64) -> Result<(), FfiError> {
        client.try_admit()?.submit(release_command(artifact_id))
    }

    fn enqueue_navigation(
        client: &ActorClient,
        request_id: u64,
    ) -> Receiver<Result<Vec<u8>, FfiError>> {
        let admission = client.try_admit().expect("navigation slot is admitted");
        let (reply, receiver) = mpsc::sync_channel(1);
        admission
            .submit_navigation(navigation_request(request_id), reply)
            .expect("navigation is queued or replaces the queued request");
        receiver
    }

    fn enqueue_resource(client: &ActorClient, artifact_id: u64) -> Result<(), FfiError> {
        let (reply, _receiver) = mpsc::sync_channel(1);
        client.try_admit()?.submit(ActorCommand::ReadResource {
            artifact_id,
            kind: ReaderResourceKindV1::Image,
            href: format!("images/{artifact_id}.jpg"),
            reply,
        })
    }

    fn enqueue_publication(client: &ActorClient) -> Result<(), FfiError> {
        let (reply, _receiver) = mpsc::sync_channel(1);
        client
            .try_admit()?
            .submit(ActorCommand::ReadPublication { reply })
    }

    fn enqueue_adjacent(client: &ActorClient, request_id: u64) -> Result<(), FfiError> {
        let (reply, _receiver) = mpsc::sync_channel(1);
        client.try_admit()?.submit(ActorCommand::RequestAdjacent {
            request: ReaderAdjacentRequestV1 {
                session_id: 1,
                request_id,
                from_artifact_id: 1,
                direction: ReaderAdjacentDirectionV1::Next,
                work: work_budget(),
            },
            reply,
        })
    }

    fn enqueue_background(
        client: &ActorClient,
        expected_visible_artifact_id: u64,
    ) -> Result<(), FfiError> {
        let (reply, _receiver) = mpsc::sync_channel(1);
        client.try_admit()?.submit(ActorCommand::AdvanceBackground {
            request: ReaderBackgroundRequestV1 {
                session_id: 1,
                expected_visible_artifact_id,
                max_top_level_nodes_per_quantum: 1,
            },
            reply,
        })
    }

    fn enqueue_foreground_handoff(
        client: &ActorClient,
        expected_visible_artifact_id: Option<u64>,
        candidate_artifact_id: u64,
    ) -> Result<(), FfiError> {
        let (reply, _receiver) = mpsc::sync_channel(1);
        client
            .try_admit()?
            .submit(ActorCommand::AdoptForegroundCandidate {
                request: ReaderForegroundHandoffV1 {
                    session_id: 1,
                    expected_visible_artifact_id,
                    candidate_artifact_id,
                },
                reply,
            })
    }

    fn enqueue_handoff(
        client: &ActorClient,
        expected_visible_artifact_id: u64,
        candidate_artifact_id: u64,
    ) -> Result<(), FfiError> {
        let (reply, _receiver) = mpsc::sync_channel(1);
        client
            .try_admit()?
            .submit(ActorCommand::AdoptBackgroundCandidate {
                request: ReaderBackgroundHandoffV1 {
                    session_id: 1,
                    expected_visible_artifact_id,
                    candidate_artifact_id,
                },
                reply,
            })
    }

    fn release_command(artifact_id: u64) -> ActorCommand {
        let (reply, _receiver) = mpsc::sync_channel(1);
        ActorCommand::ReleaseArtifact { artifact_id, reply }
    }

    fn receive_navigation_marker(commands: &Receiver<ActorEnvelope>) -> u64 {
        match commands
            .try_recv()
            .expect("foreground marker is immediately available")
            .command
        {
            ActorCommand::ForegroundNavigation { marker_sequence } => marker_sequence,
            _ => panic!("expected a foreground navigation marker"),
        }
    }

    fn navigation_request(request_id: u64) -> ReaderArtifactRequestV1 {
        ReaderArtifactRequestV1 {
            session_id: 1,
            request_id,
            layout: ReaderLayoutV1 {
                viewport_width: 420.0,
                viewport_height: 640.0,
                margin_top: 24.0,
                margin_right: 24.0,
                margin_bottom: 24.0,
                margin_left: 24.0,
                spread_mode: ReaderSpreadModeV1::Single,
                first_page_alone: true,
                spread_gap: 0.0,
                root_font_size: 16.0,
                line_height_override: None,
                font_family_override: None,
            },
            locator: ReaderLocatorV1 {
                href: "chapter.xhtml".to_owned(),
                anchor_id: None,
                source_point: None,
                source_range: None,
                progression: None,
            },
            work: work_budget(),
            text_profile: ReaderTextRenderingProfileV1::PlatformStringRuns,
        }
    }

    fn work_budget() -> ReaderWorkBudgetV1 {
        ReaderWorkBudgetV1 {
            max_top_level_nodes_per_quantum: 32,
            max_foreground_quanta: 64,
            local_page_cap: 16,
        }
    }

    fn in_flight(client: &ActorClient) -> usize {
        lock_admission(&client.shared).in_flight
    }
}
