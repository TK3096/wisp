import { describe, expect, it } from "vitest";
import { CharacterRegistry } from "../src/characterRegistry";
import { CharacterHandle } from "../src/character";
import {
  COGNITION_SCHEMA_VERSION,
  CognitionHandle,
  CognitionInit,
  NEUTRAL_BEHAVIOR_SIGNAL,
  PersistentCognitionState,
  SocialInfluence,
  SocialProjection,
  Stimulus,
  ToneSeed,
} from "../src/cognition";
import { EffectHandle } from "../src/effect";
import { PopulationPassSummary } from "../src/socialAttention";

const manifest = [{
  name: "baseline", displayName: "Baseline", idleFrames: 1, walkFrames: 1,
  frameWidth: 1, frameHeight: 1, idlePath: "", walkPath: "", jumpPath: "", fallPath: "",
}];
const loaded = new Map([[manifest[0].name, {
  idleTextures: [null], walkTextures: [null], jumpTexture: null, fallTexture: null,
}]]);

function makeCharacterHandle(): CharacterHandle {
  return {
    setAnimation() {}, setTexture() {}, setPosition() {}, setFlip() {},
    setAirborneSprite() {}, destroy() {},
  };
}

class SocialCognition implements CognitionHandle {
  readonly influences: SocialInfluence[] = [];
  influenced = false;
  constructor(private readonly init: CognitionInit) {}
  observe(_stimulus: Stimulus): void {}
  toneSeed(): ToneSeed {
    return { personality: NEUTRAL_BEHAVIOR_SIGNAL.personality, affect: NEUTRAL_BEHAVIOR_SIGNAL.affect };
  }
  socialProjection(): SocialProjection {
    return this.influenced
      ? [0.5, 0.5, 0.5, 1, 0, 1, 0, 1]
      : [0, 0, 0, 0, 0, 0, 0, 0];
  }
  applySocialInfluence(influence: SocialInfluence): void {
    this.influences.push(influence);
    this.influenced = true;
  }
  tick(_dt: number) {
    if (!this.influenced) return NEUTRAL_BEHAVIOR_SIGNAL;
    return {
      ...NEUTRAL_BEHAVIOR_SIGNAL,
      microBelief: { ...NEUTRAL_BEHAVIOR_SIGNAL.microBelief, socialPositivity: 1 },
    };
  }
  noteExpression(): void {}
  snapshot(): PersistentCognitionState {
    return { schemaVersion: COGNITION_SCHEMA_VERSION, characterId: this.init.characterId, cognition: null };
  }
  restore(): void {}
}

function createRegistry(options: {
  populationCognitionEnabled?: boolean;
  effectHandle?: EffectHandle;
  onPass?: (summary: PopulationPassSummary) => void;
}) {
  const cognitions: SocialCognition[] = [];
  return {
    cognitions,
    registry: new CharacterRegistry({
      stage: null,
      manifest,
      loadedAssets: loaded,
      rng: () => 0,
      schedulerRng: () => 0.99,
      screenWidth: 100,
      floorY: 100,
      createHandle: makeCharacterHandle,
      createCognitionHandle: (init) => {
        const cognition = new SocialCognition(init);
        cognitions.push(cognition);
        return cognition;
      },
      createEffectHandle: options.effectHandle ? () => options.effectHandle : undefined,
      createCharacterId: (() => {
        let id = 0;
        return () => `character-${++id}`;
      })(),
      populationCognitionEnabled: options.populationCognitionEnabled,
      onPopulationCognitionPass: options.onPass,
    }),
  };
}

describe("CharacterRegistry Population Cognition Pass", () => {
  it("does not cross the cognition boundary while Set Attention is default-off", () => {
    const passes: PopulationPassSummary[] = [];
    const { registry, cognitions } = createRegistry({ onPass: passes.push.bind(passes) });
    registry.spawn();
    registry.spawn();
    registry.tick(0.6);

    expect(cognitions.flatMap((cognition) => cognition.influences)).toEqual([]);
    expect(passes).toHaveLength(1);
    expect(passes[0]).toMatchObject({
      enabled: false, eligibleCount: 2, skipReason: "disabled",
    });
  });

  it("runs a bounded deterministic pass, applies slow influence, and reports only bounded summaries", () => {
    const passes: PopulationPassSummary[] = [];
    const { registry, cognitions } = createRegistry({
      populationCognitionEnabled: true,
      onPass: (summary) => passes.push(summary),
    });
    registry.spawn();
    registry.spawn();
    registry.tick(0.2);
    registry.tick(0.3);

    expect(passes).toHaveLength(1);
    expect(passes[0]).toMatchObject({
      enabled: true, atS: 0.5, cadenceS: 0.5, eligibleCount: 2,
      skipReason: null, membershipDigest: expect.any(String),
    });
    expect(passes[0].postIntegrationSignals).toEqual([
      { characterId: "character-1", socialPositivity: 1 },
      { characterId: "character-2", socialPositivity: 1 },
    ]);
    expect(cognitions.map((cognition) => cognition.influences.length)).toEqual([1, 1]);
    expect(cognitions[0].influences[0]).toMatchObject({ sourceId: "character-2" });
    expect(passes[0].strongestContribution).toMatchObject({
      receiverId: expect.any(String), sourceId: expect.any(String),
    });
  });

  it("skips when fewer than two Materialized characters are eligible", () => {
    const passes: PopulationPassSummary[] = [];
    const pendingEffect: EffectHandle = {
      setTexture() {}, setPosition() {}, expired: false, destroy() {},
    };
    const { registry, cognitions } = createRegistry({
      populationCognitionEnabled: true,
      effectHandle: pendingEffect,
      onPass: (summary) => passes.push(summary),
    });
    registry.spawn();
    registry.tick(0.5);

    expect(registry.count).toBe(0);
    expect(passes[0]).toMatchObject({
      enabled: true, eligibleCount: 0, skipReason: "insufficient_eligible",
    });
    expect(cognitions).toEqual([]);
  });
});
