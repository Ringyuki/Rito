use js_sys::{Array, Uint8Array};
use wasm_bindgen::{prelude::*, JsCast};

use super::{error_to_js_value, RitoWasmDocument};
use crate::{
    pinned_font::validate_pinned_font_policy_metadata, WasmRuntimeDocument, WasmRuntimeError,
};

#[wasm_bindgen(js_class = RitoWasmDocument)]
impl RitoWasmDocument {
    #[wasm_bindgen(js_name = openWithPinnedFontPolicy)]
    pub fn open_with_pinned_font_policy(
        bytes: Vec<u8>,
        metadata_json: &str,
        face_bytes: JsValue,
    ) -> Result<RitoWasmDocument, JsValue> {
        let face_bytes = require_face_byte_array(face_bytes).map_err(error_to_js_value)?;
        let metadata =
            validate_pinned_font_policy_metadata(metadata_json, face_bytes.length() as usize)
                .map_err(error_to_js_value)?;
        validate_face_byte_array_types(&face_bytes).map_err(error_to_js_value)?;
        let face_bytes = copy_face_byte_arrays(&face_bytes);
        WasmRuntimeDocument::open_with_validated_pinned_font_policy(bytes, metadata, face_bytes)
            .map(|inner| Self { inner })
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = pinnedFontPolicyJson)]
    pub fn pinned_font_policy_json(&self) -> Result<String, JsValue> {
        self.inner
            .pinned_font_policy_json()
            .map_err(error_to_js_value)
    }
}

pub(crate) fn require_face_byte_array(value: JsValue) -> Result<Array, WasmRuntimeError> {
    if !Array::is_array(&value) {
        return Err(WasmRuntimeError::bad_request(
            "pinned font face bytes must be an array of Uint8Array values",
        ));
    }
    Ok(Array::from(&value))
}

pub(crate) fn validate_face_byte_array_types(values: &Array) -> Result<(), WasmRuntimeError> {
    for (index, value) in values.iter().enumerate() {
        if !value.is_instance_of::<Uint8Array>() {
            return Err(WasmRuntimeError::bad_request(format!(
                "pinned font face bytes at index {index} must be a Uint8Array"
            )));
        }
        if Uint8Array::new(&value).length() == 0 {
            return Err(WasmRuntimeError::bad_request(format!(
                "pinned font face bytes at index {index} must not be empty"
            )));
        }
    }
    Ok(())
}

pub(crate) fn copy_face_byte_arrays(values: &Array) -> Vec<Vec<u8>> {
    values
        .iter()
        .map(|value| Uint8Array::new(&value).to_vec())
        .collect()
}
