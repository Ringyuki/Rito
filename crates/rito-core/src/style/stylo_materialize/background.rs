use rito_style_contract::{
    BackgroundImagePaintV1, BackgroundImageRepeatV1, BackgroundImageSizeV1, LengthPercentage,
};
use serde_json::{json, Map, Value};

const PUBLICATION_URL_PREFIX: &str = "https://rito.invalid/publication/";
const MATERIALIZED_BACKGROUND_IMAGE_FIELDS: [&str; 4] = [
    "backgroundImage",
    "backgroundRepeat",
    "backgroundSize",
    "backgroundPosition",
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum BackgroundMaterializeError {
    NonPublicationUrl,
    EmptyPublicationHref,
    LinearPosition,
}

pub(super) fn materialize_background_image(
    output: &mut Map<String, Value>,
    image: Option<&BackgroundImagePaintV1>,
) -> Result<(), BackgroundMaterializeError> {
    let Some(image) = image else {
        return Ok(());
    };
    let href = publication_href(image.url.as_str())?;
    output.insert("backgroundImage".to_owned(), Value::String(href.to_owned()));
    output.insert(
        "backgroundRepeat".to_owned(),
        Value::String(background_repeat(image.repeat).to_owned()),
    );
    output.insert("backgroundSize".to_owned(), background_size(image.size));
    output.insert(
        "backgroundPosition".to_owned(),
        json!({
            "x": position_axis(image.position.x)?,
            "y": position_axis(image.position.y)?,
        }),
    );
    Ok(())
}

/// Copies the already-validated, coupled body background-image fields into
/// page paint. The materializer above is the only producer of this cluster,
/// so a URL is never separated from its repeat, size, or position semantics.
pub(super) fn copy_materialized_background_image(
    output: &mut Map<String, Value>,
    materialized_style: &Map<String, Value>,
) {
    if materialized_style
        .get("backgroundImage")
        .and_then(Value::as_str)
        .is_none_or(str::is_empty)
    {
        return;
    }
    for field in MATERIALIZED_BACKGROUND_IMAGE_FIELDS {
        if let Some(value) = materialized_style.get(field) {
            output.insert(field.to_owned(), value.clone());
        }
    }
}

pub(crate) fn publication_href(url: &str) -> Result<&str, BackgroundMaterializeError> {
    let href = url
        .strip_prefix(PUBLICATION_URL_PREFIX)
        .ok_or(BackgroundMaterializeError::NonPublicationUrl)?;
    if href.is_empty() || href.starts_with('?') || href.starts_with('#') || href.starts_with('/') {
        return Err(BackgroundMaterializeError::EmptyPublicationHref);
    }
    Ok(href)
}

pub(crate) fn background_repeat(value: BackgroundImageRepeatV1) -> &'static str {
    match value {
        BackgroundImageRepeatV1::Repeat => "repeat",
        BackgroundImageRepeatV1::NoRepeat => "no-repeat",
    }
}

pub(crate) fn background_size(value: BackgroundImageSizeV1) -> Value {
    match value {
        BackgroundImageSizeV1::Auto => json!("auto"),
        BackgroundImageSizeV1::Cover => json!("cover"),
        BackgroundImageSizeV1::Contain => json!("contain"),
        BackgroundImageSizeV1::Explicit { x, y } => json!({
            "x": size_axis(x),
            "y": size_axis(y),
        }),
    }
}

fn size_axis(axis: rito_style_contract::BackgroundSizeAxisV1) -> Value {
    use rito_style_contract::BackgroundSizeAxisV1 as Axis;
    match axis {
        Axis::Auto => json!("auto"),
        Axis::Value(LengthPercentage::Length(value)) => {
            json!({ "unit": "px", "value": value.get() })
        }
        Axis::Value(LengthPercentage::Percentage(value)) => {
            json!({ "unit": "percent", "value": value.percent() })
        }
        // calc() keeps the length component, mirroring the sizing policy
        // elsewhere in the materializer.
        Axis::Value(LengthPercentage::Linear { length, .. }) => {
            json!({ "unit": "px", "value": length.get() })
        }
    }
}

pub(crate) fn position_axis(value: LengthPercentage) -> Result<Value, BackgroundMaterializeError> {
    match value {
        LengthPercentage::Length(value) => Ok(json!({ "unit": "px", "value": value.get() })),
        LengthPercentage::Percentage(value) => {
            Ok(json!({ "unit": "percent", "value": value.percent() }))
        }
        LengthPercentage::Linear { .. } => Err(BackgroundMaterializeError::LinearPosition),
    }
}

#[cfg(test)]
mod tests {
    use rito_style_contract::{BackgroundImagePositionV1, CssPx, Percentage, ResolvedUrlV1};

    use super::*;

    fn image(url: &str) -> BackgroundImagePaintV1 {
        BackgroundImagePaintV1 {
            url: ResolvedUrlV1::new(url).unwrap(),
            size: BackgroundImageSizeV1::Cover,
            repeat: BackgroundImageRepeatV1::NoRepeat,
            position: BackgroundImagePositionV1 {
                x: LengthPercentage::Percentage(Percentage::from_percent(50.0).unwrap()),
                y: LengthPercentage::Length(CssPx::new(12.0).unwrap()),
            },
        }
    }

    #[test]
    fn materializes_canonical_publication_href_and_coupled_fields() {
        let mut output = Map::new();
        materialize_background_image(
            &mut output,
            Some(&image(
                "https://rito.invalid/publication/Images/cover%20art.jpg?edition=1#cover",
            )),
        )
        .unwrap();

        assert_eq!(
            output["backgroundImage"],
            json!("Images/cover%20art.jpg?edition=1#cover")
        );
        assert_eq!(output["backgroundRepeat"], json!("no-repeat"));
        assert_eq!(output["backgroundSize"], json!("cover"));
        assert_eq!(output["backgroundPosition"]["x"]["unit"], "percent");
        assert_eq!(output["backgroundPosition"]["x"]["value"], 50.0);
        assert_eq!(output["backgroundPosition"]["y"]["unit"], "px");
        assert_eq!(output["backgroundPosition"]["y"]["value"], 12.0);
    }

    #[test]
    fn materializes_the_css_initial_background_repeat() {
        let mut output = Map::new();
        let mut repeated = image("https://rito.invalid/publication/Images/paper.png");
        repeated.repeat = BackgroundImageRepeatV1::Repeat;

        materialize_background_image(&mut output, Some(&repeated)).unwrap();

        assert_eq!(output["backgroundRepeat"], json!("repeat"));
    }

    #[test]
    fn rejects_urls_outside_the_epub_publication_origin() {
        assert_eq!(
            materialize_background_image(
                &mut Map::new(),
                Some(&image("https://example.test/Images/cover.jpg")),
            ),
            Err(BackgroundMaterializeError::NonPublicationUrl)
        );
    }
}
