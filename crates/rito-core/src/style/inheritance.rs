use serde_json::{json, Map, Value};

const NON_INHERITED_AUXILIARY_KEYS: &[&str] = &[
    "backgroundImage",
    "backgroundPosition",
    "backgroundRepeat",
    "backgroundSize",
    "borderRadiusPct",
    "marginBottomPct",
    "marginLeftPct",
    "marginRightPct",
    "marginTopPct",
    "maxWidthPct",
    "paddingBottomPct",
    "paddingLeftPct",
    "paddingRightPct",
    "paddingTopPct",
    "widthPct",
];

pub(crate) fn inheritable_style(style: &Map<String, Value>) -> Map<String, Value> {
    let mut inherited = style.clone();
    let defaults = non_inherited_defaults();
    for (key, value) in defaults {
        inherited.insert(key, value);
    }
    for key in NON_INHERITED_AUXILIARY_KEYS {
        inherited.remove(*key);
    }
    inherited
}

fn non_inherited_defaults() -> Map<String, Value> {
    json!({
        "backgroundColor": "",
        "borderBottom": { "color": "#000000", "style": "none", "width": 0 },
        "borderLeft": { "color": "#000000", "style": "none", "width": 0 },
        "borderRadius": 0,
        "borderRight": { "color": "#000000", "style": "none", "width": 0 },
        "borderTop": { "color": "#000000", "style": "none", "width": 0 },
        "boxShadow": [],
        "boxSizing": "content-box",
        "bottom": 0,
        "clear": "none",
        "display": "block",
        "float": "none",
        "height": 0,
        "left": 0,
        "marginBottom": 0,
        "marginLeft": 0,
        "marginLeftAuto": false,
        "marginRight": 0,
        "marginRightAuto": false,
        "marginTop": 0,
        "maxWidth": 0,
        "objectFit": "fill",
        "opacity": 1,
        "overflow": "visible",
        "paddingBottom": 0,
        "paddingLeft": 0,
        "paddingRight": 0,
        "paddingTop": 0,
        "pageBreakAfter": "auto",
        "pageBreakBefore": "auto",
        "position": "static",
        "right": 0,
        "top": 0,
        "transform": [],
        "verticalAlign": "baseline",
        "width": 0
    })
    .as_object()
    .expect("non-inherited defaults are an object")
    .clone()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::inheritable_style;

    #[test]
    fn resets_non_inherited_values_and_preserves_inherited_values() {
        let style = json!({
            "color": "#123456",
            "display": "inline",
            "marginTopPct": 25,
            "textAlign": "center"
        });
        let inherited = inheritable_style(style.as_object().expect("style is an object"));

        assert_eq!(inherited.get("color"), Some(&json!("#123456")));
        assert_eq!(inherited.get("textAlign"), Some(&json!("center")));
        assert_eq!(inherited.get("display"), Some(&json!("block")));
        assert!(!inherited.contains_key("marginTopPct"));
    }
}
