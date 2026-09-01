import { AssetEntry, BUBBLE, EFFECT, GREETINGS, IDLE_LINES, JUMP } from "./config";
import {
  Character,
  CharacterHandle,
  CharacterConfig,
} from "./character";
import { BubbleHandle, Bubble } from "./bubble";
import { Effect, EffectHandle, EffectKind } from "./effect";
import { LoadedAsset } from "./simulationAsset";
import {
  COGNITION_CADENCE_S,
  COGNITION_CADENCE_EPSILON_S,
  COGNITION_SCHEMA_VERSION,
  MAX_COGNITION_CATCHUP_STEPS,
  BehaviorSignal,
  CognitionHandle,
  CognitionInit,
  NEUTRAL_BEHAVIOR_SIGNAL,
  PersistentCognitionState,
  ToneSeed,
  StimulusEnvelope,
  createNeutralCognitionHandle,
  derivePersonalitySeed,
  validateStimulusEnvelope,
} from "./cognition";
import {
  CognitionDebugSnapshot,
  CognitionDebugStimulus,
  projectCognitionDebugSnapshot,
} from "./cognitionDebugSnapshot";
import { TaggedLine, selectTaggedLine } from "./speech";
import {
  CHARACTER_AUTOSAVE_INTERVAL_S,
  MAX_CHARACTER_PERSISTENCE_BYTES,
  CharacterPersistenceQuarantineArea,
  CharacterPersistenceRecord,
  CharacterPersistenceStore,
  MAX_DURABLE_CHARACTERS,
  PersistenceReason,
  characterPersistenceRecordSize,
  classifyCharacterPersistenceRecord,
  createCharacterPersistenceRecord,
  isBoundedPersonalitySeed,
  verifyCharacterPersistenceRecord,
} from "./characterPersistence";

export interface RenderOwner {
  registryId: number;
  characterId: string;
}

export interface SpawnContext {
  entry: AssetEntry;
  loaded: LoadedAsset;
  stage: unknown;
  x: number;
  floorY: number;
  registryId: number;
  characterId: string;
}

export interface RegistryOptions {
  stage: unknown;
  manifest: AssetEntry[];
  loadedAssets: Map<string, LoadedAsset>;
  rng: () => number;
  screenWidth: number;
  floorY: number;
  /**
   * Factory for creating a CharacterHandle.
   * Defaults to an inert headless handle; production wires the Pixi factory.
   */
  createHandle?: (ctx: SpawnContext) => CharacterHandle;
  /**
   * Factory for creating a BubbleHandle given the stage and text.
   * When undefined, no bubble is injected and say() is a no-op.
   * Override in tests with a fake to avoid Pixi imports.
   */
  createBubbleHandle?: (
    stage: unknown,
    text: string,
    owner: RenderOwner,
  ) => BubbleHandle;
  /**
   * Called after every mutation (spawn, despawn, despawnAll) with a full
   * snapshot of the live character list. Use to sync external state (e.g.
   * the Tauri tray submenu). Omit in tests or when no external sync needed.
   */
  onChange?: (items: { id: number; label: string }[]) => void;
  /**
   * Factory for creating an EffectHandle for a given kind (spawn/despawn).
   * When undefined, no visual effect is produced on spawn or despawn.
   * Override in tests with a fake to avoid Pixi imports.
   */
  createEffectHandle?: (kind: EffectKind) => EffectHandle;
  /**
   * Factory for a character-scoped cognition seam. The default is neutral;
   * production may later inject a WASM-backed facade without changing the
   * simulation's rendering or shell dependencies.
   */
  createCognitionHandle?: (init: CognitionInit) => CognitionHandle;
  /** Separate deterministic stream for idle-bubble and jump scheduler draws. */
  schedulerRng?: () => number;
  /**
   * The sole identity seam. The native shell supplies production identities;
   * tests and replays inject deterministic opaque IDs.
   */
  createCharacterId: () => string | Promise<string>;
  /** Injected durable-record sink; production uses the native atomic store. */
  persistence?: CharacterPersistenceStore;
  /** Operational error reporting; persistence failures never break the render loop. */
  onPersistenceError?: (error: unknown) => void;
  /** Operational error reporting; identity failures never break the render loop. */
  onIdentityError?: (error: unknown) => void;
  /** Wall clock belongs only to durable metadata, never Cognition cadence. */
  nowMs?: () => number;
  /**
   * Deterministic Personality Seed source for replays. Production derives it
   * from the stable Character Identity and Archetype.
   */
  derivePersonalitySeed?: (characterId: string, archetype: string) => number;
}

