//! The numbers a host and the turn exchange, one layout for every host: a
//! frame's input, each sheet's description, a release. The web passes them
//! as typed arrays through wasm, Flutter as buffers through the C ABI.

use crate::frame::{Frame, Incoming, PageRef, Phase, Scene, Touch};
use crate::hold::Point;
use crate::leaves::LeafId;
use crate::physics::Release;
use crate::sheets::{Face, Sheet};

/// How many numbers a frame's input is.
pub const FRAME_NUMBERS: usize = 23;

/// A frame's input, as `begin` takes it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FrameInput {
    pub scene: Scene,
    pub frame: Frame,
    pub current: Option<PageRef>,
    pub incoming: Option<PageRef>,
    pub now: f64,
    pub epoch: u64,
}

fn point(numbers: &[f64]) -> Point {
    Point {
        x: numbers[0],
        y: numbers[1],
    }
}

fn page(numbers: &[f64]) -> Option<PageRef> {
    (numbers[0] != 0.0).then(|| PageRef {
        spread: numbers[1] as i64,
        content: numbers[2] as u64,
    })
}

fn put_page(out: &mut [f64], page: Option<PageRef>) {
    match page {
        Some(page) => out.copy_from_slice(&[1.0, page.spread as f64, page.content as f64]),
        None => out.fill(0.0),
    }
}

impl FrameInput {
    /// Reads `numbers`: the scene (width, height, spine, CSS px); the frame
    /// (dx, incoming 0 none / 1 next / 2 prev, phase 0 held / 1 landing /
    /// 2 returning); the touch (present, origin x, y, position x, y, farthest
    /// present, x, y); the current page and the incoming one (present,
    /// spread, content); the time in ms and the GPU context's epoch.
    pub fn read(numbers: &[f64]) -> Self {
        let touch = (numbers[7] != 0.0).then(|| Touch {
            origin: point(&numbers[8..10]),
            position: point(&numbers[10..12]),
            farthest: (numbers[12] != 0.0).then(|| point(&numbers[13..15])),
        });
        Self {
            scene: Scene {
                width: numbers[0],
                height: numbers[1],
                spine: numbers[2],
                css_pixel: numbers[3],
            },
            frame: Frame {
                dx: numbers[4],
                incoming: match numbers[5] as u8 {
                    1 => Some(Incoming::Next),
                    2 => Some(Incoming::Prev),
                    _ => None,
                },
                phase: match numbers[6] as u8 {
                    0 => Phase::Held,
                    1 => Phase::Landing,
                    _ => Phase::Returning,
                },
                touch,
            },
            current: page(&numbers[15..18]),
            incoming: page(&numbers[18..21]),
            now: numbers[21],
            epoch: numbers[22] as u64,
        }
    }

    /// Writes the input as `read` reads it.
    pub fn write(&self, out: &mut [f64]) {
        out[..FRAME_NUMBERS].fill(0.0);
        let Scene {
            width,
            height,
            spine,
            css_pixel,
        } = self.scene;
        out[..4].copy_from_slice(&[width, height, spine, css_pixel]);
        out[4] = self.frame.dx;
        out[5] = match self.frame.incoming {
            None => 0.0,
            Some(Incoming::Next) => 1.0,
            Some(Incoming::Prev) => 2.0,
        };
        out[6] = match self.frame.phase {
            Phase::Held => 0.0,
            Phase::Landing => 1.0,
            Phase::Returning => 2.0,
        };
        if let Some(touch) = self.frame.touch {
            out[7] = 1.0;
            out[8..12].copy_from_slice(&[
                touch.origin.x,
                touch.origin.y,
                touch.position.x,
                touch.position.y,
            ]);
            if let Some(farthest) = touch.farthest {
                out[12..15].copy_from_slice(&[1.0, farthest.x, farthest.y]);
            }
        }
        put_page(&mut out[15..18], self.current);
        put_page(&mut out[18..21], self.incoming);
        out[21] = self.now;
        out[22] = self.epoch as f64;
    }
}

