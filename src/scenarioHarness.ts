import { AssetEntry } from "./config";
import { BubbleHandle } from "./bubble";
import { CharacterHandle, CharacterState } from "./character";
import {
  CharacterRegistry,
  RenderOwner,
  SpawnContext,
} from "./characterRegistry";
import { EffectHandle, EffectKind } from "./effect";
import {
  COGNITION_CADENCE_S,
  COGNITION_SCHEMA_VERSION,
  CognitionInit,
  CognitionHandle,
  PersistentCognitionState,
  Stimulus,
  StimulusEnvelope,
  createNeutralCognitionHandle,
  derivePersonalitySeed,
} from "./cognition";
import { LoadedAsset } from "./simulationAsset";

export interface ScenarioStimulus {
  atS: number;
  envelope: StimulusEnvelope;
}

export type ScenarioDespawnTarget = "oldest" | "newest" | "all" | number;

export interface ScenarioDespawn {
  atS: number;
  target: ScenarioDespawnTarget;
}

export interface ScenarioDefinition {
  name: string;
  seed: number;
  durationS: number;
  spawnTimes: number[];
  /** Optional prefix for deterministic spawn and wander draws. */
  spawnRolls?: number[];
  /** Every scheduler draw, in consumption order. */
  schedulerRolls: number[];
  /** Optional deterministic seeds in spawn order; defaults to identity-derived seeds. */
  personalitySeeds?: number[];
  stimuli?: ScenarioStimulus[];
  despawns?: ScenarioDespawn[];
}

export type ScenarioTraceRecordType =
  | "spawn_requested"
  | "spawn_effect_started"
  | "spawn_effect_ended"
  | "character_materialized"
  | "stimulus_dispatch"
  | "stimulus_observed"
  | "cognition_step"
  | "scheduler_roll"
  | "animation_changed"
  | "facing_changed"
  | "jump_started"
  | "jump_phase_changed"
  | "jump_ended"
  | "bubble_started"
  | "bubble_ended"
  | "despawn_requested"
  | "despawn_effect_started"
  | "despawn_effect_ended"
  | "character_vanished"
  | "render_handle_destroyed"
  | "scenario_completed";

export interface ScenarioTraceRecord {
  type: ScenarioTraceRecordType;
  scenarioName: string;
  seed: number;
  contractVersion: number;
  renderScheduleHz: number;
  /** Virtual render-tick index; multiple cognition steps may share a tick. */
  tick: number;
  clockS: number;
  characterId?: string;
  archetype?: string;
  [key: string]: unknown;
}

export interface ScenarioResult {
  scenario: ScenarioDefinition;
  renderScheduleHz: number;
  trace: ScenarioTraceRecord[];
  traceWriter?: LossyTraceWriter;
}

export interface ScenarioRunOptions {
  traceSink?: TraceSink;
  maxQueuedTraceLines?: number;
  /** Injected cognition seam. Unit tests stay pure and never build WASM. */
  createCognitionHandle?: (init: CognitionInit) => CognitionHandle;
}

export const BASELINE_SCENARIO: ScenarioDefinition = {
  name: "baseline",
  seed: 0x57505350,
  durationS: 31.2,
  spawnTimes: [0],
  spawnRolls: [0, 0.25, 0.25, 0, 0.5],
  schedulerRolls: [0.5, 0.5, 0.1],
  stimuli: [
    {
      atS: 1.1,
      envelope: {
        target: "all",
        stimulus: { kind: "environment", change: "appFocus" },
      },
    },
  ],
  despawns: [{ atS: 30.9, target: "oldest" }],
};

export interface ScenarioCognitionStep {
  characterId: string;
  cognitionStep: number;
  dtS: number;
  elapsedCognitionS: number;
  behaviorSignal: unknown;
  appliedBiases: unknown;
  cognitionState: unknown;
}

