//! The page turn every Rito host shows.
//!
//! The paper turn's motion and geometry live here once: where each sheet of
//! paper is in a frame, and how a turn moves. The web runs it through wasm,
//! Flutter through the C ABI; each host only draws what it is told, so a
//! page turns the same way on every host, to the bit.
//!
//! So does the motion of any turn, whatever it looks like
//! ([`turn_motion`]): a finger holding it, the release that decides it, the
//! spring that carries it to rest, a pull against the end of the book, and
//! a turn cut into by another. Its built-in rules ([`turn_physics`]) take
//! numbers the host sets, and each decision may be the host's own physics'.

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
pub mod pack;
pub mod physics;
pub mod sheets;
#[cfg(test)]
mod spec;
pub mod spring;
mod swing;
pub mod turn_motion;
pub mod turn_physics;

pub use leaves::LeafId;
pub use model::{Begun, Forgotten, Laid, PaperModel};
pub use swing::{eye_height, leaf_turn, LeafTurn};
