use serde_json::{json, Value};

use super::{
    decode_runtime_bundle, encode_runtime_bundle, runtime_bundle_checksum, write_u32_at,
    write_u64_at, JS_NUMBER_MAX_SAFE_INTEGER, RUNTIME_BUNDLE_HEADER_BYTES, RUNTIME_BUNDLE_MAGIC,
    TAG_ARRAY, TAG_I64, TAG_OBJECT, TAG_U64,
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
fn reuses_scalar_value_records_without_changing_payload() {
    let value =
        json!([null, null, true, true, false, false, 7, 7, -2, -2, 3.25, 3.25, "repeat", "repeat"]);

    let bytes = encode_runtime_bundle(&value).expect("bundle encodes");
    let decoded = decode_runtime_bundle(&bytes).expect("bundle decodes");

    assert_eq!(decoded.payload, value);
    assert_eq!(decoded.value_count, 8);
}

#[test]
fn round_trips_deeply_nested_sibling_containers() {
    let mut value = json!({"leaf": ["alpha", "beta"]});
    for depth in 0_u64..64 {
        value = if depth.is_multiple_of(2) {
            json!([depth, value, {"sibling": [depth + 1, depth + 2]}])
        } else {
            json!({
                "depth": depth,
                "nested": value,
                "sibling": [{"value": depth}, [depth + 1]]
            })
        };
    }

    let bytes = encode_runtime_bundle(&value).expect("nested bundle encodes");
    let decoded = decode_runtime_bundle(&bytes).expect("nested bundle decodes");

    assert_eq!(decoded.payload, value);
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

#[test]
fn round_trips_js_number_safe_integer_boundaries() {
    let max = JS_NUMBER_MAX_SAFE_INTEGER as i64;
    let value = json!([-max, max]);

    let bytes = encode_runtime_bundle(&value).expect("safe integer boundaries encode");
    let value_offset = header_u32(&bytes, 36) as usize;
    assert_eq!(bytes[value_offset], TAG_I64);
    assert_eq!(bytes[value_offset + 9], TAG_U64);
    let decoded = decode_runtime_bundle(&bytes).expect("safe integer boundaries decode");

    assert_eq!(decoded.payload, value);

    let bytes = single_integer_bundle(TAG_U64, JS_NUMBER_MAX_SAFE_INTEGER.to_le_bytes());
    let decoded = decode_runtime_bundle(&bytes).expect("safe u64 boundary decodes");
    assert_eq!(decoded.payload, json!(JS_NUMBER_MAX_SAFE_INTEGER));
}

#[test]
fn matches_cross_language_golden_vector() {
    let value: Value =
        serde_json::from_str(include_str!("fixtures/ritorb1-v1.json")).expect("golden JSON parses");
    let expected_bytes = decode_hex(include_str!("fixtures/ritorb1-v1.hex"));

    let encoded = encode_runtime_bundle(&value).expect("golden JSON encodes");
    assert_eq!(encoded, expected_bytes, "RITORB1 golden bytes changed");

    let decoded = decode_runtime_bundle(&expected_bytes).expect("golden bytes decode");
    assert_eq!(decoded.payload, value);
    assert_eq!(decoded.byte_length, expected_bytes.len());
}

#[test]
fn encoder_rejects_integers_outside_js_number_safe_range() {
    let max = JS_NUMBER_MAX_SAFE_INTEGER as i64;
    let values = [json!(-max - 1), json!(max + 1), json!(u64::MAX)];

    for value in values {
        let error = encode_runtime_bundle(&value)
            .expect_err("unsafe integer must not encode")
            .to_string();
        assert!(error.contains("JS Number safe integer range"), "{error}");
    }
}

#[test]
fn decoder_rejects_integer_tags_outside_js_number_safe_range() {
    let max = JS_NUMBER_MAX_SAFE_INTEGER as i64;
    let cases = [
        single_integer_bundle(TAG_I64, (-max - 1).to_le_bytes()),
        single_integer_bundle(TAG_I64, (max + 1).to_le_bytes()),
        single_integer_bundle(TAG_U64, (JS_NUMBER_MAX_SAFE_INTEGER + 1).to_le_bytes()),
    ];

    for bytes in cases {
        let error = decode_runtime_bundle(&bytes)
            .expect_err("unsafe integer tag must not decode")
            .to_string();
        assert!(error.contains("JS Number safe integer range"), "{error}");
    }
}

#[test]
fn rejects_section_count_bombs_before_allocating() {
    let mut strings = encode_runtime_bundle(&json!("value")).expect("bundle encodes");
    write_u32_at(&mut strings, 20, u32::MAX);
    assert_decode_error(strings, "RITORB1 string count exceeds");

    let mut values = encode_runtime_bundle(&json!(null)).expect("bundle encodes");
    write_u32_at(&mut values, 24, u32::MAX);
    assert_decode_error(values, "RITORB1 value count exceeds");
}

#[test]
fn rejects_container_count_bombs_before_allocating() {
    let mut array = encode_runtime_bundle(&json!([null])).expect("array encodes");
    let value_offset = header_u32(&array, 36) as usize;
    assert_eq!(array[value_offset + 1], TAG_ARRAY);
    write_u32_at(&mut array, value_offset + 2, u32::MAX);
    refresh_checksum(&mut array);
    assert_decode_error(array, "RITORB1 array length exceeds");

    let mut object = encode_runtime_bundle(&json!({"key": null})).expect("object encodes");
    let value_offset = header_u32(&object, 36) as usize;
    assert_eq!(object[value_offset + 1], TAG_OBJECT);
    write_u32_at(&mut object, value_offset + 2, u32::MAX);
    refresh_checksum(&mut object);
    assert_decode_error(object, "RITORB1 object length exceeds");
}

fn single_integer_bundle(tag: u8, payload: [u8; 8]) -> Vec<u8> {
    let mut bytes = encode_runtime_bundle(&json!(0)).expect("integer bundle encodes");
    let value_offset = header_u32(&bytes, 36) as usize;
    bytes[value_offset] = tag;
    bytes[value_offset + 1..value_offset + 9].copy_from_slice(&payload);
    refresh_checksum(&mut bytes);
    bytes
}

fn header_u32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().expect("header field"))
}

fn refresh_checksum(bytes: &mut [u8]) {
    let checksum = runtime_bundle_checksum(&bytes[RUNTIME_BUNDLE_HEADER_BYTES..]);
    write_u64_at(bytes, 48, checksum);
}

fn assert_decode_error(bytes: Vec<u8>, expected: &str) {
    let error = decode_runtime_bundle(&bytes)
        .expect_err("malicious count must not decode")
        .to_string();
    assert!(error.contains(expected), "{error}");
}

fn decode_hex(source: &str) -> Vec<u8> {
    let compact: String = source
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect();
    assert!(
        compact.len().is_multiple_of(2),
        "golden hex has an odd length"
    );
    (0..compact.len())
        .step_by(2)
        .map(|offset| {
            u8::from_str_radix(&compact[offset..offset + 2], 16)
                .expect("golden hex contains only hexadecimal bytes")
        })
        .collect()
}