export type ScenarioBehaviorDecision =
  | { type: "character_materialized"; characterId: string; archetype: string; x: number; y: number }
  | { type: "animation_changed"; characterId: string; from: string | null; to: string }
  | { type: "facing_changed"; characterId: string; facing: string }
  | { type: "jump_started"; characterId: string }
  | { type: "jump_ended"; characterId: string }
  | { type: "bubble_started"; characterId: string; reason: string; text: string }
  | { type: "character_vanished"; characterId: string; archetype: string };

interface LiveCharacter {
  registryId: number;
  characterId: string;
  archetype: string;
}

interface ScheduledEvent {
  atS: number;
  order: number;
  kind: "spawn" | "stimulus" | "despawn";
  index: number;
}

const SCREEN_WIDTH_PX = 1920;
const FLOOR_Y_PX = 1016;
const TIME_EPSILON_S = 1e-12;

const BASELINE_ASSET: AssetEntry = {
  name: "baseline",
  displayName: "Baseline",
  idlePath: "",
  walkPath: "",
  jumpPath: "",
  fallPath: "",
  idleFrames: 1,
  walkFrames: 1,
  frameWidth: 1,
  frameHeight: 1,
};

const BASELINE_LOADED_ASSET: LoadedAsset = {
  idleTextures: [null],
  walkTextures: [null],
  jumpTexture: null,
  fallTexture: null,
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    const item = source[key];
    if (item !== undefined) result[key] = canonicalize(item);
  }
  return result;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function formatScenarioTraceNdjson(result: ScenarioResult): string {
  return result.trace.map((record) => `${stableStringify(record)}\n`).join("");
}

export type TraceSink = (line: string) => Promise<void> | void;

export interface LossyTraceWriterOptions {
  maxQueuedLines: number;
}

export class LossyTraceWriter {
  private readonly queue: string[] = [];
  private current: Promise<void> | null = null;
  private failure: unknown = null;
  private writtenLineCount = 0;
  private droppedLineCount = 0;

  constructor(
    private readonly sink: TraceSink,
    private readonly options: LossyTraceWriterOptions,
  ) {
    if (
      !Number.isInteger(options.maxQueuedLines) ||
      options.maxQueuedLines < 1
    ) {
      throw new Error("maxQueuedLines must be a positive integer");
    }
  }

  get droppedLines(): number {
    return this.droppedLineCount;
  }

  get writtenLines(): number {
    return this.writtenLineCount;
  }

  write(record: unknown): void {
    if (this.failure !== null) return;

    const line = `${stableStringify(record)}\n`;
    if (this.current) {
      while (this.queue.length >= this.options.maxQueuedLines) {
        this.queue.shift();
        this.droppedLineCount++;
      }
      this.queue.push(line);
      return;
    }

    this.current = this.pump(line);
  }

  async flush(): Promise<void> {
    while (this.queue.length > 0 && this.current === null) {
      this.current = this.pump(this.queue.shift() as string);
    }
    if (this.current !== null) await this.current;
    if (this.failure !== null) throw this.failure;
  }

  private async pump(firstLine: string): Promise<void> {
    let line: string | null = firstLine;
    try {
      while (line !== null) {
        await this.sink(line);
        this.writtenLineCount++;
        line = this.queue.shift() ?? null;
      }
    } catch (error) {
      this.failure = error;
      this.queue.length = 0;
    } finally {
      this.current = null;
    }
  }
}

export function scenarioCognitionSteps(
  result: ScenarioResult,
): ScenarioCognitionStep[] {
  return result.trace
    .filter((record) => record.type === "cognition_step")
    .map((record) => ({
      characterId: record.characterId as string,
      cognitionStep: record.cognitionStep as number,
      dtS: record.dtS as number,
      elapsedCognitionS: record.elapsedCognitionS as number,
      behaviorSignal: record.behaviorSignal,
      appliedBiases: record.appliedBiases,
      cognitionState: record.cognitionState,
    }));
}

