//! The paper's geometry against what the web's paper turn computed when it
//! moved here (`fixtures/web-geometry.json`, made from its TypeScript).
//!
//! The web's Math and libm differ in the last bit of a few results in a
//! hundred, so values are held within a tolerance: far below a pixel, and
//! far below what any decision downstream turns on.

use rito_turn::curl::{
    behind, curl_through, laid_back, lay_curl, line_at, stands_at, Curl, CurlLine,
};
use rito_turn::curl_hold::{eased_in, edge_gone, leant_by, shown_for, still_short};
use rito_turn::hold::{hold_of, swung_to, Hold, Point, View};
use rito_turn::leaf::{lay_leaf, leaf_point, pose_at, LeafGrab, LeafPose, LeafShape};
use serde_json::Value;

fn reference() -> Value {
    serde_json::from_str(include_str!("fixtures/web-geometry.json")).expect("the reference reads")
}

fn n(value: &Value, key: &str) -> f64 {
    value[key]
        .as_f64()
        .unwrap_or_else(|| panic!("{key} is a number in {value}"))
}

fn shape(value: &Value) -> LeafShape {
    LeafShape {
        spine: n(value, "spine"),
        width: n(value, "width"),
        height: n(value, "height"),
    }
}

fn view(value: &Value) -> View {
    View {
        width: n(value, "width"),
        height: n(value, "height"),
        eye: n(value, "eye"),
    }
}

fn line(value: &Value) -> CurlLine {
    CurlLine {
        top: n(value, "top"),
        bottom: n(value, "bottom"),
    }
}

fn floats(value: &Value) -> Vec<f32> {
    value
        .as_array()
        .expect("an array")
        .iter()
        .map(|x| x.as_f64().expect("a number") as f32)
        .collect()
}

/// The largest difference seen for one function, relative to the value's size.
struct Worst {
    name: &'static str,
    tolerance: f64,
    worst: f64,
}

impl Worst {
    fn new(name: &'static str, tolerance: f64) -> Self {
        Self {
            name,
            tolerance,
            worst: 0.0,
        }
    }

    fn see(&mut self, ours: f64, web: f64) {
        let difference = if ours == web {
            0.0
        } else {
            (ours - web).abs() / web.abs().max(1.0)
        };
        assert!(
            !difference.is_nan(),
            "{}: {ours} against the web's {web}",
            self.name
        );
        self.worst = self.worst.max(difference);
    }

    fn check(self) {
        println!("{:<14} worst {:.3e}", self.name, self.worst);
        assert!(
            self.worst <= self.tolerance,
            "{}: {:.3e} over {:.0e}",
            self.name,
            self.worst,
            self.tolerance
        );
    }
}