function createInertCharacterHandle(): CharacterHandle {
  return {
    setAnimation() {},
    setTexture() {},
    setPosition() {},
    setFlip() {},
    setAirborneSprite() {},
    destroy() {},
  };
}

type ResolvedOptions = RegistryOptions & {
  createHandle: (ctx: SpawnContext) => CharacterHandle;
  createCognitionHandle: (init: CognitionInit) => CognitionHandle;
};

interface CharEntry {
  char: Character;
  id: number;
  /** Stable opaque Character Identity used by cognition and future persistence. */
  characterId: string;
  archetype: string;
  personalitySeed: number;
  displayName: string;
  cognition: CognitionHandle;
  /** Render time not yet consumed by a fixed cognition step. */
  cognitionAccumulator: number;
  /** Latest bounded Behavior Signal; null until the first fixed step. */
  latestSignal: BehaviorSignal | null;
  /** Latest semantic Stimulus accepted by this Materialized character. */
  latestStimulus: CognitionDebugStimulus | null;
  /** Virtual time at which the latest fixed cognition step completed. */
  lastCognitionAtS: number;
  /** Seconds until this character's next idle-line roll. */
  rollTimer: number;
  /** Seconds until this character's next jump roll. */
  jumpRollTimer: number;
  dirty: boolean;
  dirtyGeneration: number;
  persistenceWriteCount: number;
  persistedCreatedAtMs: number;
  nextAutosaveAtS: number;
  persistenceQueue: Promise<void> | null;
}

interface PendingSpawn {
  entry: AssetEntry;
  loaded: LoadedAsset;
  x: number;
  effect: Effect;
}

export class CharacterRegistry {
  private readonly entries: CharEntry[] = [];
  private readonly effects: Effect[] = [];
  private readonly pending: PendingSpawn[] = [];
  private readonly opts: ResolvedOptions;
  /** Total elapsed seconds since the registry was created. */
  private elapsed = 0;
  /** Elapsed time at which the last bubble was emitted (idle rolls only). */
  private lastBubbleAt = -Infinity;
  /** Monotonically increasing ID counter; never resets within a session. */
  private nextId = 1;

  constructor(opts: RegistryOptions) {
    this.opts = {
      createHandle: createInertCharacterHandle,
      createCognitionHandle: createNeutralCognitionHandle,
      ...opts,
    };
  }

  get count(): number {
    return this.entries.length;
  }

  /** Returns the current live character list in insertion order. */
  snapshot(): { id: number; label: string }[] {
    return this.entries.map((e) => ({
      id: e.id,
      label: `${e.displayName} #${e.id}`,
    }));
  }

  /** Resolve a shell-selected registry ID to its stable Cognition target. */
  characterIdFor(registryId: number): string | null {
    return (
      this.entries.find((entry) => entry.id === registryId)?.characterId ?? null
    );
  }

  /**
   * Read-only, bounded development inspection surface. Pending and Vanishing
   * characters are intentionally absent, and no opaque Cognition State leaves
   * the Cognition Handle boundary.
   */
  debugSnapshots(): CognitionDebugSnapshot[] {
    return this.entries.map((entry) =>
      projectCognitionDebugSnapshot({
        registryId: entry.id,
        characterId: entry.characterId,
        archetype: entry.archetype,
        label: `${entry.displayName} #${entry.id}`,
        signal: entry.latestSignal,
        latestStimulus: entry.latestStimulus,
        cadenceLagS: this.elapsed - entry.lastCognitionAtS,
      }),
    );
  }

  /** Deliver one envelope to eligible Materialized characters in registry order. */
  dispatch(envelope: StimulusEnvelope): void {
    validateStimulusEnvelope(envelope);
    for (const entry of this.entries) {
      const matches =
        envelope.target === "all" ||
        envelope.target.characterId === entry.characterId;
      if (matches) {
        entry.cognition.observe(envelope.stimulus);
        this.markDirty(entry);
        if (entry.dirty) {
          entry.nextAutosaveAtS = Math.min(
            entry.nextAutosaveAtS,
            this.elapsed + CHARACTER_AUTOSAVE_INTERVAL_S,
          );
        }
      }
      if (matches) {
        entry.latestStimulus = {
          observedAtS: this.elapsed,
          stimulus: { ...envelope.stimulus },
        };
      }
    }
  }

