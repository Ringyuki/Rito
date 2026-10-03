//! The font catalog: every face the context shapes with, how a computed
//! `font-family` list resolves against them, and the face table paint
//! names faces by.
//!
//! Resolution follows CSS Fonts' family matching. A named family is the
//! publication's `@font-face` family of that name, else the host family of
//! that name; a name nothing answers to is skipped. A generic family is the
//! host families of its role: the role's language-neutral faces first, then
//! the faces tagged for a language, the content's own language ahead of
//! the rest — so a Latin face pinned for every language keeps Latin text
//! while a CJK face tagged for Simplified Chinese serves ideographs ahead
//! of a Japanese one. After the list, every remaining host family follows
//! as the user agent's fallback, serif first, so a character the list
//! cannot serve still lands on a host face rather than nothing.
//!
//! Every catalog family registers with the shaper under its own internal
//! name, so a publication family can never merge into a host family of the
//! same name, and the resolved list is handed to shaping and to every
//! metric path alike.

use std::cell::RefCell;
use std::collections::BTreeSet;

use rustc_hash::FxHashMap;
use std::rc::Rc;

use parley::fontique::{Blob, Collection, FontInfoOverride, FontStyle, FontWeight, Language};
use rito_fragment::FontFaceId;
use rito_style_contract::{FontFamily, GenericFontFamily, InlineFormattingStyle};

/// The generic family a host face serves.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum HostFontRole {
    Serif,
    SansSerif,
    Monospace,
}

/// The fallback order of the roles after a family list runs out: the
/// browser's default font is its serif.
const FALLBACK_ROLES: [HostFontRole; 3] = [
    HostFontRole::Serif,
    HostFontRole::SansSerif,
    HostFontRole::Monospace,
];

/// A face the host supplies: the bytes, the CSS family name it answers to,
/// the generic family it serves, the language it is drawn for, and the
/// name paint draws it by.
#[derive(Clone, Debug)]
pub struct HostFontFace {
    pub bytes: Vec<u8>,
    /// The family a `font-family` list names it by (see
    /// [`font_family_name`]).
    pub family: String,
    pub role: HostFontRole,
    /// Lowercase BCP 47 tag; `None` serves every language.
    pub language: Option<String>,
    /// The family name the host registers these bytes under for paint.
    pub alias: String,
}

/// A publication `@font-face` binding: the declared family, the bound
/// bytes, the declared descriptors (normalized, CSS defaults filled in),
/// and the name paint draws it by.
#[derive(Clone, Debug)]
pub struct PublicationFontFace {
    pub family: String,
    pub bytes: Vec<u8>,
    pub weight: u16,
    pub italic: bool,
    pub alias: String,
}

#[derive(Debug)]
enum FamilySource {
    Host {
        role: HostFontRole,
        language: Option<String>,
    },
    Publication,
}

#[derive(Debug)]
struct CatalogFamily {
    /// The name the family is registered with the shaper under.
    internal: String,
    /// The CSS name it answers to, lowercase.
    name: String,
    source: FamilySource,
}

/// A computed family list resolved against the catalog for one content
/// language.
#[derive(Debug)]
pub(crate) struct ResolvedStack {
    /// Internal family names in matching order.
    pub families: Vec<String>,
    /// The list as a shaper family source.
    pub source: String,
    /// The content language shaping runs under.
    pub locale: Option<Language>,
    /// Cache key: equal keys shape identically.
    pub key: String,
}

/// Resolved stacks per (family list key, content language).
type StackCache = RefCell<FxHashMap<(String, Option<String>), Rc<ResolvedStack>>>;

#[derive(Debug, Default)]
pub(crate) struct FontCatalog {
    families: Vec<CatalogFamily>,
    aliases: Vec<String>,
    face_ids: FxHashMap<(u64, u32), FontFaceId>,
    stacks: StackCache,
    unknown: RefCell<BTreeSet<String>>,
}

impl FontCatalog {
    /// Registers one host face, grouped into the family its name table
    /// declares together with the faces of the same name, role and
    /// language.
    pub(crate) fn register_host(
        &mut self,
        collection: &mut Collection,
        face: HostFontFace,
    ) -> Result<(), String> {
        let name = face.family.trim().to_lowercase();
        let source = FamilySource::Host {
            role: face.role,
            language: face.language,
        };
        let internal = self.internal_family(name, source);
        self.register(collection, face.bytes, &internal, None, face.alias)
    }

