use rito_core::{layout::TextMeasurementMode, runtime::RuntimeResourceKind};
use serde_json::{json, Value};

use super::fixture::{fixture_document, layout};
use crate::{WasmRuntimeDocument, WasmRuntimeErrorCode};

#[test]
fn raw_calibration_rotates_revision_and_releases_only_old_exact_transfers() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());
    let mut config = layout();
    config.text_measurement = TextMeasurementMode::FontAware;
    let created = parse(
        document
            .create_full_revision_bundle_json(
                &json!({
                    "layoutConfig": config,
                    "activeSpreadIndex": 0,
                })
                .to_string(),
            )
            .expect("font-aware revision is created"),
    );
    let revision = created["bundle"]["revision"].clone();
    let revision_id = revision["revisionId"]
        .as_str()
        .expect("revision id")
        .to_owned();
    document
        .release_revision_transfers_at_revision_json(&revision_id, 0)
        .expect("initial frame transfers clear");
    let transfer = parse(
        document
            .get_resource_payload_at_revision_json(
                &revision_id,
                0,
                RuntimeResourceKind::Image,
                "Images/cover.png",
            )
            .expect("old exact revision resource is leased"),
    );
    let transfer_id = transfer["value"]["transferId"]
        .as_str()
        .expect("transfer id")
        .to_owned();
    let presentation = parse(
        document
            .get_revision_presentation_at_revision_json(&revision_id, 0)
            .expect("font demands resolve"),
    );
    let samples = samples(&presentation["value"]["fontVerticalMetricDemands"]);

    let calibrated = parse(
        document
            .calibrate_revision_font_vertical_metrics_json(
                &json!({
                    "revisionId": revision_id,
                    "revisionVersion": 0,
                    "fontVerticalMetrics": samples,
                })
                .to_string(),
            )
            .expect("raw calibration succeeds"),
    );

    assert_eq!(calibrated["revision"]["revisionVersion"], 1);
    assert_eq!(calibrated["revision"]["layoutKey"], revision["layoutKey"]);
    assert_eq!(
        calibrated["revision"]["knownExtent"],
        revision["knownExtent"]
    );
    assert_eq!(
        calibrated["revision"]["finalExtent"],
        revision["finalExtent"]
    );
    assert_eq!(calibrated["revision"]["status"], revision["status"]);
    assert_eq!(calibrated["revision"]["pageCount"], revision["pageCount"]);
    assert_eq!(
        calibrated["revision"]["spreadCount"],
        revision["spreadCount"]
    );
    assert_eq!(
        calibrated["releasedRevision"],
        json!({ "revisionId": "rev-1", "revisionVersion": 0 })
    );
    assert_eq!(calibrated["releasedTransferCount"], 1);
    assert!(calibrated["calibratedPublishedRunCount"]
        .as_u64()
        .is_some_and(|count| count > 0));
    assert_eq!(calibrated["calibratedUnpublishedRunCount"], 0);
    assert!(document.read_resource_transfer(&transfer_id).is_err());
    let stale = document
        .get_revision_presentation_at_revision_json("rev-1", 0)
        .expect_err("old revision handle is stale");
    assert_eq!(stale.code(), WasmRuntimeErrorCode::StaleRevisionVersion);
    let current = parse(
        document
            .get_revision_presentation_at_revision_json("rev-1", 1)
            .expect("new exact presentation resolves"),
    );
    assert!(current["value"].get("fontVerticalMetricDemands").is_none());
}

#[test]
fn rejected_raw_calibration_preserves_revision_and_transfer_ownership() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());
    let mut config = layout();
    config.text_measurement = TextMeasurementMode::FontAware;
    document
        .create_full_revision_bundle_json(
            &json!({
                "layoutConfig": config,
                "activeSpreadIndex": 0,
            })
            .to_string(),
        )
        .expect("font-aware revision is created");
    document
        .release_revision_transfers_at_revision_json("rev-1", 0)
        .expect("initial frame transfers clear");
    let transfer = parse(
        document
            .get_resource_payload_at_revision_json(
                "rev-1",
                0,
                RuntimeResourceKind::Image,
                "Images/cover.png",
            )
            .expect("old exact revision resource is leased"),
    );
    let transfer_id = transfer["value"]["transferId"]
        .as_str()
        .expect("transfer id");

    let error = document
        .calibrate_revision_font_vertical_metrics_json(
            &json!({
                "revisionId": "rev-1",
                "revisionVersion": 0,
                "fontVerticalMetrics": [{
                    "fontFamily": "serif",
                    "fontStyle": "normal",
                    "fontWeight": 400,
                    "fontSizePx": 16.0,
                    "topBaselineAscentPx": -1.0,
                    "topBaselineDescentPx": 4.0,
                }],
            })
            .to_string(),
        )
        .expect_err("invalid calibration is rejected");

    assert_eq!(error.code(), WasmRuntimeErrorCode::EngineError);
    assert!(document.read_resource_transfer(transfer_id).is_ok());
    let current = parse(
        document
            .get_revision_summary_at_revision_json("rev-1", 0)
            .expect("failed mutation keeps version zero"),
    );
    assert_eq!(current["revision"]["revisionVersion"], 0);
}

fn samples(demands: &Value) -> Vec<Value> {
    demands
        .as_array()
        .expect("font demands are present")
        .iter()
        .map(|demand| {
            let size = demand["fontSizePx"].as_f64().expect("font size");
            json!({
                "fontFamily": demand["fontFamily"],
                "fontStyle": demand["fontStyle"],
                "fontWeight": demand["fontWeight"],
                "fontSizePx": size,
                "topBaselineAscentPx": size * 0.3,
                "topBaselineDescentPx": size * 0.2,
            })
        })
        .collect()
}

fn parse(response: String) -> Value {
    serde_json::from_str(&response).expect("response JSON parses")
}
