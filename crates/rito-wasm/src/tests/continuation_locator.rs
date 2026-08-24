use rito_core::runtime::RuntimeResourceKind;
use serde_json::{json, Value};

use super::fixture::{fixture_document, layout, multi_chapter_document};
use crate::{WasmRuntimeDocument, WasmRuntimeErrorCode};

fn incremental_document() -> WasmRuntimeDocument {
    let mut loaded = multi_chapter_document();
    loaded.images = fixture_document().images;
    WasmRuntimeDocument::from_loaded_document(loaded)
}

fn start_bounded(document: &mut WasmRuntimeDocument) -> Value {
    parse(
        document
            .create_bounded_revision_json(
                &json!({
                    "layoutConfig": layout(),
                    "lineBreaking": "greedy",
                    "budget": { "maxTopLevelNodes": 1 }
                })
                .to_string(),
            )
            .expect("bounded revision starts"),
    )
}

fn continuation_request(initial: &Value, locator: Value) -> String {
    json!({
        "revisionId": initial["continuation"]["revisionId"],
        "revisionVersion": initial["continuation"]["revisionVersion"],
        "cursor": initial["continuation"]["cursor"],
        "budget": { "maxTopLevelNodes": 1 },
        "locator": locator,
    })
    .to_string()
}

#[test]
fn locator_continuation_releases_exact_transfers_and_returns_next_projection() {
    let mut document = incremental_document();
    let initial = start_bounded(&mut document);
    let transfer = parse(
        document
            .get_resource_payload_at_revision_json(
                "rev-1",
                0,
                RuntimeResourceKind::Image,
                "Images/cover.png",
            )
            .expect("current revision resource is leased"),
    );
    let transfer_id = transfer["value"]["transferId"]
        .as_str()
        .expect("transfer id")
        .to_owned();
    let locator = json!({ "href": "chapter-2.xhtml#" });
    let canonical_locator = json!({ "href": "chapter-2.xhtml" });

    let response = parse(
        document
            .continue_revision_toward_source_locator_json(&continuation_request(
                &initial,
                locator.clone(),
            ))
            .expect("locator continuation advances"),
    );

    assert_eq!(response["advance"]["revision"]["revisionVersion"], 1);
    assert_eq!(
        response["releasedRevision"],
        json!({ "revisionId": "rev-1", "revisionVersion": 0 })
    );
    assert_eq!(response["releasedTransferCount"], 1);
    assert_eq!(response["request"], locator);
    assert_eq!(response["canonicalRequest"], canonical_locator);
    assert_eq!(response["locatorOutcome"]["kind"], "resolved");
    assert_eq!(
        response["locatorOutcome"]["resolution"]["status"],
        "resolved"
    );
    assert_eq!(
        response["locatorOutcome"]["resolution"]["revisionId"],
        "rev-1"
    );
    assert_eq!(
        response["locatorOutcome"]["resolution"]["locator"],
        canonical_locator
    );
    assert!(document.read_resource_transfer(&transfer_id).is_err());
}

#[test]
fn locator_continuation_rejects_a_forged_cursor_without_releasing_transfers() {
    let mut document = incremental_document();
    let initial = start_bounded(&mut document);
    let transfer = parse(
        document
            .get_resource_payload_at_revision_json(
                "rev-1",
                0,
                RuntimeResourceKind::Image,
                "Images/cover.png",
            )
            .expect("current revision resource is leased"),
    );
    let transfer_id = transfer["value"]["transferId"]
        .as_str()
        .expect("transfer id")
        .to_owned();
    let mut request: Value = serde_json::from_str(&continuation_request(
        &initial,
        json!({ "href": "chapter-2.xhtml" }),
    ))
    .expect("continuation request parses");
    request["cursor"] = json!("forged-cursor");

    document
        .continue_revision_toward_source_locator_json(&request.to_string())
        .expect_err("forged cursor is rejected");

    assert!(document.read_resource_transfer(&transfer_id).is_ok());
    let current = parse(
        document
            .get_revision_summary_at_revision_json("rev-1", 0)
            .expect("rejected cursor keeps the current revision exact"),
    );
    assert_eq!(current["revision"]["revisionVersion"], 0);
    let continued = parse(
        document
            .continue_revision_json(
                &json!({
                    "revisionId": initial["continuation"]["revisionId"],
                    "revisionVersion": initial["continuation"]["revisionVersion"],
                    "cursor": initial["continuation"]["cursor"],
                    "budget": { "maxTopLevelNodes": 1 }
                })
                .to_string(),
            )
            .expect("forged cursor did not consume the real cursor"),
    );
    assert_eq!(continued["revision"]["revisionVersion"], 1);
}

#[test]
fn locator_continuation_preflight_rejects_without_release_or_revision_advance() {
    let mut document = incremental_document();
    let initial = start_bounded(&mut document);
    let transfer = parse(
        document
            .get_resource_payload_at_revision_json(
                "rev-1",
                0,
                RuntimeResourceKind::Image,
                "Images/cover.png",
            )
            .expect("current revision resource is leased"),
    );
    let transfer_id = transfer["value"]["transferId"]
        .as_str()
        .expect("transfer id");

    let error = document
        .continue_revision_toward_source_locator_json(&continuation_request(
            &initial,
            json!({ "href": "chapter-1.xhtml" }),
        ))
        .expect_err("already resolved locator is rejected");

    assert_eq!(error.code(), WasmRuntimeErrorCode::BadRequest);
    assert!(document.read_resource_transfer(transfer_id).is_ok());
    let current = parse(
        document
            .get_revision_summary_at_revision_json("rev-1", 0)
            .expect("preflight keeps the current revision exact"),
    );
    assert_eq!(current["revision"]["revisionVersion"], 0);
    let continued = parse(
        document
            .continue_revision_json(
                &json!({
                    "revisionId": initial["continuation"]["revisionId"],
                    "revisionVersion": initial["continuation"]["revisionVersion"],
                    "cursor": initial["continuation"]["cursor"],
                    "budget": { "maxTopLevelNodes": 1 }
                })
                .to_string(),
            )
            .expect("preflight did not consume the cursor"),
    );
    assert_eq!(continued["revision"]["revisionVersion"], 1);
}

fn parse(response: String) -> Value {
    serde_json::from_str(&response).expect("response JSON parses")
}
