import { afterEach, describe, expect, it, vi } from "vitest";
import { CharacterRegistry } from "../src/characterRegistry";
import { CharacterHandle } from "../src/character";
import {
  CharacterPersistenceRecord,
  CharacterPersistenceStore,
  createCharacterPersistenceRecord,
  verifyCharacterPersistenceRecord,
} from "../src/characterPersistence";
import {
  BehaviorSignal,
  CognitionHandle,
  CognitionInit,
  PersistentCognitionState,
  NEUTRAL_BEHAVIOR_SIGNAL,
} from "../src/cognition";

const ID_A = "0195c8f2-70aa-7cc2-99df-f2d3ba54c341";
const ID_B = "0195c8f2-70ab-7cc2-99df-f2d3ba54c342";
const ID_C = "0195c8f2-70ac-7cc2-99df-f2d3ba54c343";

function handle(): CharacterHandle {
  return {
    setAnimation: vi.fn(),
    setTexture: vi.fn(),
    setPosition: vi.fn(),
    setFlip: vi.fn(),
    setAirborneSprite: vi.fn(),
    destroy: vi.fn(),
  };
}

const manifest = [{
  name: "a",
  displayName: "A",
  idleFrames: 2,
  walkFrames: 2,
  frameWidth: 1,
  frameHeight: 1,
  idlePath: "",
  walkPath: "",
  jumpPath: "",
  fallPath: "",
}];
const loaded = new Map([["a", {
  idleTextures: [null, null],
  walkTextures: [null, null],
  jumpTexture: null,
  fallTexture: null,
}]]);

async function record(
  characterId: string,
  overrides: Partial<CharacterPersistenceRecord> = {},
): Promise<CharacterPersistenceRecord> {
  const created = await createCharacterPersistenceRecord({
    characterId,
    archetype: "a",
    personalitySeed: 123,
    cognitionSnapshotVersion: 3,
    cognitionState: { opaque: characterId },
    nowMs: 1_000,
  });
  return { ...created, ...overrides };
}

type QuarantineArea = "future" | "corruption";

function restoreStore() {
  const quarantined: { record: unknown; area: QuarantineArea }[] = [];
  const store: CharacterPersistenceStore = {
    async save() {},
    async delete() {},
    async quarantine(record: unknown, area: QuarantineArea) {
      quarantined.push({ record: structuredClone(record), area });
    },
  };
  return { quarantined, store };
}

function controlledCognition(
  onRestore?: (init: CognitionInit, state: PersistentCognitionState) => void,
  restoreError?: Error,
) {
  return (init: CognitionInit): CognitionHandle => ({
    observe: vi.fn(),
    toneSeed: () => NEUTRAL_BEHAVIOR_SIGNAL,
    tick: vi.fn((_dt: number): BehaviorSignal => NEUTRAL_BEHAVIOR_SIGNAL),
    noteExpression: vi.fn(),
    snapshot: () => ({ schemaVersion: 3, characterId: init.characterId, cognition: null }),
    restore: vi.fn((state: PersistentCognitionState) => {
      onRestore?.(init, state);
      if (restoreError) throw restoreError;
    }),
  });
}

function registry(
  store: CharacterPersistenceStore,
  cognition: (init: CognitionInit) => CognitionHandle = controlledCognition(),
) {
  return new CharacterRegistry({
    stage: {},
    manifest,
    loadedAssets: loaded,
    rng: vi.fn(() => 0.25),
    screenWidth: 10,
    floorY: 0,
    createHandle: handle,
    createCognitionHandle: cognition,
    persistence: store,
    createCharacterId: () => ID_A,
  });
}