export function scenarioBehaviorDecisions(
  result: ScenarioResult,
): ScenarioBehaviorDecision[] {
  const decisions: ScenarioBehaviorDecision[] = [];
  for (const record of result.trace) {
    const characterId = record.characterId as string;
    switch (record.type) {
      case "character_materialized":
        decisions.push({
          type: record.type,
          characterId,
          archetype: record.archetype as string,
          x: record.x as number,
          y: record.y as number,
        });
        break;
      case "animation_changed":
        decisions.push({
          type: record.type,
          characterId,
          from: record.from as string | null,
          to: record.to as string,
        });
        break;
      case "facing_changed":
        decisions.push({
          type: record.type,
          characterId,
          facing: record.facing as string,
        });
        break;
      case "jump_started":
      case "jump_ended":
        decisions.push({ type: record.type, characterId });
        break;
      case "bubble_started":
        decisions.push({
          type: record.type,
          characterId,
          reason: record.reason as string,
          text: record.text as string,
        });
        break;
      case "character_vanished":
        decisions.push({
          type: record.type,
          characterId,
          archetype: record.archetype as string,
        });
        break;
      default:
        break;
    }
  }
  return decisions;
}

function utf8Bytes(value: string): number[] {
  const bytes: number[] = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return bytes;
}

export function digestOpaqueCognitionState(
  state: PersistentCognitionState,
): { schemaVersion: number; digest: string; bytes: number } {
  const encoded = utf8Bytes(stableStringify(state.cognition));
  let digest = 0x811c9dc5;
  for (const byte of encoded) {
    digest ^= byte;
    digest = Math.imul(digest, 0x01000193);
  }
  return {
    schemaVersion: state.schemaVersion,
    digest: (digest >>> 0).toString(16).padStart(8, "0"),
    bytes: encoded.length,
  };
}

