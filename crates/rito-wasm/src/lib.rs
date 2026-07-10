//! WASM-facing boundary for the Rust Rito engine.
//!
//! This crate exposes the `wasm-bindgen` document facade over `rito-core`, with
//! JSON control/diagnostic views and explicit binary paths for frame commands,
//! runtime bundles, and resource transfers.

mod binding;
mod document;
mod error;
mod frame;
mod interaction;
mod resource;
mod revision;
mod wire;

pub use binding::RitoWasmDocument;
pub use document::WasmRuntimeDocument;
pub use error::{WasmRuntimeError, WasmRuntimeErrorCode};
pub use wire::WasmResourcePrefetchRequest;

pub const BOUNDARY_NAME: &str = "rito-wasm";

pub fn core_engine_name() -> &'static str {
    rito_core::ENGINE_NAME
}

#[cfg(test)]
mod tests;
