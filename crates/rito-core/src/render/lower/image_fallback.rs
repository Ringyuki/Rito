//! The fallback an inline image paints while its bitmap is not there: a
//! tinted block over the image box with a picture icon centred in it, the
//! same picture split along a crack once the image can no longer arrive.
//!
//! The icon is drawn on a 24-unit grid: a frame ring with rounded corners,
//! a sun and a mountain ridge, one even-odd outline. It is 24 CSS pixels
//! wide, or half the box's shorter side when that is smaller, and a box too
//! small to show it at 8 CSS pixels gets the block alone.

use super::{
    path, DevicePath, DevicePoint, DeviceRect, IconPiece, ImageFallbackState, PathOp, Primitive,
};

/// The share of the text colour mixed into the page background for the
/// block, and into the block colour for the icon.
const BLOCK_INK: f64 = 0.06;
const ICON_INK: f64 = 0.4;
const ICON_GRID: f64 = 24.0;
const ICON_MIN: f64 = 8.0;
/// The crack between the halves of the broken picture, top to bottom.
const CRACK: [(f64, f64); 8] = [
    (13.5, 0.0),
    (12.6, 2.6),
    (10.7, 8.0),
    (13.3, 11.1),
    (10.8, 14.6),
    (12.9, 17.2),
    (11.3, 21.6),
    (10.5, 24.0),
];
const CRACK_HALF_GAP: f64 = 0.7;
/// The right half drops away from the left; both shift back so the pair
/// stays centred.
const RIGHT_HALF_SHIFT: (f64, f64) = (2.2, 1.6);
const PAIR_SHIFT: (f64, f64) = (-1.1, -0.8);

/// The loading and the broken fallback of the image drawn into `block`
/// (CSS pixels).
pub(super) fn image_fallbacks(src: &str, block: DeviceRect) -> [Primitive; 2] {
    let side = ICON_GRID.min(block.width.min(block.height) / 2.0);
    let icon = (side >= ICON_MIN).then(|| IconGrid {
        origin: DevicePoint::new(
            block.x + (block.width - side) / 2.0,
            block.y + (block.height - side) / 2.0,
        ),
        unit: side / ICON_GRID,
    });
    let fallback = |state, pieces| Primitive::ImageFallback {
        src: src.to_owned(),
        state,
        block,
        block_ink: BLOCK_INK,
        icon_ink: ICON_INK,
        pieces,
    };
    [
        fallback(
            ImageFallbackState::Loading,
            icon.iter().map(IconGrid::whole_picture).collect(),
        ),
        fallback(
            ImageFallbackState::Broken,
            icon.iter().flat_map(IconGrid::broken_picture).collect(),
        ),
    ]
}

/// The icon's 24-unit grid placed in CSS pixels.
struct IconGrid {
    origin: DevicePoint,
    unit: f64,
}

impl IconGrid {
    fn point(&self, (x, y): (f64, f64)) -> DevicePoint {
        DevicePoint::new(self.origin.x + x * self.unit, self.origin.y + y * self.unit)
    }

    fn offset(&self, (x, y): (f64, f64)) -> DevicePoint {
        DevicePoint::new(x * self.unit, y * self.unit)
    }

    fn rect(&self, x: f64, y: f64, width: f64, height: f64) -> DeviceRect {
        let at = self.point((x, y));
        DeviceRect::new(at.x, at.y, width * self.unit, height * self.unit)
    }

    /// Frame ring (a 18×16 box with 2-unit corners stroked 1.75 wide), sun
    /// and ridge as one even-odd outline.
    fn picture(&self) -> DevicePath {
        const STROKE_HALF: f64 = 0.875;
        let mut ops = Vec::new();
        for (inset, radius) in [
            (-STROKE_HALF, 2.0 + STROKE_HALF),
            (STROKE_HALF, 2.0 - STROKE_HALF),
        ] {
            let rect = self.rect(
                3.0 + inset,
                4.0 + inset,
                18.0 - 2.0 * inset,
                16.0 - 2.0 * inset,
            );
            let corner = radius * self.unit;
            ops.extend(path::rounded_rect(rect, corner, corner).ops);
        }
        ops.push(PathOp::Ellipse {
            center: self.point((8.5, 9.0)),
            rx: 1.75 * self.unit,
            ry: 1.75 * self.unit,
        });
        let ridge = [
            (4.0, 18.2),
            (9.2, 12.6),
            (12.6, 16.0),
            (15.5, 13.1),
            (20.0, 18.2),
        ];
        ops.extend(path::polygon(&ridge.map(|point| self.point(point))).ops);
        DevicePath { ops }
    }

