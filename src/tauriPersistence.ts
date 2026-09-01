import { invoke } from "@tauri-apps/api/core";
import {
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
  };
}

/** Native identities are requested per intentional materialization. */
export function createNativeIdentityFactory(
  call = invoke,
): () => Promise<string> {
  return () => call<string>("create_character_identity");
}
