use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

pub const CHARACTER_PERSISTENCE_ENVELOPE_VERSION: u64 = 1;
pub const COGNITION_SNAPSHOT_VERSION: u64 = 3;
pub const MAX_DURABLE_CHARACTERS: usize = 100;
const MAX_METADATA_WRITE_COUNT: u64 = 1_000_000;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterPersistenceRecord {
    envelope_version: u64,
    character_id: String,
    archetype: String,
    personality_seed: u64,
    cognition_snapshot_version: u64,
    cognition_state: Value,
    metadata: Metadata,
    integrity: Integrity,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Metadata {
    created_at_ms: u64,
    updated_at_ms: u64,
    write_count: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Integrity {
    algorithm: String,
    digest: String,
}

#[derive(Debug)]
pub enum PersistenceError {
    Io(std::io::Error),
    Envelope,
    Identity,
    Integrity,
    PopulationCap,
}

impl std::fmt::Display for PersistenceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => write!(f, "Character persistence I/O failed: {error}"),
            Self::Envelope => write!(f, "Character State envelope is invalid"),
            Self::Identity => write!(f, "Character Identity must be a UUIDv7"),
            Self::Integrity => write!(f, "Character State integrity check failed"),
            Self::PopulationCap => write!(f, "Durable character population is full"),
        }
    }
}

impl std::error::Error for PersistenceError {}

impl From<std::io::Error> for PersistenceError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}

pub fn persist_record(root: &Path, record: &Value) -> Result<PathBuf, PersistenceError> {
    let record: CharacterPersistenceRecord =
        serde_json::from_value(record.clone()).map_err(|_| PersistenceError::Envelope)?;
    validate_record(&record)?;

    fs::create_dir_all(root)?;
    if durable_record_count(root)? >= MAX_DURABLE_CHARACTERS {
        return Err(PersistenceError::PopulationCap);
    }

    let destination = root.join(format!("{}.json", record.character_id));
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = root.join(format!(".{}.{}.tmp", record.character_id, unique));

    let result = write_atomic(&temporary, &destination, record);
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result?;
    Ok(destination)
}

fn write_atomic(
    temporary: &Path,
    destination: &Path,
    record: CharacterPersistenceRecord,
) -> Result<PathBuf, PersistenceError> {
    let mut file = File::create(temporary)?;
    serde_json::to_writer(&mut file, &record).map_err(|_| PersistenceError::Envelope)?;
    file.write_all(b"\n")?;
    file.sync_all()?;
    drop(file);
    fs::rename(temporary, destination)?;
    // Make the rename itself durable before reporting success.
    if let Some(parent) = destination.parent() {
        File::open(parent)?.sync_all()?;
    }
    Ok(destination.to_path_buf())
}

pub fn delete_record(root: &Path, character_id: &str) -> Result<(), PersistenceError> {
    let identity = Uuid::parse_str(character_id).map_err(|_| PersistenceError::Identity)?;
    if identity.get_version() != Some(uuid::Version::SortRand) {
        return Err(PersistenceError::Identity);
    }
    let path = root.join(format!("{character_id}.json"));
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn validate_record(record: &CharacterPersistenceRecord) -> Result<(), PersistenceError> {
    if record.envelope_version != CHARACTER_PERSISTENCE_ENVELOPE_VERSION
        || record.archetype.trim().is_empty()
        || record.cognition_snapshot_version != COGNITION_SNAPSHOT_VERSION
        || record.metadata.updated_at_ms < record.metadata.created_at_ms
        || record.metadata.write_count == 0
        || record.metadata.write_count > MAX_METADATA_WRITE_COUNT
    {
        return Err(PersistenceError::Envelope);
    }

    let identity = Uuid::parse_str(&record.character_id).map_err(|_| PersistenceError::Identity)?;
    if identity.get_version() != Some(uuid::Version::SortRand) {
        return Err(PersistenceError::Identity);
    }
    if record.integrity.algorithm != "sha-256"
        || record.integrity.digest.len() != 64
        || !record
            .integrity
            .digest
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(PersistenceError::Integrity);
    }
    if protected_digest(record) != record.integrity.digest.to_ascii_lowercase() {
        return Err(PersistenceError::Integrity);
    }
    Ok(())
}

fn protected_digest(record: &CharacterPersistenceRecord) -> String {
    let payload = json!({
        "archetype": record.archetype,
        "characterId": record.character_id,
        "cognitionSnapshotVersion": record.cognition_snapshot_version,
        "cognitionState": record.cognition_state,
        "envelopeVersion": record.envelope_version,
        "metadata": {
            "createdAtMs": record.metadata.created_at_ms,
            "updatedAtMs": record.metadata.updated_at_ms,
            "writeCount": record.metadata.write_count,
        },
        "personalitySeed": record.personality_seed,
    });
    let canonical = canonical_json(&payload);
    hex(Sha256::digest(canonical.as_bytes()).as_slice())
}

