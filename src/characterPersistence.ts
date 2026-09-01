/** Version of the durable Character State envelope itself. */
export const CHARACTER_PERSISTENCE_ENVELOPE_VERSION = 1;
/** Accepted maximum durable population for the experimental single-window app. */
export const MAX_DURABLE_CHARACTERS = 100;
/** Accepted upper bound for one serialized durable record. */
export const MAX_CHARACTER_PERSISTENCE_BYTES = 256 * 1024;
/** Accepted dirty-snapshot cadence. Initial and user-driven writes bypass it. */
export const CHARACTER_AUTOSAVE_INTERVAL_S = 30;
/** Hard upper bound that prevents a corrupt envelope from becoming unbounded. */
const MAX_METADATA_WRITE_COUNT = 1_000_000;
/** Snapshot schema accepted by the current durable envelope. */
const COGNITION_SNAPSHOT_VERSION = 3;

export interface CharacterPersistenceMetadata {
  createdAtMs: number;
  updatedAtMs: number;
  writeCount: number;
}

export interface CharacterPersistenceIntegrity {
  algorithm: "sha-256";
  digest: string;
}

export interface CharacterPersistenceRecord {
  envelopeVersion: typeof CHARACTER_PERSISTENCE_ENVELOPE_VERSION;
  characterId: string;
  archetype: string;
  personalitySeed: number;
  cognitionSnapshotVersion: number;
  /** Opaque to TypeScript; validated by the cognition facade on restore. */
  cognitionState: unknown;
  metadata: CharacterPersistenceMetadata;
  integrity: CharacterPersistenceIntegrity;
}

export interface CharacterPersistenceRecordInput {
  characterId: string;
  archetype: string;
  personalitySeed: number;
  cognitionSnapshotVersion: number;
  cognitionState: unknown;
  createdAtMs?: number;
  writeCount?: number;
  nowMs?: number;
}

/** Deterministic, stable encoding shared by TypeScript and the native store. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

export function isUuidV7(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value,
  );
}

export function isBoundedPersonalitySeed(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= 0xffffffff
  );
}

/** Integrity covers every protected durable field, not renderer metadata. */
async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function protectedPayload(
  record: Omit<CharacterPersistenceRecord, "integrity">,
): unknown {
  return {
    archetype: record.archetype,
    characterId: record.characterId,
    cognitionSnapshotVersion: record.cognitionSnapshotVersion,
    cognitionState: record.cognitionState,
    envelopeVersion: record.envelopeVersion,
    metadata: record.metadata,
    personalitySeed: record.personalitySeed,
  };
}

export async function createCharacterPersistenceRecord(
  input: CharacterPersistenceRecordInput,
): Promise<CharacterPersistenceRecord> {
  const nowMs = input.nowMs ?? Date.now();
  const createdAtMs = input.createdAtMs ?? nowMs;
  const writeCount = input.writeCount ?? 1;
  if (!isUuidV7(input.characterId)) {
    throw new Error("Character Identity must be a UUIDv7");
  }
  if (input.archetype.trim() === "") {
    throw new Error("Archetype must not be empty");
  }
  if (!isBoundedPersonalitySeed(input.personalitySeed)) {
    throw new Error("Personality Seed must be a bounded unsigned integer");
  }
  if (input.cognitionSnapshotVersion !== 3) {
    throw new Error("Cognition State schema version is unsupported");
  }
  if (!Number.isFinite(nowMs) || nowMs < 0) {
    throw new Error("Persistence timestamp must be finite and non-negative");
  }
  if (!Number.isFinite(createdAtMs) || createdAtMs < 0 || createdAtMs > nowMs) {
    throw new Error("Persistence creation timestamp is invalid");
  }
  if (!Number.isInteger(writeCount) || writeCount <= 0 || writeCount > MAX_METADATA_WRITE_COUNT) {
    throw new Error("Persistence write count is invalid");
  }

  const withoutIntegrity = {
    envelopeVersion: 1 as const,
    characterId: input.characterId,
    archetype: input.archetype,
    personalitySeed: input.personalitySeed,
    cognitionSnapshotVersion: input.cognitionSnapshotVersion,
    cognitionState: input.cognitionState,
    metadata: {
      createdAtMs,
      updatedAtMs: nowMs,
      writeCount,
    },
  };
  return {
    ...withoutIntegrity,
    integrity: {
      algorithm: "sha-256",
      digest: await sha256Hex(stableStringify(protectedPayload(withoutIntegrity))),
    },
  };
}

