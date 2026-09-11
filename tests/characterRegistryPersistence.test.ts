import { describe, expect, it, vi } from "vitest";
import { CharacterRegistry } from "../src/characterRegistry";
import { CharacterHandle } from "../src/character";
import {
  CharacterPersistenceRecord,
  CharacterPersistenceStore,
  verifyCharacterPersistenceRecord,
} from "../src/characterPersistence";
import { BehaviorSignal, CognitionHandle, CognitionInit, NEUTRAL_BEHAVIOR_SIGNAL } from "../src/cognition";

const ID_A = "0195c8f2-70aa-7cc2-99df-f2d3ba54c341";
const ID_B = "0195c8f2-70ab-7cc2-99df-f2d3ba54c342";

function handle(): CharacterHandle {
  return {
    setAnimation: vi.fn(), setTexture: vi.fn(), setPosition: vi.fn(),
    setFlip: vi.fn(), setAirborneSprite: vi.fn(), destroy: vi.fn(),
  };
}

const manifest = [{ name: "a", displayName: "A", idleFrames: 2, walkFrames: 2, frameWidth: 1, frameHeight: 1, idlePath: "", walkPath: "", jumpPath: "", fallPath: "" }];
const loaded = new Map([["a", { idleTextures: [null, null], walkTextures: [null, null], jumpTexture: null, fallTexture: nil() }]]);
function nil(): null { return null; }

function memoryStore() {
  const calls: string[] = [];
  const saved: CharacterPersistenceRecord[] = [];
  const store: CharacterPersistenceStore = {
    async save(record) {
      calls.push(`save:${record.characterId}:${record.metadata.writeCount}`);
      if (!(await verifyCharacterPersistenceRecord(record))) throw new Error("invalid integrity");
      saved.push(structuredClone(record));
    },
    async delete(characterId) { calls.push(`delete:${characterId}`); },
  };
  return { calls, saved, store };
}

function controlledCognition(snapshots: unknown[] = []) {
  let updates = 0;
  return (init: CognitionInit): CognitionHandle => ({
    observe: vi.fn(() => { updates++; }),
    toneSeed: () => NEUTRAL_BEHAVIOR_SIGNAL,
    tick: (_dt: number): BehaviorSignal => { updates++; return NEUTRAL_BEHAVIOR_SIGNAL; },
    noteExpression: vi.fn(),
    snapshot: () => ({ schemaVersion: 3, characterId: init.characterId, cognition: snapshots[updates] ?? { updates } }),
    restore: vi.fn(),
  });
}

function registry(
  ids: string[],
  store: CharacterPersistenceStore,
  cognition = controlledCognition(),
  withEffect = false,
) {
  const options = {
    stage: {},
    manifest,
    loadedAssets: loaded,
    rng: () => 0,
    screenWidth: 10,
    floorY: 0,
    createHandle: handle,
    createCognitionHandle: cognition,
    persistence: store,
    createCharacterId: () => ids.shift()!,
    onPersistenceError: (error) => console.error(error),
    ...(withEffect ? { createEffectHandle: () => ({
      setTexture: vi.fn(), setPosition: vi.fn(), destroy: vi.fn(),
    }) } : {}),
  };
  return new CharacterRegistry(options);
}

async function drain() {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe("CharacterRegistry durable lifecycle", () => {
  it("writes an initial record before a later update and keeps pending characters out", async () => {
    const { calls, saved, store } = memoryStore();
    const reg = registry([ID_A, ID_B], store, controlledCognition(), true);
    reg.spawn();
    reg.tick(0.8); // promote the first pending effect
    const initialIndex = calls.findIndex((call) => call.startsWith("save:"));
    expect(initialIndex).toBe(-1); // write is scheduled, not yet completed

    await drain();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      envelopeVersion: 1,
      characterId: ID_A,
      archetype: "a",
      personalitySeed: expect.any(Number),
      cognitionSnapshotVersion: 3,
      metadata: { writeCount: 1 },
    });

    reg.spawn(); // pending
    await drain();
    expect(saved).toHaveLength(1); // pending never gets a durable record
    expect(calls.filter((call) => call.startsWith("save:"))).toHaveLength(1);
  });

  it("autosaves only dirty characters at the accepted cadence", async () => {
    const { calls, saved, store } = memoryStore();
    const reg = registry([ID_A], store);
    reg.spawn();
    await drain();
    reg.tick(29.9);
    await drain();
    expect(saved).toHaveLength(1);

    reg.tick(0.2);
    await drain();
    expect(saved).toHaveLength(2);
    expect(saved[1].metadata.writeCount).toBe(2);
    expect(calls).toContain(`save:${ID_A}:2`);
  });

  it("deletes immediately on user despawn and does not write a farewell", async () => {
    const { calls, store } = memoryStore();
    const reg = registry([ID_A], store);
    reg.spawn();
    await drain();
    calls.length = 0;
    expect(reg.despawn(1)).toBe(true);
    await drain();
    expect(calls).toEqual([`delete:${ID_A}`]);
  });

  it("flushes a final snapshot on graceful shutdown", async () => {
    const { calls, saved, store } = memoryStore();
    const reg = registry([ID_A], store);
    reg.spawn();
    await drain();
    reg.tick(0.1); // make the character dirty
    await reg.flush("shutdown");
    expect(saved).toHaveLength(2);
    expect(saved[1].metadata.writeCount).toBe(2);
  });

  it("caps the live durable population", () => {
    const { store } = memoryStore();
    const ids = [ID_A, ID_B, ...Array.from({ length: 99 }, (_, i) => `0195c8f2-70aa-7cc2-99df-f2d3ba54c3${(i + 10).toString(16).padStart(2, "0")}`)];
    const reg = registry(ids, store);
    for (let i = 0; i < 99; i++) reg.spawn();
    expect(reg.count).toBe(99);
    reg.spawn();
    expect(reg.count).toBe(100);
    reg.spawn();
    expect(reg.count).toBe(100);
  });
});
