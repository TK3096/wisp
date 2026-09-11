import { invoke } from "@tauri-apps/api/core";
import {
  CharacterPersistenceQuarantineArea,
  CharacterPersistenceRecord,
  CharacterPersistenceStore,
} from "./characterPersistence";

/**
 * The only transport-aware persistence adapter. The simulation and record
 * envelope remain injectable and headless-testable.
 */
export function createTauriPersistence(
  call = invoke,
): CharacterPersistenceStore {
  return {
    async save(record: CharacterPersistenceRecord): Promise<void> {
      await call("persist_character_record", { record });
    },
    async delete(characterId: string): Promise<void> {
      await call("delete_character_record", { characterId });
    },
    async load(): Promise<unknown[]> {
      return call<unknown[]>("load_character_records");
    },
    async quarantine(
      record: unknown,
      area: CharacterPersistenceQuarantineArea,
    ): Promise<void> {
      await call("quarantine_character_record", { record, area });
    },
  };
}

/** Native identities are requested per intentional materialization. */
export function createNativeIdentityFactory(
  call = invoke,
): () => Promise<string> {
  return () => call<string>("create_character_identity");
}
