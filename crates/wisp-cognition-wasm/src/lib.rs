use wasm_bindgen::prelude::*;
use wisp_cognition_core::{CognitionCore, CognitionInit, PersistentCognitionState, Stimulus};

#[wasm_bindgen]
pub struct WispCognition {
    core: CognitionCore,
}

fn error_to_js(error: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}

#[wasm_bindgen]
impl WispCognition {
    #[wasm_bindgen(constructor)]
    pub fn new(init: JsValue) -> Result<WispCognition, JsValue> {
        let init: CognitionInit = serde_wasm_bindgen::from_value(init).map_err(error_to_js)?;
        CognitionCore::new(init)
            .map(|core| Self { core })
            .map_err(error_to_js)
    }

    pub fn observe(&mut self, stimulus: JsValue) -> Result<(), JsValue> {
        let stimulus: Stimulus = serde_wasm_bindgen::from_value(stimulus).map_err(error_to_js)?;
        self.core.observe(stimulus).map_err(error_to_js)
    }

    pub fn tone_seed(&self) -> Result<JsValue, JsValue> {
        serde_wasm_bindgen::to_value(&self.core.tone_signal()).map_err(error_to_js)
    }

    pub fn social_projection(&self) -> Vec<f64> {
        self.core.social_projection().to_vec()
    }

    pub fn apply_social_influence(&mut self, influence: f64) -> Result<(), JsValue> {
        self.core
            .apply_social_influence(influence)
            .map_err(error_to_js)
    }

    pub fn tick(&mut self, dt: f64) -> Result<JsValue, JsValue> {
        let signal = self.core.tick(dt).map_err(error_to_js)?;
        serde_wasm_bindgen::to_value(&signal).map_err(error_to_js)
    }

    pub fn note_expression(&mut self) {
        self.core.note_expression();
    }

    pub fn snapshot(&self) -> Result<JsValue, JsValue> {
        let snapshot = self.core.snapshot();
        serde_wasm_bindgen::to_value(&snapshot).map_err(error_to_js)
    }

    pub fn restore(&mut self, state: JsValue) -> Result<(), JsValue> {
        let state: PersistentCognitionState =
            serde_wasm_bindgen::from_value(state).map_err(error_to_js)?;
        self.core.restore(state).map_err(error_to_js)
    }
}
