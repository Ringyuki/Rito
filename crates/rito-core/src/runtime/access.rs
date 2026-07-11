use std::{error::Error, fmt};

use serde::{Deserialize, Serialize};

use super::{
    RuntimeDocument, RuntimeFrame, RuntimeFrameCommandBuffer, RuntimeFrameResourceWarmPlan,
    RuntimeInitialFrameDecision, RuntimeInitialFrameRequest, RuntimePrefetchRequest,
    RuntimePrefetchResponse, RuntimeResource, RuntimeResourceKind, RuntimeRevisionSummary,
};

mod geometry;
mod interaction;
mod revision;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRevisionHandle {
    pub revision_id: String,
    pub revision_version: u32,
}

impl RuntimeRevisionHandle {
    pub fn new(revision_id: impl Into<String>, revision_version: u32) -> Self {
        Self {
            revision_id: revision_id.into(),
            revision_version,
        }
    }
}

impl From<&RuntimeRevisionSummary> for RuntimeRevisionHandle {
    fn from(summary: &RuntimeRevisionSummary) -> Self {
        Self::new(&summary.revision_id, summary.revision_version)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeVersioned<T> {
    pub revision: RuntimeRevisionHandle,
    pub value: T,
}

impl<T> RuntimeVersioned<T> {
    pub fn new(revision: RuntimeRevisionHandle, value: T) -> Self {
        Self { revision, value }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeRevisionAccessErrorKind {
    UnknownRevision,
    StaleRevisionVersion,
    OperationFailed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRevisionAccessError {
    pub kind: RuntimeRevisionAccessErrorKind,
    pub message: String,
}

impl RuntimeRevisionAccessError {
    fn new(kind: RuntimeRevisionAccessErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    fn operation_failed(error: impl fmt::Display) -> Self {
        Self::new(
            RuntimeRevisionAccessErrorKind::OperationFailed,
            error.to_string(),
        )
    }
}

impl fmt::Display for RuntimeRevisionAccessError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl Error for RuntimeRevisionAccessError {}

impl RuntimeDocument {
    pub fn validate_revision_handle(
        &self,
        handle: &RuntimeRevisionHandle,
    ) -> Result<(), RuntimeRevisionAccessError> {
        let Some(revision) = self.revisions.get(&handle.revision_id) else {
            return Err(RuntimeRevisionAccessError::new(
                RuntimeRevisionAccessErrorKind::UnknownRevision,
                format!("unknown revision: {}", handle.revision_id),
            ));
        };
        if revision.revision_version != handle.revision_version {
            return Err(RuntimeRevisionAccessError::new(
                RuntimeRevisionAccessErrorKind::StaleRevisionVersion,
                format!(
                    "stale revision version for {}: expected {}, got {}",
                    handle.revision_id, revision.revision_version, handle.revision_version
                ),
            ));
        }
        Ok(())
    }

    pub fn release_revision_at(
        &mut self,
        handle: &RuntimeRevisionHandle,
    ) -> Result<bool, RuntimeRevisionAccessError> {
        self.validate_revision_handle(handle)?;
        Ok(self.release_revision(&handle.revision_id))
    }

    pub fn get_frame_at(
        &mut self,
        handle: &RuntimeRevisionHandle,
        spread_index: usize,
    ) -> Result<RuntimeVersioned<RuntimeFrame>, RuntimeRevisionAccessError> {
        self.versioned_write(handle, |document, revision_id| {
            document.get_frame(revision_id, spread_index)
        })
    }

    pub fn get_frame_summary_at(
        &mut self,
        handle: &RuntimeRevisionHandle,
        spread_index: usize,
    ) -> Result<RuntimeVersioned<RuntimeFrame>, RuntimeRevisionAccessError> {
        self.versioned_write(handle, |document, revision_id| {
            document.get_frame_summary(revision_id, spread_index)
        })
    }

    pub fn get_frame_command_buffer_at(
        &mut self,
        handle: &RuntimeRevisionHandle,
        spread_index: usize,
    ) -> Result<RuntimeVersioned<RuntimeFrameCommandBuffer>, RuntimeRevisionAccessError> {
        self.versioned_write(handle, |document, revision_id| {
            document.get_frame_command_buffer(revision_id, spread_index)
        })
    }

    pub fn prefetch_frames_at(
        &mut self,
        handle: &RuntimeRevisionHandle,
        request: RuntimePrefetchRequest,
    ) -> Result<RuntimeVersioned<RuntimePrefetchResponse>, RuntimeRevisionAccessError> {
        self.versioned_write(handle, |document, revision_id| {
            document.prefetch_frames(revision_id, request)
        })
    }

    pub fn initial_frame_decision_at(
        &self,
        handle: &RuntimeRevisionHandle,
        request: RuntimeInitialFrameRequest,
    ) -> Result<RuntimeVersioned<Option<RuntimeInitialFrameDecision>>, RuntimeRevisionAccessError>
    {
        self.versioned_read(handle, |document, revision_id| {
            document.initial_frame_decision(revision_id, request)
        })
    }

    pub fn cached_frame_count_at(
        &self,
        handle: &RuntimeRevisionHandle,
    ) -> Result<RuntimeVersioned<Option<usize>>, RuntimeRevisionAccessError> {
        self.validate_revision_handle(handle)?;
        Ok(RuntimeVersioned::new(
            handle.clone(),
            self.cached_frame_count(&handle.revision_id),
        ))
    }

    pub fn frame_resource_warm_plan_at(
        &self,
        handle: &RuntimeRevisionHandle,
        center_spread_index: usize,
    ) -> Result<RuntimeVersioned<RuntimeFrameResourceWarmPlan>, RuntimeRevisionAccessError> {
        self.versioned_read(handle, |document, revision_id| {
            document.frame_resource_warm_plan(revision_id, center_spread_index)
        })
    }

    pub fn get_resource_at(
        &mut self,
        handle: &RuntimeRevisionHandle,
        kind: RuntimeResourceKind,
        href: &str,
    ) -> Result<RuntimeVersioned<RuntimeResource>, RuntimeRevisionAccessError> {
        self.versioned_write(handle, |document, revision_id| {
            document.get_resource(revision_id, kind, href)
        })
    }

    fn versioned_read<T, E>(
        &self,
        handle: &RuntimeRevisionHandle,
        operation: impl FnOnce(&Self, &str) -> Result<T, E>,
    ) -> Result<RuntimeVersioned<T>, RuntimeRevisionAccessError>
    where
        E: fmt::Display,
    {
        self.validate_revision_handle(handle)?;
        let value = operation(self, &handle.revision_id)
            .map_err(RuntimeRevisionAccessError::operation_failed)?;
        Ok(RuntimeVersioned::new(handle.clone(), value))
    }

    fn versioned_write<T, E>(
        &mut self,
        handle: &RuntimeRevisionHandle,
        operation: impl FnOnce(&mut Self, &str) -> Result<T, E>,
    ) -> Result<RuntimeVersioned<T>, RuntimeRevisionAccessError>
    where
        E: fmt::Display,
    {
        self.validate_revision_handle(handle)?;
        let value = operation(self, &handle.revision_id)
            .map_err(RuntimeRevisionAccessError::operation_failed)?;
        Ok(RuntimeVersioned::new(handle.clone(), value))
    }
}
