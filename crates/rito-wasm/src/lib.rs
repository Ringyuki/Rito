//! WASM-facing boundary for the Rust Rito engine: the reader session, as
//! `wasm-bindgen` exposes it to a worker. Requests and answers cross as the
//! session's own wire messages; this crate adds nothing to them.

pub(crate) mod reader_session;

pub use reader_session::RitoReaderSession;

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
