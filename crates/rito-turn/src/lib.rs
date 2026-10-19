//! The page turn every Rito host shows.
//!
//! The paper turn's motion and geometry live here once: where each sheet of
//! paper is in a frame, and how a turn moves. The web runs it through wasm,
//! Flutter through the C ABI; each host only draws what it is told, so a
//! page turns the same way on every host, to the bit.

mod aloft;
pub mod curl;
mod curl_held;
pub mod curl_hold;
mod curled;
pub mod frame;
pub mod hold;
pub mod leaf;
mod leaves;
mod math;
pub mod mesh;
mod model;
pub mod motion;
pub mod physics;
pub mod sheets;
mod swing;

pub use leaves::LeafId;
pub use model::{Begun, Forgotten, Laid, PaperModel};
pub use swing::{eye_height, leaf_turn, LeafTurn};
