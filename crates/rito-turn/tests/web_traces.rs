//! The paper model replayed over turns recorded from the web's paper turn
//! when it moved here (`fixtures/web-traces.json`, recorded from the
//! TypeScript it replaced, with a recording renderer and a scripted clock;
//! `RITO_TURN_TRACES` names a fuller recording to replay instead). What is
//! decided must be decided alike; what is computed must agree far below a
//! pixel.

use std::collections::HashMap;

use rito_turn::frame::{Frame, Incoming, PageRef, Phase, Scene, Touch};
use rito_turn::hold::Point;
use rito_turn::physics::{lands, Release};
use rito_turn::sheets::Face;
use rito_turn::{Begun, LeafId, PaperModel};
use serde_json::Value;

fn n(value: &Value, key: &str) -> f64 {
    value[key]
        .as_f64()
        .unwrap_or_else(|| panic!("{key} is a number in {value}"))
}

fn point(value: &Value) -> Point {
    Point {
        x: n(value, "x"),
        y: n(value, "y"),
    }
}

fn touch(value: &Value) -> Option<Touch> {
    if value.is_null() {
        return None;
    }
    Some(Touch {
        origin: point(&value["origin"]),
        position: point(&value["position"]),
        farthest: (!value["farthest"].is_null()).then(|| point(&value["farthest"])),
    })
}

fn frame(value: &Value) -> Frame {
    Frame {
        dx: n(value, "dx"),
        incoming: match value["incoming"].as_str() {
            Some("next") => Some(Incoming::Next),
            Some("prev") => Some(Incoming::Prev),
            _ => None,
        },
        phase: match value["phase"].as_str() {
            Some("held") => Phase::Held,
            Some("landing") => Phase::Landing,
            _ => Phase::Returning,
        },
        touch: touch(&value["touch"]),
    }
}

fn page(spread: i64) -> PageRef {
    PageRef {
        spread,
        content: (1000 + spread) as u64,
    }
}

struct Close {
    what: String,
    worst: f64,
}

impl Close {
    fn see(&mut self, ours: f64, web: f64, tolerance: f64, at: &str) {
        let difference = if ours == web {
            0.0
        } else {
            (ours - web).abs() / web.abs().max(1.0)
        };
        self.worst = self.worst.max(difference);
        assert!(
            difference <= tolerance,
            "{}: {at}: {ours} against the web's {web}",
            self.what
        );
    }
}

