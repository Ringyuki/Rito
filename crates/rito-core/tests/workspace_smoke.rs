use rito_core::{engine_modules, ENGINE_NAME};

#[test]
fn module_boundaries_are_declared_once() {
    let modules = engine_modules();
    let names: Vec<&str> = modules.iter().map(|module| module.name).collect();

    assert_eq!(ENGINE_NAME, "rito-core");
    assert_eq!(
        names,
        vec![
            "epub",
            "xhtml",
            "css",
            "style",
            "layout",
            "render",
            "interaction",
            "resources",
            "runtime",
        ]
    );

    for module in modules {
        assert!(!module.owns.trim().is_empty());
    }
}
