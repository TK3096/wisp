use wasm_bindgen_test::wasm_bindgen_test;

#[wasm_bindgen_test]
fn exposes_one_cognition_handle_shaped_api() {
    use wisp_cognition_wasm::WispCognition;

    let init = r#"{
        "schemaVersion": 1,
        "characterId": "wasm-character",
        "archetype": "ninja-frog",
        "personalitySeed": 42
    }"#;
    let mut handle = WispCognition::new(js_sys::JSON::parse(init).unwrap()).unwrap();

    handle
        .observe(js_sys::JSON::parse(r#"{"kind":"lifecycle","phase":"materialized"}"#).unwrap())
        .unwrap();
    let signal = handle.tick(0.1).unwrap();
    let snapshot = handle.snapshot().unwrap();

    assert!(signal.is_object());
    assert!(snapshot.is_object());
    handle.restore(snapshot).unwrap();
}
