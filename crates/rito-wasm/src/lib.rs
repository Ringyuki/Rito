//! WASM-facing boundary for the Rust Rito engine.
//!
//! This crate exposes the `wasm-bindgen` document facade over `rito-core`, with
//! JSON control/diagnostic views and explicit binary paths for frame commands,
//! runtime bundles, and resource transfers.

mod binding;
mod chapter_local;
mod document;
mod error;
mod frame;
mod interaction;
mod pinned_font;
mod reader_v1;
mod resource;
mod revision;
mod versioned;
mod wire;
mod wire_metrics;

pub use binding::RitoWasmDocument;
pub use document::WasmRuntimeDocument;
pub use error::{WasmRuntimeError, WasmRuntimeErrorCode};
pub use reader_v1::RitoReaderSessionV1;
pub use wire::WasmResourcePrefetchRequest;

pub const BOUNDARY_NAME: &str = "rito-wasm";

pub fn core_engine_name() -> &'static str {
    rito_core::ENGINE_NAME
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console, js_name = error)]
    fn wasm_console_error(message: &str);
}

/// On wasm a panic aborts as a bare `unreachable` trap with no message —
/// a real Rust panic and a compiler-emitted unreachable are then
/// indistinguishable from JS. This start hook reports the panic payload
/// and location to the console before the trap surfaces.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen(start)]
pub fn install_panic_report() {
    std::panic::set_hook(Box::new(|info| {
        wasm_console_error(&format!("rito-wasm panic: {info}"));
    }));
}

#[cfg(test)]
mod tests;