fn canonical_json(value: &Value) -> String {
    match value {
        Value::Null => "null".to_owned(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => {
            if value.as_f64() == Some(-0.0) {
                "0".to_owned()
            } else {
                value.to_string()
            }
        }
        Value::String(value) => serde_json::to_string(value).unwrap_or_default(),
        Value::Array(values) => values
            .iter()
            .map(canonical_json)
            .collect::<Vec<_>>()
            .join(",")
            .pipe(|body| format!("[{body}]")),
        Value::Object(values) => {
            let mut keys: Vec<_> = values.keys().collect();
            keys.sort();
            keys.iter()
                .map(|key| {
                    format!(
                        "{}:{}",
                        serde_json::to_string(key).unwrap_or_default(),
                        canonical_json(&values[*key])
                    )
                })
                .collect::<Vec<_>>()
                .join(",")
                .pipe(|body| format!("{{{body}}}"))
        }
    }
}

trait Pipe: Sized {
    fn pipe<T>(self, f: impl FnOnce(Self) -> T) -> T {
        f(self)
    }
}
impl<T> Pipe for T {}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn durable_record_count(root: &Path) -> Result<usize, PersistenceError> {
    if !root.exists() {
        return Ok(0);
    }
    Ok(fs::read_dir(root)?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.path().is_file()
                && entry
                    .path()
                    .extension()
                    .is_some_and(|extension| extension == "json")
        })
        .count())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn record_value() -> Value {
        let mut record = json!({
            "envelopeVersion": 1,
            "characterId": "0195c8f2-70aa-7cc2-99df-f2d3ba54c341",
            "archetype": "mask-dude",
            "personalitySeed": 42,
            "cognitionSnapshotVersion": 3,
            "cognitionState": {"opaque": true},
            "metadata": {"createdAtMs": 100, "updatedAtMs": 200, "writeCount": 2},
            "integrity": {"algorithm": "sha-256", "digest": ""}
        });
        let deserialized: CharacterPersistenceRecord =
            serde_json::from_value(record.clone()).unwrap();
        let digest = protected_digest(&deserialized);
        record["integrity"]["digest"] = json!(digest);
        record
    }

    #[test]
    fn writes_flushed_temp_file_and_renames_into_place() {
        let root = tempfile::tempdir().unwrap();
        let path = persist_record(root.path(), &record_value()).unwrap();
        assert_eq!(
            path.file_name().unwrap(),
            "0195c8f2-70aa-7cc2-99df-f2d3ba54c341.json"
        );
        assert!(path.is_file());
        assert!(read_dir_tempfiles(root.path()).is_empty());
    }

    #[test]
    fn rejects_non_v7_identity_and_tampered_state() {
        let root = tempfile::tempdir().unwrap();
        let mut identity = record_value();
        identity["characterId"] = json!("123e4567-e89b-42d3-a456-426614174000");
        assert!(matches!(
            persist_record(root.path(), &identity),
            Err(PersistenceError::Identity)
        ));

        let mut tampered = record_value();
        tampered["cognitionState"]["opaque"] = json!(false);
        assert!(matches!(
            persist_record(root.path(), &tampered),
            Err(PersistenceError::Integrity)
        ));
        assert_eq!(durable_record_count(root.path()).unwrap(), 0);
    }

    #[test]
    fn failed_write_leaves_existing_authority_intact() {
        let root = tempfile::tempdir().unwrap();
        let path = persist_record(root.path(), &record_value()).unwrap();
        let authoritative = fs::read(&path).unwrap();

        let typed: CharacterPersistenceRecord = serde_json::from_value(record_value()).unwrap();
        let blocked_temporary = root.path().join("blocked.tmp");
        fs::create_dir(&blocked_temporary).unwrap();
        assert!(matches!(
            write_atomic(&blocked_temporary, &path, typed),
            Err(PersistenceError::Io(_))
        ));
        assert_eq!(fs::read(&path).unwrap(), authoritative);

        fs::remove_dir(&blocked_temporary).unwrap();
    }

    #[test]
    fn enforces_durable_population_without_deleting_records() {
        let root = tempfile::tempdir().unwrap();
        for index in 0..MAX_DURABLE_CHARACTERS {
            let mut record = record_value();
            record["characterId"] =
                json!(format!("0195c8f2-70aa-7cc2-99df-f2d3ba54c{:03}", index + 1));
            // The digest covers the new identity.
            let typed: CharacterPersistenceRecord = serde_json::from_value(record.clone()).unwrap();
            record["integrity"]["digest"] = json!(protected_digest(&typed));
            persist_record(root.path(), &record).unwrap();
        }
        assert!(matches!(
            persist_record(root.path(), &record_value()),
            Err(PersistenceError::PopulationCap)
        ));
        assert_eq!(
            durable_record_count(root.path()).unwrap(),
            MAX_DURABLE_CHARACTERS
        );
    }

    fn read_dir_tempfiles(root: &Path) -> Vec<PathBuf> {
        fs::read_dir(root)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.extension().is_some_and(|ext| ext == "tmp"))
            .collect()
    }
}