/// How many numbers a sheet's description is.
pub const SHEET_NUMBERS: usize = 11;

fn face(face: Face) -> (f64, f64) {
    match face {
        Face::None => (0.0, 0.0),
        Face::Front(LeafId(id)) => (1.0, f64::from(id)),
        Face::After(LeafId(id)) => (2.0, f64::from(id)),
    }
}

/// Writes a sheet's description: the page on its front and its back (kind
/// 0 none / 1 a leaf's front / 2 a leaf's after, and the leaf), how far over
/// it is, whether it lies still, and its curl (present, dx, dy, at, radius).
pub fn write_sheet(sheet: &Sheet<'_>, out: &mut [f64]) {
    let (front_kind, front_leaf) = face(sheet.front);
    let (back_kind, back_leaf) = face(sheet.back);
    out[..6].copy_from_slice(&[
        front_kind,
        front_leaf,
        back_kind,
        back_leaf,
        sheet.shown,
        if sheet.still { 1.0 } else { 0.0 },
    ]);
    match sheet.curl {
        Some(curl) => out[6..11].copy_from_slice(&[1.0, curl.dx, curl.dy, curl.at, curl.radius]),
        None => out[6..11].fill(0.0),
    }
}

/// How many numbers a release is.
pub const RELEASE_NUMBERS: usize = 15;

/// Reads a release: dx, from, velocity, width, forward (1) or back (0), the
/// touch (present, origin x, y, position x, y, farthest present, x, y), and
/// the spine (present, x).
pub fn read_release(numbers: &[f64]) -> Release {
    Release {
        dx: numbers[0],
        from: numbers[1],
        velocity: numbers[2],
        width: numbers[3],
        forward: numbers[4] != 0.0,
        touch: (numbers[5] != 0.0).then(|| Touch {
            origin: point(&numbers[6..8]),
            position: point(&numbers[8..10]),
            farthest: (numbers[10] != 0.0).then(|| point(&numbers[11..13])),
        }),
        spine: (numbers[13] != 0.0).then_some(numbers[14]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_frame_reads_as_it_was_written() {
        let input = FrameInput {
            scene: Scene {
                width: 1179.0,
                height: 2280.0,
                spine: 0.0,
                css_pixel: 3.0,
            },
            frame: Frame {
                dx: -312.5,
                incoming: Some(Incoming::Next),
                phase: Phase::Held,
                touch: Some(Touch {
                    origin: Point {
                        x: 1100.0,
                        y: 2000.0,
                    },
                    position: Point {
                        x: 800.0,
                        y: 1950.0,
                    },
                    farthest: Some(Point {
                        x: 790.0,
                        y: 1950.0,
                    }),
                }),
            },
            current: Some(PageRef {
                spread: 10,
                content: 1010,
            }),
            incoming: None,
            now: 1234.5,
            epoch: 3,
        };
        let mut numbers = [0.0; FRAME_NUMBERS];
        input.write(&mut numbers);
        assert_eq!(FrameInput::read(&numbers), input);
    }

    #[test]
    fn a_settle_reads_as_it_was_written() {
        use crate::physics::{PaperSettle, SETTLE_NUMBERS};
        for (from, velocity, to) in [
            (0.0, 0.0, 0.2),
            (-100.0, -900.0, -400.0),
            (-100.0, 2000.0, -400.0),
            (-300.0, -100.0, -400.0),
        ] {
            let mut settle = PaperSettle::new(from, velocity, to, 7);
            let mut numbers = [0.0; SETTLE_NUMBERS];
            for step in 0..30 {
                settle.write(&mut numbers);
                let mut copy = PaperSettle::read(&numbers);
                assert_eq!(copy, settle);
                let seconds = f64::from(step) / 60.0;
                assert_eq!(
                    copy.step(seconds, false, 8, false),
                    settle.step(seconds, false, 8, false)
                );
            }
        }
    }
}