    fn whole_picture(&self) -> IconPiece {
        IconPiece {
            offset: DevicePoint::new(0.0, 0.0),
            clip: None,
            path: self.picture(),
        }
    }

    /// The picture cut along the crack, the right half dropped away.
    fn broken_picture(&self) -> [IconPiece; 2] {
        let crack = |shift: f64| CRACK.map(|(x, y)| (x + shift, y));
        let mut left = vec![(-1.0, 0.0)];
        left.extend(crack(-CRACK_HALF_GAP));
        left.push((-1.0, ICON_GRID));
        let mut right = vec![(ICON_GRID + 1.0, 0.0)];
        right.extend(crack(CRACK_HALF_GAP));
        right.push((ICON_GRID + 1.0, ICON_GRID));
        let half = |outline: Vec<(f64, f64)>, shift: (f64, f64)| IconPiece {
            offset: self.offset(shift),
            clip: Some(path::polygon(
                &outline
                    .into_iter()
                    .map(|point| self.point(point))
                    .collect::<Vec<_>>(),
            )),
            path: self.picture(),
        };
        [
            half(left, PAIR_SHIFT),
            half(
                right,
                (
                    PAIR_SHIFT.0 + RIGHT_HALF_SHIFT.0,
                    PAIR_SHIFT.1 + RIGHT_HALF_SHIFT.1,
                ),
            ),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pieces(primitive: &Primitive) -> (&ImageFallbackState, &DeviceRect, &[IconPiece]) {
        match primitive {
            Primitive::ImageFallback {
                state,
                block,
                pieces,
                ..
            } => (state, block, pieces),
            other => panic!("not a fallback: {other:?}"),
        }
    }

    fn bounds(path: &DevicePath) -> (f64, f64, f64, f64) {
        // The ridge: the outline after the sun.
        let sun = path
            .ops
            .iter()
            .position(|op| matches!(op, PathOp::Ellipse { .. }))
            .expect("the picture has a sun");
        let mut xs = Vec::new();
        let mut ys = Vec::new();
        for op in &path.ops[sun + 1..] {
            if let PathOp::MoveTo(point) | PathOp::LineTo(point) = op {
                xs.push(point.x);
                ys.push(point.y);
            }
        }
        let min = |values: &[f64]| values.iter().copied().fold(f64::INFINITY, f64::min);
        let max = |values: &[f64]| values.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        (min(&xs), min(&ys), max(&xs), max(&ys))
    }

    #[test]
    fn a_large_image_centres_a_24px_picture_and_cracks_it_when_broken() {
        let block = DeviceRect::new(100.0, 50.0, 200.0, 300.0);
        let [loading, broken] = image_fallbacks("a.png", block);
        let (state, at, whole) = pieces(&loading);
        assert_eq!((*state, *at), (ImageFallbackState::Loading, block));
        assert_eq!(whole.len(), 1);
        assert!(whole[0].clip.is_none());
        // The ridge spans grid 4..20 by 12.6..18.2: one CSS pixel per
        // unit, the 24px grid centred on (200, 200).
        let (left, top, right, bottom) = bounds(&whole[0].path);
        assert!((left - 192.0).abs() < 1e-9 && (right - 208.0).abs() < 1e-9);
        assert!((top - 200.6).abs() < 1e-9 && (bottom - 206.2).abs() < 1e-9);

        let (state, _, halves) = pieces(&broken);
        assert_eq!(*state, ImageFallbackState::Broken);
        assert_eq!(halves.len(), 2);
        assert!(halves.iter().all(|half| half.clip.is_some()));
        assert_eq!(halves[0].offset, DevicePoint::new(-1.1, -0.8));
        assert!((halves[1].offset.x - 1.1).abs() < 1e-9);
        assert!((halves[1].offset.y - 0.8).abs() < 1e-9);
    }

    #[test]
    fn a_small_image_shrinks_the_picture_and_a_tiny_one_keeps_only_the_block() {
        let [loading, _] = image_fallbacks("a.png", DeviceRect::new(0.0, 0.0, 20.0, 40.0));
        let (_, _, whole) = pieces(&loading);
        let (left, _, right, _) = bounds(&whole[0].path);
        // Half the shorter side: a 10px picture, its ridge 16/24 of it.
        assert!((right - left - 10.0 * 16.0 / 24.0).abs() < 1e-9);

        for primitive in image_fallbacks("a.png", DeviceRect::new(0.0, 0.0, 15.0, 400.0)) {
            assert!(pieces(&primitive).2.is_empty());
        }
    }
}