#[test]
fn the_model_turns_as_the_web_does() {
    let recorded = match std::env::var("RITO_TURN_TRACES") {
        Ok(path) => std::fs::read_to_string(path).expect("traces"),
        Err(_) => include_str!("fixtures/web-traces.json").to_owned(),
    };
    let recorded: Value = serde_json::from_str(&recorded).expect("json");
    let positions_stride = n(&recorded, "positionsStride") as usize;
    let normals_stride = n(&recorded, "normalsStride") as usize;
    let traces = &recorded["traces"];
    let mut close = Close {
        what: String::new(),
        worst: 0.0,
    };
    for trace in traces.as_array().expect("traces") {
        let name = trace["name"].as_str().expect("a name");
        close.what = name.to_owned();
        let layout = &trace["layout"];
        let scene = Scene {
            width: n(layout, "width"),
            height: n(layout, "height"),
            spine: n(layout, "spine"),
            css_pixel: n(layout, "cssPixel"),
        };
        let mut model = PaperModel::new();
        let mut shows: HashMap<LeafId, (Option<i64>, Option<i64>)> = HashMap::new();
        let mut settle = None;
        let mut frames = 0;
        for (index, record) in trace["frames"]
            .as_array()
            .expect("frames")
            .iter()
            .enumerate()
        {
            let at = format!("record {index}");
            if let Some(case) = record.get("lands") {
                let r = &case["release"];
                let release = Release {
                    dx: n(r, "dx"),
                    from: n(r, "from"),
                    velocity: n(r, "velocity"),
                    width: n(r, "width"),
                    forward: r["direction"] == "forward",
                    touch: touch(&r["touch"]),
                    spine: r["spine"].as_f64(),
                };
                assert_eq!(
                    lands(&release),
                    case["answer"].as_bool().expect("a bool"),
                    "{name}: {at}: lands"
                );
                continue;
            }
            if let Some(from) = record.get("settleFrom") {
                settle = Some(model.settle(n(from, "from"), n(from, "velocity"), n(from, "to")));
                continue;
            }
            frames += 1;
            let now = n(record, "now");
            if let (Some(settle), Some(web)) = (settle.as_mut(), record.get("settle")) {
                let ours = model.settle_step(settle, n(web, "seconds"), now);
                close.see(ours.x, n(&web["at"], "x"), 1e-9, &format!("{at} settle x"));
                assert_eq!(
                    ours.done,
                    web["at"]["done"].as_bool().expect("a bool"),
                    "{name}: {at}: settle done"
                );
            }
            let spread = record["spread"].as_i64().expect("a spread");
            let incoming = record["incoming"].as_i64().map(page);
            let begun = model.begin(
                scene,
                frame(&record["frame"]),
                Some(page(spread)),
                incoming,
                now,
                0,
            );
            let out = &record["out"];
            match begun {
                Begun::Shown { dx, forgotten } => {
                    for leaf in forgotten.leaves {
                        shows.remove(&leaf);
                    }
                    assert_eq!(
                        dx,
                        n(out, "shown"),
                        "{name}: {at}: drawn where the turn has it"
                    );
                }
                Begun::Turn { forgotten, .. } => {
                    for leaf in forgotten.leaves {
                        shows.remove(&leaf);
                    }
                    let laid = model.lay(0).expect("a frame waits");
                    for leaf in &laid.left_book {
                        shows.remove(leaf);
                    }
                    shows.insert(
                        laid.led,
                        (laid.front.map(|p| p.spread), laid.after.map(|p| p.spread)),
                    );
                    let web = out["sheets"].as_array().expect("sheets");
                    let sheets = model.sheets();
                    assert_eq!(sheets.len(), web.len(), "{name}: {at}: sheets");
                    let face = |face: Face| match face {
                        Face::None => None,
                        Face::Front(id) => shows.get(&id).and_then(|s| s.0),
                        Face::After(id) => shows.get(&id).and_then(|s| s.1),
                    };
                    for (k, (ours, web)) in sheets.iter().zip(web).enumerate() {
                        let at = format!("{at} sheet {k}");
                        assert_eq!(
                            face(ours.front),
                            web["front"].as_i64(),
                            "{name}: {at}: front"
                        );
                        assert_eq!(face(ours.back), web["back"].as_i64(), "{name}: {at}: back");
                        assert_eq!(
                            ours.still,
                            web["still"].as_bool().expect("a bool"),
                            "{name}: {at}: still"
                        );
                        close.see(ours.shown, n(web, "shown"), 1e-6, &format!("{at} shown"));
                        match (ours.curl, web["curl"].is_null()) {
                            (None, true) => {}
                            (Some(curl), false) => {
                                for (value, key) in [
                                    (curl.dx, "dx"),
                                    (curl.dy, "dy"),
                                    (curl.at, "at"),
                                    (curl.radius, "radius"),
                                ] {
                                    close.see(
                                        value,
                                        n(&web["curl"], key),
                                        1e-6,
                                        &format!("{at} curl {key}"),
                                    );
                                }
                            }
                            _ => panic!("{name}: {at}: a curl on one side only"),
                        }
                        let sum: f64 = ours.positions.iter().map(|v| f64::from(*v)).sum();
                        close.see(
                            sum / ours.positions.len() as f64,
                            n(web, "sum") / ours.positions.len() as f64,
                            1e-6,
                            &format!("{at} positions"),
                        );
                        for (i, value) in web["sample"]
                            .as_array()
                            .expect("a sample")
                            .iter()
                            .enumerate()
                        {
                            let web = value.as_f64().expect("a number");
                            let ours = f64::from(ours.positions[i * positions_stride]);
                            assert!(
                                (ours - web).abs() <= 1e-2,
                                "{name}: {at}: position {} {ours} against {web}",
                                i * 97
                            );
                        }
                        for (i, value) in web["nsample"]
                            .as_array()
                            .expect("a sample")
                            .iter()
                            .enumerate()
                        {
                            let web = value.as_f64().expect("a number");
                            let ours = f64::from(ours.normals[i * normals_stride]);
                            assert!(
                                (ours - web).abs() <= 1e-4,
                                "{name}: {at}: normal {} {ours} against {web}",
                                i * 89
                            );
                        }
                    }
                }
            }
            assert_eq!(
                model.gone(),
                record["there"]["gone"].as_bool().expect("a bool"),
                "{name}: {at}: gone"
            );
        }
        println!("{name:<34} {frames} frames, worst {:.2e}", close.worst);
        close.worst = 0.0;
    }
}
