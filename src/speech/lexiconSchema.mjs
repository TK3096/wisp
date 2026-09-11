export const LEXICON_SCHEMA_VERSION = 1;
export const LEXICON_EXTRACTION_CONTRACT = 1;

export const LEXICON_CATEGORIES = [
  "noun",
  "verb",
  "adjective",
  "adverb",
  "function",
];

export const LEXICON_TONES = ["cheerful", "curious", "grumpy"];
export const LEXICON_ORIGINS = ["oewn-derived", "wisp-authored"];
export const LEXICON_PERSONAS = [
  "energetic",
  "calm",
  "curious",
  "grounded",
  "bold",
  "cautious",
  "social",
  "reserved",
];

export const PERSONA_CONTRADICTION_AXES = [
  ["energetic", "calm"],
  ["curious", "grounded"],
  ["bold", "cautious"],
  ["social", "reserved"],
];

export const FIRST_BANK_SLOTS = Object.freeze({
  noun: 360,
  verb: 280,
  adjective: 280,
  adverb: 160,
  function: 120,
});

export const SOURCE_LEXICON_MAX_BYTES = 160 * 1024;
export const BUILT_LEXICON_MAX_BYTES = 200 * 1024;
export const GZIP_ADVISORY_MAX_BYTES = 40 * 1024;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value, keys, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) errors.push(`${path}.${key} is not allowed`);
  }
  // Requiredness is checked by each field validator; this allows optional keys
  // such as `persona` to be omitted entirely while still rejecting extras.
}

function stringEnum(value, allowed, path, errors) {
  if (!allowed.includes(value)) errors.push(`${path} must be one of: ${allowed.join(", ")}`);
}

function distinctStrings(value, allowed, path, errors, { min = 1, max = Number.POSITIVE_INFINITY } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    errors.push(`${path} must contain ${min} to ${max} values`);
    return;
  }
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string" || !allowed.includes(item)) {
      errors.push(`${path} contains an invalid value`);
    }
    if (seen.has(item)) errors.push(`${path} contains a duplicate value`);
    seen.add(item);
  }
}

export function validateLexiconDocument(document, options = {}) {
  const errors = [];
  const expectedCounts = options.expectedCounts ?? FIRST_BANK_SLOTS;
  const maxSizeBytes = options.maxSizeBytes ?? SOURCE_LEXICON_MAX_BYTES;
  const advisoryGzipMaxBytes = options.advisoryGzipMaxBytes ?? GZIP_ADVISORY_MAX_BYTES;
  const minTotal = options.minTotal ?? 1_000;
  const maxTotal = options.maxTotal ?? 1_500;

  exactKeys(
    document,
    [
      "schemaVersion",
      "extractionContract",
      "provenance",
      "entries",
    ],
    "lexicon",
    errors,
  );
  if (!errors.length || document.schemaVersion !== undefined) {
    if (document.schemaVersion !== LEXICON_SCHEMA_VERSION) {
      errors.push("lexicon.schemaVersion must be 1");
    }
    if (document.extractionContract !== LEXICON_EXTRACTION_CONTRACT) {
      errors.push("lexicon.extractionContract must be 1");
    }
  }

  exactKeys(
    document.provenance ?? {},
    [
      "source",
      "release",
      "url",
      "sha256",
      "license",
      "attribution",
      "modification",
      "originCounts",
    ],
    "lexicon.provenance",
    errors,
  );
  const provenance = document.provenance ?? {};
  for (const key of ["source", "release", "url", "sha256", "license", "modification"]) {
    if (typeof provenance[key] !== "string" || provenance[key].length === 0) {
      errors.push(`lexicon.provenance.${key} must be a non-empty string`);
    }
  }
  if (!Array.isArray(provenance.attribution) || provenance.attribution.length !== 2) {
    errors.push("lexicon.provenance.attribution must name both required owners");
  }
  if (!isPlainObject(provenance.originCounts)) {
    errors.push("lexicon.provenance.originCounts must be an object");
  }
  if (options.sourceLock) {
    const lock = options.sourceLock;
    if (provenance.source !== "Open English WordNet 2025") errors.push("source-lock source mismatch");
    if (provenance.release !== lock.release) errors.push("source-lock release mismatch");
    if (provenance.url !== lock.url) errors.push("source-lock URL mismatch");
    if (provenance.sha256 !== lock.sha256) errors.push("source-lock digest mismatch");
    if (provenance.license !== lock.license) errors.push("source-lock license mismatch");
  }

  const entries = document.entries;
  if (!Array.isArray(entries)) {
    errors.push("lexicon.entries must be an array");
    return errors;
  }

  const counts = Object.fromEntries(LEXICON_CATEGORIES.map((category) => [category, 0]));
  const seen = new Set();
  const serialized = JSON.stringify(document);
  let previous = null;

  entries.forEach((entry, index) => {
    const path = `lexicon.entries[${index}]`;
    exactKeys(entry, ["lemma", "category", "tones", "persona", "origin"], path, errors);
  if (typeof entry.lemma !== "string" || !/^[a-z]+$/.test(entry.lemma) || entry.lemma.length < 1 || entry.lemma.length > 16) {
      errors.push(`${path}.lemma is invalid`);
    }
    stringEnum(entry.category, LEXICON_CATEGORIES, `${path}.category`, errors);
    stringEnum(entry.origin, LEXICON_ORIGINS, `${path}.origin`, errors);
    distinctStrings(entry.tones, LEXICON_TONES, `${path}.tones`, errors, { max: 3 });
    if (entry.persona !== undefined) {
      distinctStrings(entry.persona, LEXICON_PERSONAS, `${path}.persona`, errors, { max: 2 });
      const persona = new Set(entry.persona ?? []);
      for (const [left, right] of PERSONA_CONTRADICTION_AXES) {
        if (persona.has(left) && persona.has(right)) {
          errors.push(`${path}.persona contains contradictory ${left}/${right}`);
        }
      }
    }
    const key = `${entry.category}^@${entry.lemma}`;
    if (seen.has(key)) errors.push(`${path} duplicates ${key}`);
    seen.add(key);
    if (counts[entry.category] !== undefined) counts[entry.category] += 1;

    const current = `${entry.category}\0${entry.lemma}`;
    if (previous !== null && current.localeCompare(previous, "en-US") < 0) {
      errors.push(`${path} is out of canonical category/lemma order`);
    }
    previous = current;
  });

  for (const category of LEXICON_CATEGORIES) {
    if (counts[category] !== expectedCounts[category]) {
      errors.push(`${category} has ${counts[category]} entries; expected ${expectedCounts[category]}`);
    }
  }
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (total < minTotal || total > maxTotal) errors.push(`total ${total} is outside ${minTotal}–${maxTotal}`);

  const originCounts = provenance.originCounts ?? {};
  for (const origin of LEXICON_ORIGINS) {
    const actual = entries.filter((entry) => entry.origin === origin).length;
    if (originCounts[origin] !== actual) {
      errors.push(`provenance.originCounts.${origin} must be ${actual}`);
    }
  }
  if (serialized.length > maxSizeBytes) {
    errors.push(`lexicon is ${serialized.length} bytes; exceeds ${maxSizeBytes}`);
  }
  if (options.gzipSizeBytes !== undefined && options.gzipSizeBytes > advisoryGzipMaxBytes) {
    errors.push(`advisory gzip size ${options.gzipSizeBytes} exceeds ${advisoryGzipMaxBytes}`);
  }

  return errors;
}