  /**
   * Removes the character with the given ID.
   * Returns true on success, false if the ID is not found (silent no-op).
   */
  despawn(id: number): boolean {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx === -1) return false;
    const { char, characterId, persistenceQueue } = this.entries[idx];
    // A user deletion is authoritative. Do not enqueue a farewell snapshot.
    void persistenceQueue?.catch(() => undefined);
    const persistence = this.opts.persistence;
    if (persistence) {
      void persistence.delete(characterId);
      if (persistenceQueue) {
        void persistenceQueue.finally(() => persistence.delete(characterId));
      }
    }
    this.observeVanishing(this.entries[idx]);
    const x = char.x;
    const y = char.renderY;
    char.destroy();
    this.entries.splice(idx, 1);
    this.pushEffect("despawn", x, y);
    this.opts.onChange?.(this.snapshot());
    return true;
  }

  spawn(): void {
    const { manifest, loadedAssets, rng, screenWidth, floorY, createEffectHandle } = this.opts;

    if (this.entries.length + this.pending.length >= MAX_DURABLE_CHARACTERS) return;
    const entry = manifest[Math.floor(rng() * manifest.length)];
    const loaded = loadedAssets.get(entry.name)!;
    const x = rng() * screenWidth;

    if (createEffectHandle) {
      // Deferred: push to pending — Character constructed on effect expiry.
      const handle = createEffectHandle("spawn");
      const effect = new Effect(handle, EFFECT.FPS, EFFECT.FRAME_COUNT);
      effect.setPosition(x, floorY);
      this.pending.push({ entry, loaded, x, effect });
      // No onChange — character is not yet visible in the tray.
    } else {
      // Immediate: construct character now (backward-compat when no effect factory).
      const materializedSynchronously = this.materializeResolved(
        entry,
        loaded,
        x,
        this.opts.createCharacterId(),
      );
      if (materializedSynchronously) this.opts.onChange?.(this.snapshot());
    }
  }

  /**
   * Construct a Character from resolved asset data, push it into entries[],
   * and fire a greeting bubble. Does NOT emit onChange — callers handle that.
   */
  private materializeResolved(
    entry: AssetEntry,
    loaded: LoadedAsset,
    x: number,
    identity: string | Promise<string>,
    onMaterialized?: () => void,
  ): boolean {
    if (identity instanceof Promise) {
      void identity.then(
        (characterId) => {
          this.materializeEntry(entry, loaded, x, characterId);
          onMaterialized?.();
        },
        (error) => this.opts.onIdentityError?.(error),
      );
      return false;
    }
    this.materializeEntry(entry, loaded, x, identity);
    return true;
  }

  private materializeEntry(
    entry: AssetEntry,
    loaded: LoadedAsset,
    x: number,
    characterId: string,
    restored?: CharacterPersistenceRecord,
  ): CharEntry | null {
    const {
      rng,
      stage,
      floorY,
      screenWidth,
      createHandle,
      createBubbleHandle,
      createCognitionHandle,
      derivePersonalitySeed: deriveSeed,
    } = this.opts;

    const id = this.nextId;

    const handle = createHandle({
      entry,
      loaded,
      stage,
      x,
      floorY,
      registryId: id,
      characterId,
    });

    const createBubble = createBubbleHandle
      ? (text: string): Bubble =>
          new Bubble(
            text,
            createBubbleHandle(stage, text, { registryId: id, characterId }),
            BUBBLE.TYPING_SPEED_CPS,
            BUBBLE.LINGER_S,
            BUBBLE.MAX_DURATION_S,
          )
      : undefined;

    const cfg: Partial<CharacterConfig> = {
      rng,
      floorLeft: 0,
      floorRight: screenWidth,
      createBubble,
    };

    const character = new Character(
      { x, y: floorY, facing: "right", handle },
      entry.idleFrames,
      entry.walkFrames,
      cfg,
    );

    const personalitySeed = restored?.personalitySeed
      ?? deriveSeed?.(characterId, entry.name)
      ?? derivePersonalitySeed(characterId, entry.name);
    const cognition = createCognitionHandle({
      schemaVersion: COGNITION_SCHEMA_VERSION,
      characterId,
      archetype: entry.name,
      personalitySeed,
    });

    let pendingInitialState: PersistentCognitionState | null = null;

    if (restored) {
      try {
        cognition.restore(restored.cognitionState as PersistentCognitionState);
      } catch {
        character.destroy();
        return null;
      }
    } else {
      // The initial read-only projection establishes personality/affect for
      // tone selection without advancing the Temporal Derivative or cadence.
      const initialState = this.opts.persistence ? cognition.snapshot() : null;
      const toneSeed = cognition.toneSeed();
      const greetingRoll = rng();
      this.sayTagged(character, cognition, GREETINGS, toneSeed, greetingRoll);
      if (initialState) {
        pendingInitialState = initialState;
      }
    }

    // Fixed initial roll timers so characters don't lock-step on the first roll.
    const newEntry: CharEntry = {
      char: character,
      id,
      characterId,
      archetype: entry.name,
      personalitySeed,
      displayName: entry.displayName,
      cognition,
      cognitionAccumulator: 0,
      latestSignal: null,
      latestStimulus: null,
      lastCognitionAtS: this.elapsed,
      rollTimer: BUBBLE.PER_CHAR_AVG_INTERVAL_S,
      jumpRollTimer: JUMP.PER_CHAR_AVG_INTERVAL_S,
      dirty: false,
      dirtyGeneration: 0,
      persistenceWriteCount: restored?.metadata.writeCount ?? 0,
      persistedCreatedAtMs: restored?.metadata.createdAtMs ?? 0,
      nextAutosaveAtS: this.elapsed + CHARACTER_AUTOSAVE_INTERVAL_S,
      persistenceQueue: null,
    };
    this.entries.push(newEntry);
    if (pendingInitialState) {
      this.enqueuePersistence(newEntry, "materialization", pendingInitialState);
    }
    this.dispatch({
      target: { characterId },
      stimulus: { kind: "lifecycle", phase: "materialized" },
    });
    if (!restored) {
      newEntry.dirty = true;
      newEntry.dirtyGeneration++;
      newEntry.nextAutosaveAtS = this.elapsed + CHARACTER_AUTOSAVE_INTERVAL_S;
    } else {
      // The restored Materialized lifecycle stimulus itself is a durable update.
      this.markDirty(newEntry);
      newEntry.nextAutosaveAtS = this.elapsed + CHARACTER_AUTOSAVE_INTERVAL_S;
    }
    this.nextId += 1;
    return newEntry;
  }

  /** Restores only structurally and semantically safe durable records. */
  async restore(records?: readonly unknown[]): Promise<number> {
    const input = records ?? await this.opts.persistence?.load?.() ?? [];
    const quarantine = this.opts.persistence?.quarantine?.bind(this.opts.persistence);
    const quarantineRecord = async (
      record: unknown,
      area: CharacterPersistenceQuarantineArea,
    ): Promise<void> => {
      if (!quarantine) return;
      try {
        await quarantine(structuredClone(record), area);
      } catch (error) {
        this.opts.onPersistenceError?.(error);
      }
    };

    const candidates: CharacterPersistenceRecord[] = [];
    for (const record of input) {
      const classification = classifyCharacterPersistenceRecord(record);
      if (classification === "current") {
        candidates.push(record as CharacterPersistenceRecord);
      } else {
        await quarantineRecord(record, classification === "future" ? "future" : "corruption");
      }
    }

    candidates.sort((left, right) =>
      left.characterId < right.characterId ? -1 : left.characterId > right.characterId ? 1 : 0,
    );

    const manifestEntries = new Map(this.opts.manifest.map((entry) => [entry.name, entry]));
    const restoredIdentities = new Set<string>();
    let restoredCount = 0;
    for (const record of candidates) {
      if (this.entries.length + this.pending.length + restoredCount >= MAX_DURABLE_CHARACTERS) {
        this.opts.onPersistenceError?.(new Error("Durable character population is full"));
        continue;
      }
      if (restoredIdentities.has(record.characterId)) {
        await quarantineRecord(record, "corruption");
        continue;
      }
      if (
        !(await verifyCharacterPersistenceRecord(record)) ||
        characterPersistenceRecordSize(record) > MAX_CHARACTER_PERSISTENCE_BYTES
      ) {
        await quarantineRecord(record, "corruption");
        continue;
      }
      const entry = manifestEntries.get(record.archetype);
      const seedValid = isBoundedPersonalitySeed(record.personalitySeed) &&
        record.cognitionSnapshotVersion === COGNITION_SCHEMA_VERSION;
      if (!entry || !seedValid) {
        await quarantineRecord(record, "corruption");
        continue;
      }

      const loaded = this.opts.loadedAssets.get(entry.name);
      if (!loaded) {
        this.opts.onPersistenceError?.(new Error("Archetype assets are not loaded"));
        continue;
      }

      const x = this.opts.rng() * this.opts.screenWidth;
      let restored: CharEntry | null;
      try {
        restored = this.materializeEntry(
          entry,
          loaded,
          x,
          record.characterId,
          record,
        );
      } catch (error) {
        this.opts.onPersistenceError?.(error);
        continue;
      }
      if (!restored) {
        // Only an unknown opaque snapshot reaches this path; the Cognition
        // Handle rejected it, so the intact envelope is never inferred.
        await quarantineRecord(record, "corruption");
        continue;
      }

      restoredIdentities.add(record.characterId);
      restoredCount++;
    }

    if (restoredCount > 0) this.opts.onChange?.(this.snapshot());
    return restoredCount;
  }

  async flush(reason: PersistenceReason = "shutdown"): Promise<void> {
    // Drain writes that were scheduled first, preserving the initial-write
    // ordering. Only characters still dirty need a final shutdown snapshot.
    await Promise.all(this.entries.map((entry) => entry.persistenceQueue));
    const dirty = this.entries.filter((entry) => entry.dirty);
    await Promise.all(dirty.map((entry) => this.enqueuePersistence(entry, reason)));
    await Promise.all(dirty.map((entry) => entry.persistenceQueue));
  }

  private markDirty(entry: CharEntry): void {
    if (!this.opts.persistence) return;
    entry.dirty = true;
    entry.dirtyGeneration++;
  }

  private enqueuePersistence(
    entry: CharEntry,
    _reason: PersistenceReason,
    stateOverride?: PersistentCognitionState,
  ): Promise<void> {
    const persistence = this.opts.persistence;
    if (!persistence) return Promise.resolve();
    const previous = entry.persistenceQueue ?? Promise.resolve();
    const nowMs = (this.opts.nowMs ?? Date.now)();
    const createdAtMs = entry.persistedCreatedAtMs || nowMs;
    const writeCount = entry.persistenceWriteCount + 1;
    const operation = previous.then(async () => {
      const state = stateOverride ?? entry.cognition.snapshot();
      const generationAtSnapshot = entry.dirtyGeneration;
      const record = await createCharacterPersistenceRecord({
        characterId: entry.characterId,
        archetype: entry.archetype,
        personalitySeed: entry.personalitySeed,
        cognitionSnapshotVersion: COGNITION_SCHEMA_VERSION,
        cognitionState: state,
        createdAtMs,
        writeCount,
      });
      await persistence.save(record as CharacterPersistenceRecord);
      if (generationAtSnapshot === entry.dirtyGeneration) {
        entry.dirty = false;
        entry.nextAutosaveAtS = this.elapsed + CHARACTER_AUTOSAVE_INTERVAL_S;
      }
      entry.persistenceWriteCount = writeCount;
      entry.persistedCreatedAtMs = createdAtMs;
    });
    const tracked = operation.catch((error) => this.opts.onPersistenceError?.(error));
    void tracked.finally(() => {
      if (entry.persistenceQueue === tracked) entry.persistenceQueue = null;
    });
    entry.persistenceQueue = tracked;
    return operation;
  }

  despawnAll(): void {
    // Cancel any pending spawns silently — no despawn effect for un-materialized characters.
    for (const p of this.pending) p.effect.destroy();
    this.pending.length = 0;

    for (const entry of this.entries) {
      this.observeVanishing(entry);
      const x = entry.char.x;
      const y = entry.char.renderY;
      entry.char.destroy();
      this.pushEffect("despawn", x, y);
    }
    this.entries.length = 0;
    this.opts.onChange?.([]);
  }

  /** Trigger a jump on every live character. Already-airborne characters are unaffected (no-op). */
  jumpAll(): void {
    for (const entry of this.entries) {
      entry.char.jump();
    }
  }

  private pushEffect(kind: EffectKind, x: number, y: number): void {
    const handle = this.opts.createEffectHandle?.(kind);
    if (!handle) return;
    const effect = new Effect(handle, EFFECT.FPS, EFFECT.FRAME_COUNT);
    effect.setPosition(x, y);
    this.effects.push(effect);
  }

  private observeVanishing(entry: CharEntry): void {
    this.dispatch({
      target: { characterId: entry.characterId },
      stimulus: { kind: "lifecycle", phase: "vanishing" },
    });
  }

  /**
   * Select and emit one tagged expression. Every expression—greeting or
   * idle—passes through the same active-bubble, cooldown, and reward seams.
   */
  private sayTagged(
    character: Character,
    cognition: CognitionHandle,
    lines: readonly TaggedLine[],
    toneSeed: Pick<ToneSeed, "personality" | "affect">,
    roll: number,
  ): void {
    if (this.elapsed - this.lastBubbleAt < BUBBLE.GLOBAL_COOLDOWN_S) return;

    const line = selectTaggedLine(lines, toneSeed, roll);
    if (!character.say(line.text)) return;

    cognition.noteExpression();
    this.lastBubbleAt = this.elapsed;
  }

  tick(dt: number): void {
    if (!Number.isFinite(dt) || dt < 0) {
      throw new Error("Registry dt must be finite and non-negative");
    }
    this.elapsed += dt;
    const { rng, schedulerRng } = this.opts;
    const behaviorRng = schedulerRng ?? rng;

    // Advance live (despawn) effects and remove expired ones.
    for (const e of this.effects) e.tick(dt);
    for (let i = this.effects.length - 1; i >= 0; i--) {
      if (this.effects[i].expired) this.effects.splice(i, 1);
    }

    // Advance pending spawn effects; collect expired ones for promotion.
    for (const p of this.pending) p.effect.tick(dt);
    const toPromote: PendingSpawn[] = [];
    const stillPending: PendingSpawn[] = [];
    for (const p of this.pending) {
      if (p.effect.expired) toPromote.push(p);
      else stillPending.push(p);
    }
    this.pending.length = 0;
    for (const p of stillPending) this.pending.push(p);

    // Materialize promoted characters and emit a single batched onChange.
    let synchronouslyMaterialized = 0;
    for (const p of toPromote) {
      const materializedNow = this.materializeResolved(
        p.entry,
        p.loaded,
        p.x,
        this.opts.createCharacterId(),
        () => this.opts.onChange?.(this.snapshot()),
      );
      if (materializedNow) synchronouslyMaterialized++;
    }
    if (synchronouslyMaterialized > 0) this.opts.onChange?.(this.snapshot());

    for (const entry of this.entries) {
      entry.cognitionAccumulator += dt;
      let cognitionSteps = 0;
      while (
        entry.cognitionAccumulator >=
          COGNITION_CADENCE_S - COGNITION_CADENCE_EPSILON_S &&
        cognitionSteps < MAX_COGNITION_CATCHUP_STEPS
      ) {
        const signal = entry.cognition.tick(COGNITION_CADENCE_S);
        entry.char.applyBehaviorSignal(signal);
        entry.latestSignal = signal;
        entry.cognitionAccumulator -= COGNITION_CADENCE_S;
        entry.lastCognitionAtS = this.elapsed - entry.cognitionAccumulator;
        cognitionSteps++;
      }
      if (cognitionSteps === MAX_COGNITION_CATCHUP_STEPS) {
        entry.cognitionAccumulator = 0;
      }
      if (cognitionSteps > 0) this.markDirty(entry);

      entry.char.tick(dt);

      entry.rollTimer -= dt;
      if (entry.rollTimer <= 0) {
        // Always schedule the next roll, whether or not this one fires.
        entry.rollTimer =
          BUBBLE.PER_CHAR_AVG_INTERVAL_S -
          BUBBLE.PER_CHAR_JITTER_S +
          behaviorRng() * (2 * BUBBLE.PER_CHAR_JITTER_S);

        if (entry.char.shouldSpeakOnRoll(behaviorRng)) {
          const toneSeed = entry.latestSignal ?? NEUTRAL_BEHAVIOR_SIGNAL;
          const lineRoll = behaviorRng();
          this.sayTagged(
            entry.char,
            entry.cognition,
            IDLE_LINES,
            toneSeed,
            lineRoll,
          );
        }
      }

      entry.jumpRollTimer -= dt;
      if (entry.jumpRollTimer <= 0) {
        // Always reschedule with jitter. jump() is a no-op if already airborne — no special skip needed.
        entry.jumpRollTimer =
          JUMP.PER_CHAR_AVG_INTERVAL_S -
          JUMP.PER_CHAR_JITTER_S +
          behaviorRng() * (2 * JUMP.PER_CHAR_JITTER_S);

        if (entry.char.shouldJumpOnRoll(behaviorRng)) entry.char.jump();
      }

      if (
        entry.dirty &&
        this.elapsed >= entry.nextAutosaveAtS &&
        entry.persistenceQueue === null
      ) {
        this.enqueuePersistence(entry, "autosave");
      }
    }
  }
}