    /// Registers one publication face under its declared family with its
    /// declared weight and style, the way `@font-face` binds them.
    pub(crate) fn register_publication(
        &mut self,
        collection: &mut Collection,
        face: PublicationFontFace,
    ) -> Result<(), String> {
        let internal =
            self.internal_family(face.family.trim().to_lowercase(), FamilySource::Publication);
        let descriptors = (
            FontWeight::new(f32::from(face.weight)),
            if face.italic {
                FontStyle::Italic
            } else {
                FontStyle::Normal
            },
        );
        self.register(
            collection,
            face.bytes,
            &internal,
            Some(descriptors),
            face.alias,
        )
    }

    fn internal_family(&mut self, name: String, source: FamilySource) -> String {
        let same = |family: &CatalogFamily| {
            family.name == name
                && match (&family.source, &source) {
                    (FamilySource::Publication, FamilySource::Publication) => true,
                    (
                        FamilySource::Host { role, language },
                        FamilySource::Host {
                            role: other_role,
                            language: other_language,
                        },
                    ) => role == other_role && language == other_language,
                    _ => false,
                }
        };
        if let Some(family) = self.families.iter().find(|family| same(family)) {
            return family.internal.clone();
        }
        let internal = format!("__rito_family_{}", self.families.len());
        self.families.push(CatalogFamily {
            internal: internal.clone(),
            name,
            source,
        });
        internal
    }

    fn register(
        &mut self,
        collection: &mut Collection,
        bytes: Vec<u8>,
        internal: &str,
        descriptors: Option<(FontWeight, FontStyle)>,
        alias: String,
    ) -> Result<(), String> {
        let blob = Blob::from(bytes);
        let registered = collection.register_fonts(
            blob.clone(),
            Some(FontInfoOverride {
                family_name: Some(internal),
                width: None,
                style: descriptors.map(|(_, style)| style),
                weight: descriptors.map(|(weight, _)| weight),
                axes: None,
            }),
        );
        if registered.is_empty() {
            return Err(format!("font for {alias} registered no font face"));
        }
        let id = FontFaceId(self.aliases.len() as u32);
        self.aliases.push(alias);
        for (_, fonts) in registered {
            for font in fonts {
                self.face_ids.insert((blob.id(), font.index()), id);
            }
        }
        self.stacks.get_mut().clear();
        Ok(())
    }

    /// Every internal family in user-agent fallback order: the host
    /// families role by role, then the publication families.
    pub(crate) fn fallback_families(&self) -> Vec<String> {
        let mut families = Vec::new();
        for role in FALLBACK_ROLES {
            push_unique(&mut families, self.role_families(role, None));
        }
        push_unique(
            &mut families,
            self.families
                .iter()
                .filter(|family| matches!(family.source, FamilySource::Publication))
                .map(|family| family.internal.clone())
                .collect(),
        );
        families
    }

    /// The face a shaped run's font is, as paint names it.
    pub(crate) fn face_id(&self, font: &parley::FontData) -> FontFaceId {
        self.face_ids
            .get(&(font.data.id(), font.index))
            .copied()
            .unwrap_or_default()
    }

    /// The name paint draws each face by, indexed by face id.
    pub(crate) fn aliases(&self) -> &[String] {
        &self.aliases
    }

    /// Names the catalog could not resolve since it was built, lowercase.
    pub(crate) fn unknown_families(&self) -> Vec<String> {
        self.unknown.borrow().iter().cloned().collect()
    }

    /// The style's family list resolved for its content language.
    pub(crate) fn resolve(&self, style: &InlineFormattingStyle) -> Rc<ResolvedStack> {
        let language = style
            .text_flow
            .language
            .as_ref()
            .filter(|tag| !tag.is_empty())
            .map(|tag| tag.as_str().to_owned());
        let list_key = style
            .font
            .families
            .iter()
            .map(|family| match family {
                FontFamily::Named(name) => format!("\"{}\"", name.as_str().to_lowercase()),
                FontFamily::Generic(generic) => format!("{generic:?}"),
            })
            .collect::<Vec<_>>()
            .join(",");
        let key = (list_key, language);
        if let Some(stack) = self.stacks.borrow().get(&key) {
            return Rc::clone(stack);
        }
        let stack = Rc::new(self.resolve_uncached(style, key.1.as_deref()));
        self.stacks.borrow_mut().insert(key, Rc::clone(&stack));
        stack
    }

