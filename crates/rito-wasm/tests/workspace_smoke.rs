#[test]
fn wasm_crate_links_to_core_crate() {
    assert_eq!(rito_wasm::BOUNDARY_NAME, "rito-wasm");
    assert_eq!(rito_wasm::core_engine_name(), "rito-core");
}
