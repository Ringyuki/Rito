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

    /// Opens a publication from its skeleton shard (see `rito-pack`);
    /// `key` is the skeleton's 32-byte key when the shards are encrypted.
    /// A later call that needs a content shard not yet supplied fails with
    /// code `resource-pending` and the shard ids in `pendingShards`.
    #[wasm_bindgen(js_name = openShardsWithPinnedFontPolicy)]
    pub fn open_shards_with_pinned_font_policy(
        skeleton: Vec<u8>,
        key: Option<Vec<u8>>,
        metadata_json: &str,
        face_bytes: JsValue,
    ) -> Result<RitoWasmDocument, JsValue> {
        let face_bytes = require_face_byte_array(face_bytes).map_err(error_to_js_value)?;
        let metadata =
            validate_pinned_font_policy_metadata(metadata_json, face_bytes.length() as usize)
                .map_err(error_to_js_value)?;
        validate_face_byte_array_types(&face_bytes).map_err(error_to_js_value)?;
        let face_bytes = copy_face_byte_arrays(&face_bytes);
        WasmRuntimeDocument::open_shards_with_validated_pinned_font_policy(
            &skeleton,
            key.as_deref(),
            metadata,
            face_bytes,
        )
        .map(|inner| Self { inner })
        .map_err(error_to_js_value)
    }

    /// Hands the document one content shard; returns its id.
    #[wasm_bindgen(js_name = supplyShard)]
    pub fn supply_shard(&mut self, shard: Vec<u8>, key: Option<Vec<u8>>) -> Result<u32, JsValue> {
        self.inner
            .supply_shard(&shard, key.as_deref())
            .map_err(error_to_js_value)
    }

    /// Every content shard, those the chapter at `href` draws first, then
    /// those of the chapters around it by reading distance.
    #[wasm_bindgen(js_name = contentShardsNear)]
    pub fn content_shards_near(&self, href: String) -> Vec<u32> {
        self.inner.content_shards_near(&href)
    }

    #[wasm_bindgen(js_name = pinnedFontPolicyJson)]
    pub fn pinned_font_policy_json(&self) -> Result<String, JsValue> {
        self.inner
            .pinned_font_policy_json()
            .map_err(error_to_js_value)
    }

    /// Every family a `font-family` list can name, as JSON.
    #[wasm_bindgen(js_name = fontCatalogJson)]
    pub fn font_catalog_json(&self) -> Result<String, JsValue> {
        self.inner.font_catalog_json().map_err(error_to_js_value)
    }

    /// The names in a CSS `font-family` list no family answers to, as a
    /// JSON array.
    #[wasm_bindgen(js_name = unresolvedFontFamiliesJson)]
    pub fn unresolved_font_families_json(&self, family_list: &str) -> Result<String, JsValue> {
        self.inner
            .unresolved_font_families_json(family_list)
            .map_err(error_to_js_value)
    }

    /// Adds host faces (`metadata_json` and `face_bytes` as for
    /// `openWithPinnedFontPolicy`, a face may share its role and language
    /// with another); returns the extended policy summary JSON.
    #[wasm_bindgen(js_name = addHostFontFaces)]
    pub fn add_host_font_faces(
        &mut self,
        metadata_json: &str,
        face_bytes: JsValue,
    ) -> Result<String, JsValue> {
        let (metadata, faces) =
            added_font_faces(metadata_json, face_bytes).map_err(error_to_js_value)?;
        self.inner
            .add_host_font_faces(metadata, faces)
            .map_err(error_to_js_value)
    }

    /// Removes host faces by the SHA-256 digests in a JSON array; returns
    /// the remaining policy summary JSON.
    #[wasm_bindgen(js_name = removeHostFontFacesJson)]
    pub fn remove_host_font_faces_json(&mut self, sha256s_json: &str) -> Result<String, JsValue> {
        self.inner
            .remove_host_font_faces_json(sha256s_json)
            .map_err(error_to_js_value)
    }
}

/// Validates added host faces' metadata against their byte arrays and
/// copies the bytes out of JavaScript.
pub(crate) fn added_font_faces(
    metadata_json: &str,
    face_bytes: JsValue,
) -> Result<
    (
        crate::pinned_font::ValidatedPinnedFontPolicyMetadata,
        Vec<Vec<u8>>,
    ),
    WasmRuntimeError,
> {
    let face_bytes = require_face_byte_array(face_bytes)?;
    let metadata = crate::pinned_font::validate_added_font_faces_metadata(
        metadata_json,
        face_bytes.length() as usize,
    )?;
    validate_face_byte_array_types(&face_bytes)?;
    Ok((metadata, copy_face_byte_arrays(&face_bytes)))
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