    fn resolve_uncached(
        &self,
        style: &InlineFormattingStyle,
        language: Option<&str>,
    ) -> ResolvedStack {
        let mut families = Vec::new();
        for family in style.font.families.iter() {
            match family {
                FontFamily::Named(name) => {
                    let named = self.named_families(name.as_str());
                    if named.is_empty() {
                        self.unknown
                            .borrow_mut()
                            .insert(name.as_str().trim().to_lowercase());
                    }
                    push_unique(&mut families, named);
                }
                FontFamily::Generic(generic) => {
                    if let Some(role) = generic_role(*generic) {
                        push_unique(&mut families, self.role_families(role, language));
                    }
                }
            }
        }
        for role in FALLBACK_ROLES {
            push_unique(&mut families, self.role_families(role, language));
        }
        let source = families
            .iter()
            .map(|family| format!("\"{family}\""))
            .collect::<Vec<_>>()
            .join(", ");
        let locale = language.and_then(|tag| tag.parse::<Language>().ok());
        let key = format!("{source}|{}", language.unwrap_or_default());
        ResolvedStack {
            families,
            source,
            locale,
            key,
        }
    }

    /// The families a CSS name answers to: the publication's own
    /// `@font-face` family shadows a host family of the same name.
    fn named_families(&self, name: &str) -> Vec<String> {
        let name = name.trim().to_lowercase();
        let matching = |publication: bool| {
            self.families
                .iter()
                .filter(|family| {
                    family.name == name
                        && matches!(family.source, FamilySource::Publication) == publication
                })
                .map(|family| family.internal.clone())
                .collect::<Vec<_>>()
        };
        let publication = matching(true);
        if publication.is_empty() {
            matching(false)
        } else {
            publication
        }
    }

    /// The host families serving `role`, language-neutral faces first and
    /// then by how closely their language matches the content's.
    fn role_families(&self, role: HostFontRole, language: Option<&str>) -> Vec<String> {
        let mut ranked = self
            .families
            .iter()
            .filter_map(|family| match &family.source {
                FamilySource::Host {
                    role: family_role,
                    language: family_language,
                } if *family_role == role => Some((
                    language_rank(family_language.as_deref(), language),
                    family.internal.clone(),
                )),
                _ => None,
            })
            .collect::<Vec<_>>();
        ranked.sort_by_key(|(rank, _)| *rank);
        ranked.into_iter().map(|(_, family)| family).collect()
    }
}

/// The role a generic family maps to; `None` for the generics no host face
/// declares (cursive, fantasy), which resolve through the fallback.
fn generic_role(generic: GenericFontFamily) -> Option<HostFontRole> {
    match generic {
        GenericFontFamily::Serif => Some(HostFontRole::Serif),
        GenericFontFamily::SansSerif | GenericFontFamily::SystemUi => Some(HostFontRole::SansSerif),
        GenericFontFamily::Monospace => Some(HostFontRole::Monospace),
        GenericFontFamily::Cursive | GenericFontFamily::Fantasy => None,
    }
}

/// A face's rank for content in `content`: language-neutral faces first,
/// then an exact tag match, then the same primary language, then the rest.
fn language_rank(face: Option<&str>, content: Option<&str>) -> u8 {
    let Some(face) = face.filter(|tag| *tag != "und") else {
        return 0;
    };
    let Some(content) = content else {
        return 3;
    };
    let primary = |tag: &str| tag.split('-').next().unwrap_or_default().to_owned();
    if face == content {
        1
    } else if primary(face) == primary(content) {
        2
    } else {
        3
    }
}

fn push_unique(families: &mut Vec<String>, more: Vec<String>) {
    for family in more {
        if !families.contains(&family) {
            families.push(family);
        }
    }
}

/// The family a font's name table declares for its first face: the
/// typographic family when present (what CSS matches), else the legacy
/// family.
pub fn font_family_name(bytes: &[u8]) -> Option<String> {
    use skrifa::{string::StringId, MetadataProvider as _};
    let font = skrifa::FontRef::from_index(bytes, 0).ok()?;
    [StringId::TYPOGRAPHIC_FAMILY_NAME, StringId::FAMILY_NAME]
        .into_iter()
        .find_map(|id| {
            font.localized_strings(id)
                .english_or_first()
                .map(|name| name.chars().collect::<String>())
        })
}
