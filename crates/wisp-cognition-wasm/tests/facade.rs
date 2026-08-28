use wasm_bindgen_test::wasm_bindgen_test;

#[wasm_bindgen_test]
fn exposes_one_cognition_handle_shaped_api() {
    use wisp_cognition_wasm::WispCognition;

    let init = r#"{
        "schemaVersion": 2,
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

#[wasm_bindgen_test]
fn exposes_bounded_temporal_surprise_without_substrate_apis() {
    use wisp_cognition_wasm::WispCognition;

    let init = r#"{
        "schemaVersion": 2,
        "characterId": "wasm-character",
        "archetype": "ninja-frog",
        "personalitySeed": 7
    }"#;
    let mut handle = WispCognition::new(js_sys::JSON::parse(init).unwrap()).unwrap();
    handle
        .observe(
            js_sys::JSON::parse(r#"{"kind":"gesture","gesture":"openPalm","confidence":0.96}"#)
                .unwrap(),
        )
        .unwrap();

    let signal: wisp_cognition_core::BehaviorSignal =
        serde_wasm_bindgen::from_value(handle.tick(0.1).unwrap()).unwrap();

    assert!(signal.affect.surprise > 0.3);
    assert!(signal.temporal_surprise.centered_energy > 0.3);
    assert_eq!(
        signal.reaction.kind,
        wisp_cognition_core::Reaction::Curiosity
    );
    assert!(signal.micro_belief.novelty > 0.0);
    assert!((0.0..=2.0).contains(&signal.behavior_bias.jump_chance));
}