function createSeededRandom(seed: number, salt: number): () => number {
  let state = (Math.imul(seed ^ salt, 0x6d2b79f5) + 0x9e3779b9) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function createScenarioRng(
  seed: number,
  salt: number,
  scriptedRolls: readonly number[] | undefined,
): () => number {
  const fallback = createSeededRandom(seed, salt);
  let index = 0;
  return () => {
    if (!scriptedRolls || index >= scriptedRolls.length) return fallback();
    const roll = scriptedRolls[index++];
    if (!Number.isFinite(roll) || roll < 0 || roll >= 1) {
      throw new Error(`Scenario scripted roll at index ${index - 1} must be in [0, 1)`);
    }
    return roll;
  };
}

function validateScenario(scenario: ScenarioDefinition, renderScheduleHz: number): void {
  if (!scenario.name || !/^[\w-]+$/.test(scenario.name)) {
    throw new Error("Scenario name must contain only letters, digits, underscores, or hyphens");
  }
  if (
    !Number.isInteger(scenario.seed) ||
    scenario.seed < 0 ||
    scenario.seed > 0xffffffff
  ) {
    throw new Error("Scenario seed must be an integer in [0, 2^32)");
  }
  if (!Number.isFinite(scenario.durationS) || scenario.durationS <= 0) {
    throw new Error("Scenario duration must be finite and positive");
  }
  if (!Number.isInteger(renderScheduleHz) || renderScheduleHz <= 0) {
    throw new Error("Render schedule must be a positive integer frequency");
  }

  const times = [
    ...scenario.spawnTimes,
    ...(scenario.stimuli ?? []).map((event) => event.atS),
    ...(scenario.despawns ?? []).map((event) => event.atS),
  ];
  if (times.some((time) => !Number.isFinite(time) || time < 0 || time > scenario.durationS)) {
    throw new Error("Scenario events must be finite and within [0, duration]");
  }
  for (const roll of [...(scenario.spawnRolls ?? []), ...scenario.schedulerRolls]) {
    if (!Number.isFinite(roll) || roll < 0 || roll >= 1) {
      throw new Error("Scenario rolls must be finite and within [0, 1)");
    }
  }
  if (scenario.personalitySeeds?.length !== undefined) {
    if (scenario.personalitySeeds.length !== scenario.spawnTimes.length) {
      throw new Error("Scenario personality seeds must align with spawn times");
    }
    if (
      scenario.personalitySeeds.some(
        (seed) => !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff,
      )
    ) {
      throw new Error("Scenario personality seeds must be integers in [0, 2^32)");
    }
  }
}

function buildEventSchedule(scenario: ScenarioDefinition): ScheduledEvent[] {
  const events: ScheduledEvent[] = [];
  scenario.spawnTimes.forEach((atS, index) =>
    events.push({ atS, order: 0, kind: "spawn", index }),
  );
  (scenario.stimuli ?? []).forEach((event, index) =>
    events.push({ atS: event.atS, order: 1, kind: "stimulus", index }),
  );
  (scenario.despawns ?? []).forEach((event, index) =>
    events.push({ atS: event.atS, order: 2, kind: "despawn", index }),
  );
  return events.sort((a, b) => a.atS - b.atS || a.order - b.order || a.index - b.index);
}

export function runScenario(
  scenario: ScenarioDefinition,
  renderScheduleHz: number,
  options: ScenarioRunOptions = {},
): ScenarioResult {
  validateScenario(scenario, renderScheduleHz);

  const trace: ScenarioTraceRecord[] = [];
  const traceWriter = options.traceSink
    ? new LossyTraceWriter(options.traceSink, {
        maxQueuedLines: options.maxQueuedTraceLines ?? 1024,
      })
    : undefined;
  const activeCharacters: LiveCharacter[] = [];
  let clockS = 0;
  let renderTick = 0;
  const greetedCharacterIds = new Set<string>();
  let schedulerRollIndex = 0;
  let activeEnvelope: StimulusEnvelope | null = null;

  const emit = (
    type: ScenarioTraceRecordType,
    fields: Record<string, unknown> = {},
  ): void => {
    const record: ScenarioTraceRecord = {
      type,
      scenarioName: scenario.name,
      seed: scenario.seed,
      contractVersion: COGNITION_SCHEMA_VERSION,
      renderScheduleHz,
      tick: renderTick,
      clockS,
      ...fields,
    };
    trace.push(record);
    traceWriter?.write(record);
  };

  const spawnRng = createScenarioRng(
    scenario.seed,
    0x5150,
    scenario.spawnRolls,
  );
  const scriptedSchedulerRng = () => {
    if (schedulerRollIndex >= scenario.schedulerRolls.length) {
      throw new Error(
        `Scenario exhausted scripted scheduler rolls at index ${schedulerRollIndex}`,
      );
    }
    const value = scenario.schedulerRolls[schedulerRollIndex++];
    emit("scheduler_roll", { rollIndex: schedulerRollIndex - 1, value });
    return value;
  };

  let characterIdentityIndex = 0;
  const nextCharacterId = () => `${scenario.name}-character-${++characterIdentityIndex}`;
  let nextPersonalitySeedIndex = 0;

  const createCognition =
    options.createCognitionHandle ?? createNeutralCognitionHandle;
  const makeCognitionHandle = (init: CognitionInit) => {
    const cognition = createCognition(init);
    let cognitionStep = 0;

    const envelopeFor = (stimulus: unknown): StimulusEnvelope =>
      activeEnvelope ?? {
        target: { characterId: init.characterId },
        stimulus: stimulus as never,
      };

    return {
      observe(stimulus: Stimulus) {
        cognition.observe(stimulus);
        emit("stimulus_observed", {
          characterId: init.characterId,
          archetype: init.archetype,
          envelope: envelopeFor(stimulus),
        });
      },
      tick(dt: number) {
        const signal = cognition.tick(dt);
        const snapshot = cognition.snapshot();
        cognitionStep++;
        emit("cognition_step", {
          characterId: init.characterId,
          archetype: init.archetype,
          cognitionStep,
          dtS: dt,
          elapsedCognitionS: cognitionStep * COGNITION_CADENCE_S,
          behaviorSignal: {
            affect: { ...signal.affect },
            behaviorBias: { ...signal.behaviorBias },
          },
          appliedBiases: { ...signal.behaviorBias },
          cognitionState: digestOpaqueCognitionState(snapshot),
        });
        return signal;
      },
      snapshot: () => cognition.snapshot(),
      restore: (state: Parameters<CognitionHandle["restore"]>[0]) =>
        cognition.restore(state),
    };
  };

  const makeCharacterHandle = (context: SpawnContext): CharacterHandle => {
    activeCharacters.push({
      registryId: context.registryId,
      characterId: context.characterId,
      archetype: context.entry.name,
    });
    emit("character_materialized", {
      characterId: context.characterId,
      registryId: context.registryId,
      archetype: context.entry.name,
      x: context.x,
      y: context.floorY,
    });

    let animation: CharacterState | null = null;
    let facingLeft: boolean | null = null;
    let airborne = false;
    let airbornePhase: "jump" | "fall" | null = null;

    return {
      setAnimation(next: CharacterState) {
        if (animation === next) return;
        emit("animation_changed", {
          characterId: context.characterId,
          archetype: context.entry.name,
          from: animation,
          to: next,
        });
        animation = next;
      },
      setTexture() {},
      setPosition() {},
      setFlip(nextFacingLeft: boolean) {
        if (facingLeft === nextFacingLeft) return;
        emit("facing_changed", {
          characterId: context.characterId,
          facing: nextFacingLeft ? "left" : "right",
        });
        facingLeft = nextFacingLeft;
      },
      setAirborneSprite(kind: "jump" | "fall" | null) {
        if (kind === "jump" && !airborne) {
          airborne = true;
          airbornePhase = "jump";
          emit("jump_started", {
            characterId: context.characterId,
            archetype: context.entry.name,
          });
          return;
        }
        if ((kind === "jump" || kind === "fall") && airbornePhase !== kind) {
          airbornePhase = kind;
          emit("jump_phase_changed", {
            characterId: context.characterId,
            phase: kind,
          });
        }
        if (kind === null && airborne) {
          airborne = false;
          airbornePhase = null;
          emit("jump_ended", { characterId: context.characterId });
        }
      },
      destroy() {
        emit("render_handle_destroyed", {
          characterId: context.characterId,
        });
      },
    };
  };

  const makeBubbleHandle = (
    _stage: unknown,
    text: string,
    owner: RenderOwner,
  ): BubbleHandle => {
    const reason = greetedCharacterIds.has(owner.characterId) ? "idle" : "greeting";
    greetedCharacterIds.add(owner.characterId);
    emit("bubble_started", {
      characterId: owner.characterId,
      reason,
      text,
    });

    return {
      setText() {},
      setVisibleChars() {},
      setPosition() {},
      destroy() {
        emit("bubble_ended", {
          characterId: owner.characterId,
          text,
        });
      },
    };
  };

  const makeEffectHandle = (kind: EffectKind): EffectHandle => {
    emit(kind === "spawn" ? "spawn_effect_started" : "despawn_effect_started");
    return {
      setTexture() {},
      setPosition() {},
      destroy() {
        emit(kind === "spawn" ? "spawn_effect_ended" : "despawn_effect_ended");
      },
    };
  };

  const registry = new CharacterRegistry({
    stage: null,
    manifest: [BASELINE_ASSET],
    loadedAssets: new Map([[BASELINE_ASSET.name, BASELINE_LOADED_ASSET]]),
    rng: spawnRng,
    schedulerRng: scriptedSchedulerRng,
    screenWidth: SCREEN_WIDTH_PX,
    floorY: FLOOR_Y_PX,
    createHandle: makeCharacterHandle,
    createBubbleHandle: makeBubbleHandle,
    createEffectHandle: makeEffectHandle,
    createCognitionHandle: makeCognitionHandle,
    createCharacterId: nextCharacterId,
    derivePersonalitySeed: (characterId, archetype) => {
      const seed = scenario.personalitySeeds?.[nextPersonalitySeedIndex++];
      return seed ?? derivePersonalitySeed(characterId, archetype);
    },
  });

  const recipientsFor = (envelope: StimulusEnvelope): string[] =>
    activeCharacters
      .filter(
        (character) =>
          envelope.target === "all" ||
          envelope.target.characterId === character.characterId,
      )
      .map((character) => character.characterId);

  const applyEvent = (event: ScheduledEvent): void => {
    if (event.kind === "spawn") {
      emit("spawn_requested");
      registry.spawn();
      return;
    }

    if (event.kind === "stimulus") {
      const { envelope } = scenario.stimuli?.[event.index] ?? {};
      if (!envelope) throw new Error("Scenario stimulus event is missing its envelope");
      emit("stimulus_dispatch", {
        envelope,
        recipientIds: recipientsFor(envelope),
      });
      activeEnvelope = envelope;
      registry.dispatch(envelope);
      activeEnvelope = null;
      return;
    }

    const despawn = scenario.despawns?.[event.index];
    if (!despawn) throw new Error("Scenario despawn event is missing its target");
    emit("despawn_requested", { target: despawn.target });

    if (despawn.target === "all") {
      const vanished = [...activeCharacters];
      registry.despawnAll();
      activeCharacters.length = 0;
      for (const character of vanished) {
        emit("character_vanished", {
          characterId: character.characterId,
          archetype: character.archetype,
        });
      }
      return;
    }

    const target =
      despawn.target === "oldest"
        ? activeCharacters[0]
        : despawn.target === "newest"
          ? activeCharacters[activeCharacters.length - 1]
          : activeCharacters.find((character) => character.registryId === despawn.target);
    if (!target) throw new Error("Scenario despawn target is not Materialized");

    activeEnvelope = {
      target: { characterId: target.characterId },
      stimulus: { kind: "lifecycle", phase: "vanishing" },
    };
    const vanished = registry.despawn(target.registryId);
    activeEnvelope = null;
    if (!vanished) throw new Error("Scenario despawn target is not Materialized");
    const targetIndex = activeCharacters.findIndex(
      (character) => character.characterId === target.characterId,
    );
    activeCharacters.splice(targetIndex, 1);
    emit("character_vanished", {
      characterId: target.characterId,
      archetype: target.archetype,
    });
  };

  const events = buildEventSchedule(scenario);
  const frameCount = Math.ceil(scenario.durationS * renderScheduleHz - TIME_EPSILON_S);
  let eventIndex = 0;

  const advanceClock = (targetS: number): void => {
    const dt = targetS - clockS;
    if (dt < -TIME_EPSILON_S) throw new Error("Scenario virtual clock moved backwards");
    if (dt <= TIME_EPSILON_S) {
      clockS = targetS;
      return;
    }
    clockS = targetS;
    registry.tick(dt);
  };

  for (renderTick = 0; renderTick < frameCount; renderTick++) {
    const frameEndS = Math.min(
      scenario.durationS,
      (renderTick + 1) / renderScheduleHz,
    );

    while (
      eventIndex < events.length &&
      events[eventIndex].atS <= frameEndS + TIME_EPSILON_S
    ) {
      const event = events[eventIndex];
      advanceClock(event.atS);
      applyEvent(event);
      eventIndex++;
    }

    advanceClock(frameEndS);
  }

  clockS = scenario.durationS;
  emit("scenario_completed", {
    traceRecords: trace.length + 1,
    activeCharacters: activeCharacters.map((character) => character.characterId),
  });

  return { scenario, renderScheduleHz, trace, traceWriter };
}
