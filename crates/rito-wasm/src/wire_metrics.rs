use serde::Serialize;

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::wasm_bindgen;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ViewRevisionWire {
    Json,
    Ritorb1,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ViewRevisionWireMetrics {
    wire: ViewRevisionWire,
    raw_wire_bytes: usize,
    rust_encode_ms: f64,
}

#[derive(Debug, Default)]
pub(crate) struct ViewRevisionWireMeasurement {
    armed: bool,
    last: Option<ViewRevisionWireMetrics>,
}

impl ViewRevisionWireMeasurement {
    pub(crate) fn arm(&mut self) {
        self.armed = true;
        self.last = None;
    }

    pub(crate) fn consume_arm(&mut self) -> bool {
        std::mem::take(&mut self.armed)
    }

    pub(crate) fn record(
        &mut self,
        wire: ViewRevisionWire,
        raw_wire_bytes: usize,
        rust_encode_ms: f64,
    ) {
        self.last = Some(ViewRevisionWireMetrics {
            wire,
            raw_wire_bytes,
            rust_encode_ms,
        });
    }

    pub(crate) fn take(&mut self) -> Option<ViewRevisionWireMetrics> {
        self.last.take()
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) struct WireEncodeTimer(std::time::Instant);

#[cfg(not(target_arch = "wasm32"))]
impl WireEncodeTimer {
    pub(crate) fn start() -> Self {
        Self(std::time::Instant::now())
    }

    pub(crate) fn elapsed_ms(self) -> f64 {
        self.0.elapsed().as_secs_f64() * 1_000.0
    }
}

#[cfg(target_arch = "wasm32")]
pub(crate) struct WireEncodeTimer(f64);

#[cfg(target_arch = "wasm32")]
impl WireEncodeTimer {
    pub(crate) fn start() -> Self {
        Self(performance_now())
    }

    pub(crate) fn elapsed_ms(self) -> f64 {
        let elapsed = performance_now() - self.0;
        if elapsed.is_finite() {
            elapsed.max(0.0)
        } else {
            0.0
        }
    }
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = ["globalThis", "performance"], js_name = now)]
    fn performance_now() -> f64;
}
