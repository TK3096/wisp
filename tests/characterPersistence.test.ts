import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHARACTER_PERSISTENCE_ENVELOPE_VERSION,
  MAX_DURABLE_CHARACTERS,
  createCharacterPersistenceRecord,
  verifyCharacterPersistenceRecord,
} from "../src/characterPersistence";

const base = {
  characterId: "0195c8f2-70aa-7cc2-98df-f2d3ba54c341",
  archetype: "mask-dude",
  personalitySeed: 123456,
  cognitionSnapshotVersion: 3,
  cognitionState: { opaque: true },
};

describe("character persistence envelope", () => {
  afterEach(() => vi.restoreAllMocks());

  it("creates a versioned bounded record with integrity data", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const record = await createCharacterPersistenceRecord({
      ...base,
      state: { opaque: true },
    });

    expect(record.envelopeVersion).toBe(CHARACTER_PERSISTENCE_ENVELOPE_VERSION);
    expect(record.characterId).toBe(base.characterId);
    expect(record.archetype).toBe(base.archetype);
    expect(record.personalitySeed).toBe(base.personalitySeed);
    expect(record.cognitionSnapshotVersion).toBe(3);
    expect(record.cognitionState).toEqual({ opaque: true });
    expect(record.metadata).toEqual({
      createdAtMs: 1_000,
      updatedAtMs: 1_000,
      writeCount: 1,
    });
    expect(record.integrity.algorithm).toBe("sha-256");
    expect(record.integrity.digest).toMatch(/^[0-9a-f]{64}$/);
    await expect(verifyCharacterPersistenceRecord(record)).resolves.toBe(true);
  });

  it("changes the digest when any protected field changes", async () => {
    const record = await createCharacterPersistenceRecord({ ...base, state: { value: 1 } });
    const tampered = { ...record, archetype: "ninja-frog" };
    await expect(verifyCharacterPersistenceRecord(tampered)).resolves.toBe(false);
  });

  it("rejects malformed identities and snapshots", async () => {
    await expect(
      createCharacterPersistenceRecord({ ...base, characterId: "not-a-uuid-v7" }),
    ).rejects.toThrow("Character Identity must be a UUIDv7");
    await expect(
      createCharacterPersistenceRecord({ ...base, cognitionSnapshotVersion: 2 }),
    ).rejects.toThrow("Cognition State schema");
    await expect(
      createCharacterPersistenceRecord({ ...base, archetype: "" }),
    ).rejects.toThrow("Archetype");
  });

  it("publishes the accepted durable population cap", () => {
    expect(MAX_DURABLE_CHARACTERS).toBe(100);
  });
});
