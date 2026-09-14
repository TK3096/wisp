import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SPEECH_SEMANTIC_CONTRACT } from "../src/speech/semanticContract";
import { createGeneratedSpeechHandle } from "../src/speech/generator";
import {
  GENERATED_SPEECH_VOICE_PROFILE_VERSION,
  type ExpressionDirection,
  type PersonalityDimensions,
  type SpeechHandleInit,
  type SpeechRequest,
  type UtteranceIntent,
} from "../src/speech";

const ROOT = process.cwd();
const OUTPUT_PATH = join(ROOT, "src/speech/semanticSamples.json");

const PERSONALITIES: Record<string, PersonalityDimensions> = {
  "mask-dude": { energy: 0.62, curiosity: 0.74, boldness: 0.58, sociability: 0.52 },
  "ninja-frog": { energy: 0.76, curiosity: 0.58, boldness: 0.68, sociability: 0.47 },
  "pink-man": { energy: 0.68, curiosity: 0.63, boldness: 0.56, sociability: 0.81 },
  "virtual-guy": { energy: 0.48, curiosity: 0.77, boldness: 0.51, sociability: 0.42 },
};

const DIRECTIONS: Record<UtteranceIntent, ExpressionDirection> = {
  greet: { tone: "cheerful", intent: "greet", intensity: "neutral", stance: "social" },
  idle: { tone: "curious", intent: "idle", intensity: "quiet", stance: "familiar" },
  startle: { tone: "curious", intent: "startle", intensity: "charged", stance: "novel" },
  excite: { tone: "cheerful", intent: "excite", intensity: "charged", stance: "social" },
  investigate: { tone: "curious", intent: "investigate", intensity: "neutral", stance: "novel" },
  bored: { tone: "grumpy", intent: "bored", intensity: "quiet", stance: "familiar" },
};

function sampleSeed(parts: readonly string[]): number {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    for (let index = 0; index < part.length; index += 1) {
      hash ^= part.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return hash >>> 0;
}

function buildSampleMatrix() {
  const samples = SPEECH_SEMANTIC_CONTRACT.voices.flatMap((voice) =>
    (Object.keys(DIRECTIONS) as UtteranceIntent[]).map((intent) => {
      const archetype = voice.archetype;
      const seed = sampleSeed([
        SPEECH_SEMANTIC_CONTRACT.contractVersion,
        archetype,
        intent,
      ]);
      const init: SpeechHandleInit = {
        characterId: `sample-${archetype}`,
        archetype,
        personalitySeed: seed,
      };
      const request: SpeechRequest = {
        occasion: { kind: intent === "greet" ? "greeting" : "idle" },
        personality: PERSONALITIES[archetype] ?? {
          energy: 0.5,
          curiosity: 0.5,
          boldness: 0.5,
          sociability: 0.5,
        },
        direction: DIRECTIONS[intent],
        context: { recentExpressions: [] },
        seed,
      };
      const expression = createGeneratedSpeechHandle(init)
        .generateWithAttemptCount?.(request).expression ?? null;
      if (!expression) {
        throw new Error(`Semantic sample generation failed for ${archetype}/${intent}`);
      }
      return {
        archetype,
        intent,
        seed,
        voiceProfileVersion: GENERATED_SPEECH_VOICE_PROFILE_VERSION,
        direction: DIRECTIONS[intent],
        status: expression.source,
        text: expression.text,
      };
    }),
  );

  return {
    schemaVersion: 1,
    contractVersion: SPEECH_SEMANTIC_CONTRACT.contractVersion,
    samples,
  };
}

const mode = process.argv[2];
if (mode !== "build" && mode !== "check") {
  throw new Error("usage: semantic-contract-build <build|check>");
}

const serialized = `${JSON.stringify(buildSampleMatrix(), null, 2)}\n`;
if (mode === "build") {
  writeFileSync(OUTPUT_PATH, serialized);
  console.log(`Built ${OUTPUT_PATH}`);
} else if (!existsSyncSafe()) {
  throw new Error(`Missing ${OUTPUT_PATH}; run semantic:build`);
} else if (readFileSync(OUTPUT_PATH, "utf8") !== serialized) {
  throw new Error("Semantic sample matrix is stale; run semantic:build");
} else {
  console.log("Semantic sample matrix is current");
}

function existsSyncSafe(): boolean {
  try {
    readFileSync(OUTPUT_PATH, "utf8");
    return true;
  } catch {
    return false;
  }
}