async function drain() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("CharacterRegistry safe restore", () => {
  afterEach(() => vi.restoreAllMocks());

  it("restores valid records in identity order and quarantines versions and corruption", async () => {
    const { quarantined, store } = restoreStore();
    const restoredStates: unknown[] = [];
    const cognition = controlledCognition((_init, state) => {
      restoredStates.push(state);
    });
    const validA = await record(ID_A);
    const validB = await record(ID_B);
    const future = {
      ...(await record(ID_C)),
      envelopeVersion: 2,
    };
    const corrupt = { ...(await record(ID_A)), archetype: "tampered" };
    const reg = registry(store, cognition);
    const changes: number[][] = [];
    const onChange = (items: { id: number }[]) => changes.push(items.map(({ id }) => id));
    (reg as unknown as { opts: { onChange?: typeof onChange } }).opts.onChange = onChange;

    await expect(reg.restore([validA, future, corrupt, validB])).resolves.toBe(2);

    expect(reg.count).toBe(2);
    expect((reg as any).entries.map((entry: { characterId: string }) => entry.characterId)).toEqual([ID_A, ID_B]);
    expect(restoredStates).toEqual([{ opaque: ID_A }, { opaque: ID_B }]);
    expect(quarantined).toEqual([
      { record: future, area: "future" },
      { record: corrupt, area: "corruption" },
    ]);
    expect(changes).toEqual([[1, 2]]);
    expect(reg.snapshot()).toEqual([{ id: 1, label: "A #1" }, { id: 2, label: "A #2" }]);
  });

  it("quarantines mismatched durable fields and unsupported versions", async () => {
    const cases = await Promise.all([
      { name: "identity", value: { ...(await record(ID_A)), characterId: ID_B } },
      { name: "archetype", value: { ...(await record(ID_A)), archetype: "unknown" } },
      { name: "seed", value: { ...(await record(ID_A)), personalitySeed: -1 } },
      { name: "metadata", value: {
        ...(await record(ID_A)),
        metadata: { createdAtMs: 2, updatedAtMs: 1, writeCount: 1 },
      } },
      { name: "checksum", value: { ...(await record(ID_A)), integrity: {
        algorithm: "sha-256",
        digest: "0".repeat(64),
      } } },
    ]);

    for (const { value } of cases) {
      const { quarantined, store } = restoreStore();
      const reg = registry(store);
      await expect(reg.restore([value])).resolves.toBe(0);
      expect(reg.count).toBe(0);
      expect(quarantined).toEqual([{ record: value, area: "corruption" }]);
    }

    const { quarantined, store } = restoreStore();
    const unsupported = {
      ...(await record(ID_A)),
      cognitionSnapshotVersion: 2,
    };
    await registry(store).restore([unsupported]);
    expect(quarantined).toEqual([{ record: unsupported, area: "future" }]);
  });

  it("rejects an unknown opaque snapshot through the cognition boundary", async () => {
    const { quarantined, store } = restoreStore();
    const value = await record(ID_A);
    const reg = registry(store, controlledCognition(undefined, new Error("unknown state")));

    await expect(reg.restore([value])).resolves.toBe(0);
    expect(reg.count).toBe(0);
    expect((reg as any).effects).toHaveLength(0);
    expect(quarantined).toEqual([{ record: value, area: "corruption" }]);
  });

  it("starts transient state fresh and does not replay offline cognition time", async () => {
    const { store } = restoreStore();
    const createBubble = vi.fn();
    const reg = registry(store);
    (reg as any).opts.createBubbleHandle = createBubble;
    const value = await record(ID_A);

    await reg.restore([value]);
    const entry = (reg as any).entries[0];
    expect(entry.rollTimer).toBe(30);
    expect(entry.jumpRollTimer).toBe(20);
    expect(entry.char.airborne).toBe(false);
    reg.tick(0.099);
    expect(entry.cognition.tick).not.toHaveBeenCalled();
    expect(createBubble).not.toHaveBeenCalled();

    reg.tick(0.001);
    expect(entry.cognition.tick).toHaveBeenCalledTimes(1);
    expect(entry.cognition.tick).toHaveBeenCalledWith(0.1);
  });

  it("round-trips materialization, throttle, shutdown, restore, and despawn", async () => {
    const saved: CharacterPersistenceRecord[] = [];
    const calls: string[] = [];
    const store: CharacterPersistenceStore = {
      async save(input) {
        calls.push(`save:${input.characterId}:${input.metadata.writeCount}`);
        expect(await verifyCharacterPersistenceRecord(input)).toBe(true);
        saved.push(structuredClone(input));
      },
      async delete(characterId) {
        calls.push(`delete:${characterId}`);
      },
      async quarantine() {},
    };
    const first = registry(store, controlledCognition());
    first.spawn();
    await first.tick(0.1);
    await drain();
    first.tick(30.01);
    await first.flush("shutdown");
    expect(saved).toHaveLength(2);
    expect(saved[0].metadata.writeCount).toBe(1);

    first.tick(0.1);
    await first.flush("shutdown");
    expect(saved).toHaveLength(3);
    expect(saved[2].metadata.writeCount).toBe(3);

    const secondCognition = controlledCognition();
    const second = registry(store, secondCognition);
    await second.restore([saved[2]]);
    second.tick(0.1);
    await second.flush("shutdown");
    expect(saved).toHaveLength(4);
    expect(saved[3].characterId).toBe(ID_A);
    expect(saved[3].metadata.createdAtMs).toBe(saved[2].metadata.createdAtMs);

    second.despawn(1);
    await drain();
    expect(calls.at(-1)).toBe(`delete:${ID_A}`);
  });
});
