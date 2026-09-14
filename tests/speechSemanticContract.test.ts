import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import rawLexicon from "../src/speech/lexicon.json";
import rawContract from "../src/speech/semanticContract.json";
import rawSamples from "../src/speech/semanticSamples.json";
import { NEUTRAL_BEHAVIOR_SIGNAL } from "../src/cognition";
import {
  GENERATED_SPEECH_VOICE_PROFILE_VERSION,
  isValidGeneratedSpeechExpression,
  type ExpressionDirection,
  type SpeechHandleInit,
  type SpeechRequest,
  type UtteranceIntent,
} from "../src/speech";
import { createGeneratedSpeechHandle } from "../src/speech/generator";
import {
  SPEECH_SEMANTIC_CONTRACT,
  SPEECH_SEMANTIC_CONTRACT_VERSION,
  validateSemanticContract,
} from "../src/speech/semanticContract";

const intentDirections: Record<UtteranceIntent, ExpressionDirection> = {
  greet: { tone: "cheerful", intent: "greet", intensity: "neutral", stance: "social" },
  idle: { tone: "curious", intent: "idle", intensity: "quiet", stance: "familiar" },
  startle: { tone: "curious", intent: "startle", intensity: "charged", stance: "novel" },
  excite: { tone: "cheerful", intent: "excite", intensity: "charged", stance: "social" },
  investigate: { tone: "curious", intent: "investigate", intensity: "neutral", stance: "novel" },
  bored: { tone: "grumpy", intent: "bored", intensity: "quiet", stance: "familiar" },
};

function request(
  archetype: string,
  intent: UtteranceIntent,
  seed: number,
): SpeechRequest {
  return {
    occasion: { kind: intent === "greet" ? "greeting" : "idle" },
    personality: NEUTRAL_BEHAVIOR_SIGNAL.personality,
    direction: intentDirections[intent],
    context: { recentExpressions: [] },
    seed,
  };
}

function candidatesFor(
  template: string,
  approved: Map<string, Set<string>>,
  suffix: string,
) {
  let patterns = [""];
  let cursor = 0;
  for (const match of template.matchAll(/\{([a-z-]+)\}/g)) {
    const literal = template.slice(cursor, match.index);
    patterns = patterns.flatMap((prefix) =>
      [...approved.get(match[1])!].map((word) => `${prefix}${literal}${word}`),
    );
    cursor = match.index! + match[0].length;
  }
  return patterns.map((prefix) => {
    const expanded = `${prefix}${template.slice(cursor)}`;
    return /[.!?]$/.test(expanded) ? expanded : `${expanded}${suffix}`;
  });
}

describe("Speech Semantic Coherence Contract", () => {
  it("is versioned and promotes only packaged inventory words", () => {
    expect(SPEECH_SEMANTIC_CONTRACT_VERSION).toBe(
      "speech-semantic-coherence-v1",
    );
    expect(GENERATED_SPEECH_VOICE_PROFILE_VERSION).toBe(
      "generated-speech-v2",
    );

    const inventory = new Set(
      (rawLexicon as { entries: { lemma: string }[] }).entries.map(
        (entry) => entry.lemma,
      ),
    );
    const contract = SPEECH_SEMANTIC_CONTRACT;
    expect(contract.slots.length).toBeGreaterThanOrEqual(3);
    for (const slot of contract.slots) {
      expect(slot.definition.trim()).not.toBe("");
      expect(slot.words.length).toBeGreaterThan(0);
      expect(new Set(slot.words).size).toBe(slot.words.length);
      for (const word of slot.words) expect(inventory.has(word)).toBe(true);
    }
  });

  it("accepts only exact authored skeleton and approved-slot expansions", () => {
    const approved = new Map(
      SPEECH_SEMANTIC_CONTRACT.slots.map((slot) => [slot.name, new Set(slot.words)]),
    );
    const archetype = "mask-dude";
    const init: SpeechHandleInit = {
      characterId: "semantic-character",
      archetype,
      personalitySeed: 85,
    };
    const handle = createGeneratedSpeechHandle(init);

    for (const [intent, direction] of Object.entries(intentDirections)) {
      const expression = handle.generate(request(archetype, intent as UtteranceIntent, 8500));
      expect(expression).not.toBeNull();
      expect(isValidGeneratedSpeechExpression(
        expression,
        direction,
      )).toBe(true);

      const voice = SPEECH_SEMANTIC_CONTRACT.voices.find((item) =>
        item.archetype === archetype,
      )!;
      const suffix = direction.intensity === "quiet"
        ? "."
        : voice.terminal;
      const allowedSkeletons = voice.skeletons[intent as UtteranceIntent]
        .filter((skeleton) => skeleton.intensities.includes(direction.intensity));
      const allowedTexts = allowedSkeletons.flatMap((skeleton) =>
        candidatesFor(skeleton.template, approved, suffix),
      );
      expect(allowedTexts).toContain(expression?.text);
    }
  });

  it("rejects malformed contract data before a generator can be created", () => {
    const invalid = structuredClone(rawContract) as typeof rawContract & {
      voices: {
        skeletons: Record<string, Record<string, { slots: string[] }>[]>;
      }[];
    };
    invalid.voices[0].skeletons.greet[0].slots = [];
    expect(() =>
      validateSemanticContract(
        invalid,
        rawLexicon as { entries: readonly unknown[] },
      ),
    ).toThrow(/does not declare its exact slots/);
  });

  it("contains the deterministic archetype-by-intent sample matrix", () => {
    const samples = rawSamples.samples;
    expect(rawSamples.contractVersion).toBe(SPEECH_SEMANTIC_CONTRACT_VERSION);
    expect(samples).toHaveLength(
      SPEECH_SEMANTIC_CONTRACT.voices.length * Object.keys(intentDirections).length,
    );

    const seen = new Set<string>();
    for (const sample of samples) {
      const identity = `${sample.archetype}:${sample.intent}`;
      expect(seen.has(identity)).toBe(false);
      seen.add(identity);
      expect(sample.voiceProfileVersion).toBe(GENERATED_SPEECH_VOICE_PROFILE_VERSION);
      expect(sample.status).toBe("generated");
      expect(sample.text).toBe(
        createGeneratedSpeechHandle({
          characterId: `sample-${sample.archetype}`,
          archetype: sample.archetype,
          personalitySeed: sample.seed,
        }).generate(
          request(sample.archetype, sample.intent, sample.seed),
        )?.text,
      );
    }

    expect(readFileSync("src/speech/semanticSamples.json", "utf8")).toBe(
      `${JSON.stringify(rawSamples, null, 2)}\n`,
    );
  });
});
