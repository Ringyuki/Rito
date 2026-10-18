use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::{
    epub::{EpubError, EpubResult},
    layout::{LayoutConfig, SpreadMode},
    runtime::pinned_font_policy::RuntimePinnedFontPolicy,
};

pub(super) fn layout_key(
    layout_config: &LayoutConfig,
    pinned_font_policy: &RuntimePinnedFontPolicy,
) -> EpubResult<String> {
    let policy_identity = (!pinned_font_policy.is_empty()).then(|| pinned_font_policy.identity());
    layout_key_from_policy_identity(layout_config, policy_identity)
}

fn layout_key_from_policy_identity(
    layout_config: &LayoutConfig,
    policy_identity: Option<&[u8]>,
) -> EpubResult<String> {
    let identity = LayoutKeyConfig::from(layout_config);
    let Some(policy_identity) = policy_identity else {
        let mut hasher = Sha256::new();
        serde_json::to_writer(&mut hasher, &identity).map_err(layout_serialization_error)?;
        return Ok(short_sha256_digest(&hasher.finalize()));
    };
    let json = serde_json::to_vec(&identity).map_err(layout_serialization_error)?;
    let mut hasher = Sha256::new();
    hasher.update(b"RITO-RUNTIME-LAYOUT-IDENTITY\0");
    hasher.update((json.len() as u64).to_be_bytes());
    hasher.update(&json);
    hasher.update(policy_identity);
    Ok(short_sha256_digest(&hasher.finalize()))
}

/// Pagination identity excludes browser-calibrated vertical interaction boxes.
/// They affect caret/range geometry, never line breaking, page geometry, or paint.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LayoutKeyConfig<'a> {
    viewport_width: f64,
    viewport_height: f64,
    page_width: f64,
    page_height: f64,
    margin_top: f64,
    margin_right: f64,
    margin_bottom: f64,
    margin_left: f64,
    spread_mode: SpreadMode,
    first_page_alone: bool,
    spread_gap: f64,
    root_font_size: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    line_height_override: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    line_height_force: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    font_family_override: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    font_family_force: Option<bool>,
}

impl<'a> From<&'a LayoutConfig> for LayoutKeyConfig<'a> {
    fn from(config: &'a LayoutConfig) -> Self {
        Self {
            viewport_width: config.viewport_width,
            viewport_height: config.viewport_height,
            page_width: config.page_width,
            page_height: config.page_height,
            margin_top: config.margin_top,
            margin_right: config.margin_right,
            margin_bottom: config.margin_bottom,
            margin_left: config.margin_left,
            spread_mode: config.spread_mode,
            first_page_alone: config.first_page_alone,
            spread_gap: config.spread_gap,
            root_font_size: config.root_font_size,
            line_height_override: config.line_height_override,
            line_height_force: config.line_height_force,
            font_family_override: config.font_family_override.as_deref(),
            font_family_force: config.font_family_force,
        }
    }
}

fn layout_serialization_error(error: serde_json::Error) -> EpubError {
    EpubError::new(format!("layout config does not serialize: {error}"))
}

fn short_sha256_digest(digest: &[u8]) -> String {
    digest
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use crate::layout::{create_layout_config, LayoutConfigInput, MarginInput, SpreadMode};

    use super::*;

    #[test]
    fn streamed_layout_keys_match_the_buffered_reference() {
        let mut rich = test_layout();
        rich.line_height_override = Some(1.125);
        rich.line_height_force = Some(true);
        rich.font_family_override = Some("雪 \\\"quoted\\\" \\\\ family".to_owned());
        rich.font_family_force = Some(false);

        for layout_config in [test_layout(), rich] {
            for policy_identity in [None, Some(&b""[..]), Some(&b"pinned\0policy\xff"[..])] {
                assert_eq!(
                    layout_key_from_policy_identity(&layout_config, policy_identity)
                        .expect("streamed layout key succeeds"),
                    buffered_layout_key(&layout_config, policy_identity)
                        .expect("buffered layout key succeeds")
                );
            }
        }
    }

    #[test]
    fn layout_key_byte_contract_has_fixed_goldens() {
        let layout_config = test_layout();

        assert_eq!(
            (
                layout_key_from_policy_identity(&layout_config, None)
                    .expect("empty-policy key succeeds"),
                layout_key_from_policy_identity(&layout_config, Some(b"pinned-policy-identity"),)
                    .expect("pinned-policy key succeeds"),
            ),
            ("bf4b78407bf7a2d3".to_owned(), "851328446b8fd5ef".to_owned(),)
        );
    }

    fn buffered_layout_key(
        layout_config: &LayoutConfig,
        policy_identity: Option<&[u8]>,
    ) -> EpubResult<String> {
        let json = serde_json::to_vec(&LayoutKeyConfig::from(layout_config))
            .map_err(layout_serialization_error)?;
        let Some(policy_identity) = policy_identity else {
            return Ok(short_sha256(&json));
        };
        let mut identity = Vec::new();
        identity.extend_from_slice(b"RITO-RUNTIME-LAYOUT-IDENTITY\0");
        identity.extend_from_slice(&(json.len() as u64).to_be_bytes());
        identity.extend_from_slice(&json);
        identity.extend_from_slice(policy_identity);
        Ok(short_sha256(&identity))
    }

    fn short_sha256(bytes: &[u8]) -> String {
        short_sha256_digest(&Sha256::digest(bytes))
    }

    fn test_layout() -> LayoutConfig {
        create_layout_config(LayoutConfigInput {
            width: 420.0,
            height: 640.0,
            margin: MarginInput::All(24.0),
            spread: SpreadMode::Single,
            first_page_alone: true,
            spread_gap: 0.0,
            root_font_size: 16.0,
            line_height_override: None,
            line_height_force: None,
            font_family_override: None,
            font_family_force: None,
            device_pixel_ratio: 1.0,
        })
    }
}
