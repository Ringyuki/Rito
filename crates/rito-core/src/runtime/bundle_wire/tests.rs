use serde_json::json;

use super::{
    decode_runtime_bundle, encode_runtime_bundle, RUNTIME_BUNDLE_HEADER_BYTES, RUNTIME_BUNDLE_MAGIC,
};

#[test]
fn round_trips_runtime_bundle_values() {
    let value = json!({
        "kind": "preview",
        "display": "visualPreview",
        "result": {
            "revision": {"revisionId": "rev-1", "pageCount": 2},
            "numbers": [1, -2, 3.25],
            "flags": [true, false, null]
        }
    });

    let bytes = encode_runtime_bundle(&value).expect("bundle encodes");
    let decoded = decode_runtime_bundle(&bytes).expect("bundle decodes");

    assert_eq!(&bytes[0..8], RUNTIME_BUNDLE_MAGIC);
    assert!(bytes.len() > RUNTIME_BUNDLE_HEADER_BYTES);
    assert_eq!(decoded.payload, value);
    assert!(decoded.string_count > 0);
    assert!(decoded.value_count > 0);
}

#[test]
fn rejects_malformed_runtime_bundle_bytes() {
    let mut bytes = encode_runtime_bundle(&json!({"ok": true})).expect("bundle encodes");
    bytes[0] = b'X';
    assert!(decode_runtime_bundle(&bytes)
        .expect_err("bad magic fails")
        .to_string()
        .contains("invalid RITORB1 magic"));

    let mut bytes = encode_runtime_bundle(&json!({"ok": true})).expect("bundle encodes");
    let last = bytes.len() - 1;
    bytes[last] ^= 0xff;
    assert!(decode_runtime_bundle(&bytes)
        .expect_err("bad checksum fails")
        .to_string()
        .contains("checksum mismatch"));
}