#[test]
fn the_geometry_is_the_webs() {
    let all = reference();
    let cases = |name: &str| all[name].as_array().expect("cases").clone();

    let mut worst = Worst::new("pose_at", 1e-12);
    for case in cases("pose_at") {
        let i = &case["input"];
        let grab = LeafGrab {
            u: n(&i["grab"], "u"),
            v: n(&i["grab"], "v"),
        };
        let pose = pose_at(shape(&i["shape"]), grab, n(i, "turned"));
        for (ours, key) in [
            (pose.swing, "swing"),
            (pose.cone, "cone"),
            (pose.apex, "apex"),
        ] {
            worst.see(ours, n(&case["output"], key));
        }
    }
    worst.check();

    let pose_of = |value: &Value| LeafPose {
        swing: n(value, "swing"),
        cone: n(value, "cone"),
        apex: n(value, "apex"),
    };
    let mut worst = Worst::new("leaf_point", 1e-12);
    for case in cases("leaf_point") {
        let i = &case["input"];
        let point = leaf_point(
            shape(&i["shape"]),
            pose_of(&i["pose"]),
            n(i, "out"),
            n(i, "down"),
        );
        for (axis, ours) in point.iter().enumerate() {
            worst.see(*ours, case["output"][axis].as_f64().expect("a number"));
        }
    }
    worst.check();

    let mut worst = Worst::new("line_at", 1e-15);
    for case in cases("line_at") {
        let i = &case["input"];
        let ours = line_at(shape(&i["shape"]), n(i, "shown"), n(i, "lean"));
        worst.see(ours.top, n(&case["output"], "top"));
        worst.see(ours.bottom, n(&case["output"], "bottom"));
        let back = behind(ours, ours);
        assert_eq!(back, ours);
    }
    worst.check();

    let mut worst = Worst::new("curl_through", 1e-14);
    for case in cases("curl_through") {
        let i = &case["input"];
        let ours = curl_through(shape(&i["shape"]), line(&i["line"]));
        for (value, key) in [
            (ours.dx, "dx"),
            (ours.dy, "dy"),
            (ours.at, "at"),
            (ours.radius, "radius"),
        ] {
            worst.see(value, n(&case["output"], key));
        }
    }
    worst.check();

    let mut worst = Worst::new("laid_back", 1e-12);
    for case in cases("laid_back") {
        let i = &case["input"];
        worst.see(
            laid_back(n(i, "past"), n(i, "radius")),
            case["output"].as_f64().expect("a number"),
        );
    }
    worst.check();
    let mut worst = Worst::new("stands_at", 1e-12);
    for case in cases("stands_at") {
        let i = &case["input"];
        worst.see(
            stands_at(n(i, "past"), n(i, "radius")),
            case["output"].as_f64().expect("a number"),
        );
    }
    worst.check();

    let mut worst = Worst::new("edge_gone", 1e-9);
    for case in cases("edge_gone") {
        let i = &case["input"];
        let ours = edge_gone(
            shape(&i["shape"]),
            line(&i["line"]),
            n(i, "y"),
            view(&i["view"]),
        );
        worst.see(ours, case["output"].as_f64().expect("a number"));
    }
    worst.check();

    // A bisection's answer moves by its last step when a probe lands either side of the bit it differs in.
    let mut worst = Worst::new("shown_for", 1e-8);
    for case in cases("shown_for") {
        let i = &case["input"];
        let ours = shown_for(
            shape(&i["shape"]),
            n(i, "to"),
            n(i, "lean"),
            n(i, "y"),
            view(&i["view"]),
        );
        worst.see(ours, case["output"].as_f64().expect("a number"));
    }
    worst.check();

    let mut worst = Worst::new("still_short", 1e-15);
    for case in cases("still_short") {
        worst.see(
            still_short(n(&case["input"], "seconds")),
            case["output"].as_f64().expect("a number"),
        );
    }
    worst.check();
    let mut worst = Worst::new("eased_in", 1e-15);
    for case in cases("eased_in") {
        let i = &case["input"];
        worst.see(
            eased_in(shape(&i["shape"]), n(i, "gone")),
            case["output"].as_f64().expect("a number"),
        );
    }
    worst.check();
    let mut worst = Worst::new("leant_by", 1e-15);
    for case in cases("leant_by") {
        let i = &case["input"];
        let ours = leant_by(
            shape(&i["shape"]),
            n(i, "wanted"),
            n(i, "gone"),
            n(i, "y"),
            n(i, "kept"),
        );
        worst.see(ours, case["output"].as_f64().expect("a number"));
    }
    worst.check();

    let mut positions_worst = Worst::new("lay_leaf xyz", 1e-6);
    let mut normals_worst = Worst::new("lay_leaf n", 1e-6);
    for case in cases("lay_leaf") {
        let i = &case["input"];
        let (columns, rows) = (n(i, "columns") as usize, n(i, "rows") as usize);
        let mut positions = vec![0.0f32; columns * rows * 3];
        let mut normals = vec![0.0f32; columns * rows * 3];
        lay_leaf(
            shape(&i["shape"]),
            pose_of(&i["pose"]),
            columns,
            rows,
            &mut positions,
            &mut normals,
        );
        for (ours, web) in positions.iter().zip(floats(&case["output"]["positions"])) {
            positions_worst.see(f64::from(*ours), f64::from(web));
        }
        for (ours, web) in normals.iter().zip(floats(&case["output"]["normals"])) {
            normals_worst.see(f64::from(*ours), f64::from(web));
        }
    }
    positions_worst.check();
    normals_worst.check();

    let mut differing = 0;
    for case in cases("hold_of") {
        let i = &case["input"];
        let finger = Point {
            x: n(&i["finger"], "x"),
            y: n(&i["finger"], "y"),
        };
        let ours = hold_of(
            &floats(&i["positions"]),
            n(i, "columns") as usize,
            n(i, "rows") as usize,
            view(&i["view"]),
            finger,
        );
        let web = Hold {
            u: n(&case["output"], "u"),
            v: n(&case["output"], "v"),
            offset: n(&case["output"], "offset"),
        };
        if ours.u != web.u || ours.v != web.v || (ours.offset - web.offset).abs() > 1e-9 {
            differing += 1;
        }
    }
    println!("hold_of        {differing} differ");
    assert_eq!(differing, 0);

    let mut worst = Worst::new("swung_to", 1e-6);
    for case in cases("swung_to") {
        let i = &case["input"];
        let hold = Hold {
            u: n(&i["hold"], "u"),
            v: n(&i["hold"], "v"),
            offset: n(&i["hold"], "offset"),
        };
        let grab = LeafGrab {
            u: n(&i["grab"], "u"),
            v: n(&i["grab"], "v"),
        };
        let ours = swung_to(
            shape(&i["shape"]),
            grab,
            hold,
            view(&i["view"]),
            n(i, "finger_x"),
            n(i, "farthest"),
        );
        worst.see(ours, case["output"].as_f64().expect("a number"));
    }
    worst.check();

    let mut positions_worst = Worst::new("lay_curl xyz", 1e-6);
    let mut normals_worst = Worst::new("lay_curl n", 1e-6);
    for case in cases("lay_curl") {
        let i = &case["input"];
        let curl = Curl {
            dx: n(&i["curl"], "dx"),
            dy: n(&i["curl"], "dy"),
            at: n(&i["curl"], "at"),
            radius: n(&i["curl"], "radius"),
        };
        let (columns, rows) = (n(i, "columns") as usize, n(i, "rows") as usize);
        let mut positions = vec![0.0f32; columns * rows * 3];
        let mut normals = vec![0.0f32; columns * rows * 3];
        lay_curl(
            shape(&i["shape"]),
            curl,
            columns,
            rows,
            &mut positions,
            &mut normals,
        );
        for (ours, web) in positions.iter().zip(floats(&case["output"]["positions"])) {
            positions_worst.see(f64::from(*ours), f64::from(web));
        }
        for (ours, web) in normals.iter().zip(floats(&case["output"]["normals"])) {
            normals_worst.see(f64::from(*ours), f64::from(web));
        }
    }
    positions_worst.check();
    normals_worst.check();
}