export async function verifyCharacterPersistenceRecord(
  record: unknown,
): Promise<boolean> {
  if (!isCharacterPersistenceRecord(record)) return false;
  const { integrity, ...withoutIntegrity } = record;
  if (integrity.algorithm !== "sha-256") return false;
  if (!isBoundedMetadata(record.metadata)) return false;
  return (
    (await sha256Hex(stableStringify(protectedPayload(withoutIntegrity)))) ===
    integrity.digest
  );
}

export function isCharacterPersistenceRecord(
  value: unknown,
): value is CharacterPersistenceRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<CharacterPersistenceRecord>;
  const requiredKeys = [
    "archetype",
    "characterId",
    "cognitionSnapshotVersion",
    "cognitionState",
    "envelopeVersion",
    "integrity",
    "metadata",
    "personalitySeed",
  ];
  if (
    requiredKeys.some(
      (key) => !Object.prototype.hasOwnProperty.call(record, key),
    ) ||
    Object.keys(record).some(
      (key) => !requiredKeys.includes(key),
    )
  ) {
    return false;
  }
  return (
    record.envelopeVersion === CHARACTER_PERSISTENCE_ENVELOPE_VERSION &&
    typeof record.characterId === "string" &&
    isUuidV7(record.characterId) &&
    typeof record.archetype === "string" &&
    record.archetype.trim() !== "" &&
    isBoundedPersonalitySeed(record.personalitySeed) &&
    record.cognitionSnapshotVersion === 3 &&
    Object.prototype.hasOwnProperty.call(record, "cognitionState") &&
    hasExactShape(record.metadata, [
      "createdAtMs",
      "updatedAtMs",
      "writeCount",
    ]) &&
    hasExactShape(record.integrity, ["algorithm", "digest"])
  );
}

function hasExactShape(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const object = value as Record<string, unknown>;
  return (
    keys.every((key) => Object.prototype.hasOwnProperty.call(object, key)) &&
    Object.keys(object).every((key) => keys.includes(key))
  );
}

export type CharacterPersistenceQuarantineArea = "future" | "corruption";

export type CharacterPersistenceClassification =
  | "current"
  | "future"
  | "corrupt";

/**
 * Any numeric version outside the accepted schema is retained unchanged for
 * migration/inspection. Malformed or integrity failures are corruption.
 */
export function classifyCharacterPersistenceRecord(
  value: unknown,
): CharacterPersistenceClassification {
  if (!value || typeof value !== "object") return "corrupt";
  const record = value as {
    envelopeVersion?: unknown;
    cognitionSnapshotVersion?: unknown;
  };
  const envelopeVersion = record.envelopeVersion;
  const cognitionVersion = record.cognitionSnapshotVersion;
  if (
    typeof envelopeVersion === "number" &&
    Number.isInteger(envelopeVersion) &&
    envelopeVersion !== CHARACTER_PERSISTENCE_ENVELOPE_VERSION
  ) {
    return "future";
  }
  if (
    typeof cognitionVersion === "number" &&
    Number.isInteger(cognitionVersion) &&
    cognitionVersion !== COGNITION_SNAPSHOT_VERSION
  ) {
    return "future";
  }
  return isCharacterPersistenceRecord(value) ? "current" : "corrupt";
}

/** Conservative logical-size check shared with the native byte-size gate. */
export function characterPersistenceRecordSize(value: unknown): number {
  try {
    return new TextEncoder().encode(stableStringify(value)).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function isBoundedMetadata(metadata: CharacterPersistenceMetadata): boolean {
  return (
    Number.isInteger(metadata.createdAtMs) &&
    metadata.createdAtMs >= 0 &&
    Number.isInteger(metadata.updatedAtMs) &&
    metadata.updatedAtMs >= metadata.createdAtMs &&
    Number.isInteger(metadata.writeCount) &&
    metadata.writeCount > 0 &&
    metadata.writeCount <= MAX_METADATA_WRITE_COUNT
  );
}

/** Minimal store seam; the concrete adapter owns a transport or filesystem. */
export interface CharacterPersistenceStore {
  save(record: CharacterPersistenceRecord): Promise<void>;
  delete(characterId: string): Promise<void>;
  /** Returns raw durable records in storage-determined deterministic order. */
  load?(): Promise<unknown[]>;
  /** Moves an unmodified logical record out of the authoritative namespace. */
  quarantine?(
    record: unknown,
    area: CharacterPersistenceQuarantineArea,
  ): Promise<void>;
}

export type PersistenceReason = "materialization" | "autosave" | "shutdown";
