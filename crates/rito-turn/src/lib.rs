//! The page turn every Rito host shows.
//!
//! The paper turn's motion and geometry live here once: where each sheet of
//! paper is in a frame, and how a turn moves. The web runs it through wasm,
//! Flutter through the C ABI; each host only draws what it is told, so a
//! page turns the same way on every host, to the bit.

pub mod curl;
pub mod curl_hold;
pub mod hold;
pub mod leaf;
mod math;
