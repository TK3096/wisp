#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import process from "node:process";

import {
  BUILT_LEXICON_MAX_BYTES,
  FIRST_BANK_SLOTS,
  LEXICON_CATEGORIES,
  LEXICON_PERSONAS,
  LEXICON_TONES,
  SOURCE_LEXICON_MAX_BYTES,
  validateLexiconDocument,
} from "../src/speech/lexiconSchema.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const SPEECH_DIR = join(ROOT, "src/speech");
const CURATION_DIR = join(SPEECH_DIR, "curation");
const SOURCE_LOCK_PATH = join(SPEECH_DIR, "LEXICON_SOURCE_LOCK.json");
const TARGET_DIR = join(ROOT, "target/lexicon");

const POS_TO_CATEGORY = new Map([
  ["n", "noun"],
  ["n-1", "noun"],
  ["n-2", "noun"],
  ["v", "verb"],
  ["v-1", "verb"],
  ["v-2", "verb"],
  ["a", "adjective"],
  ["s", "adjective"],
  ["r", "adverb"],
]);

function fail(message) {
  throw new Error(message);
}

function readTsv(path, columns, { requireLast = false } = {}) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  const header = lines.shift();
  if (header !== columns.join("\t")) fail(`Unexpected header in ${path}`);
  return lines.map((line, index) => {
    const cells = line.split("\t");
    if (cells.length !== columns.length) {
      fail(`${path}:${index + 2} has ${cells.length} columns; expected ${columns.length}`);
    }
    if (requireLast && cells.at(-1).trim().length === 0) {
      fail(`${path}:${index + 2} requires a curation reason`);
    }
    return Object.fromEntries(columns.map((column, index) => [column, cells[index].trim()]));
  });
}

function parseLists(value) {
  return value ? value.split("|").filter(Boolean) : undefined;
}

function loadCurationInputs() {
  const seeds = readTsv(join(CURATION_DIR, "speech_register_seeds.tsv"), [
    "lemma",
    "category",
    "tones",
    "persona",
  ]).map((row) => ({ ...row, tones: parseLists(row.tones), persona: parseLists(row.persona) }));
  const authored = readTsv(join(CURATION_DIR, "wisp-authored.tsv"), [
    "lemma",
    "category",
    "tones",
    "persona",
    "reason",
  ], { requireLast: true }).map((row) => ({
    ...row,
    tones: parseLists(row.tones),
    persona: parseLists(row.persona),
  }));
  const blocklist = new Set(readTsv(join(CURATION_DIR, "speech_blocklist.tsv"), [
    "lemma",
    "reason",
  ], { requireLast: true }).map((row) => row.lemma));
  const markers = readTsv(join(CURATION_DIR, "speech_definition_markers.tsv"), [
    "marker",
    "reason",
  ], { requireLast: true });
  const manual = new Set(readTsv(join(CURATION_DIR, "speech_manual_rejections.tsv"), [
    "lemma",
    "reason",
  ], { requireLast: true }).map((row) => row.lemma));
  return { seeds, authored, blocklist, markers, manual };
}

async function ensureSourceArtifact(lock) {
  const override = process.env.OEWN_ZIP;
  const cachePath = join(ROOT, "target/cache", lock.artifact);
  const sourcePath = override ?? cachePath;
  if (!existsSync(sourcePath)) {
    mkdirSync(dirname(sourcePath), { recursive: true });
    const response = await fetch(lock.url);
    if (!response.ok) fail(`Download failed: ${response.status} ${response.statusText}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    writeFileSync(sourcePath, bytes);
  }
  const bytes = statSync(sourcePath).size;
  const digest = createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
  if (bytes !== lock.sizeBytes) {
    fail(`Source size ${bytes} does not match lock ${lock.sizeBytes}`);
  }
  if (digest !== lock.sha256) {
    fail(`Source digest ${digest} does not match lock ${lock.sha256}`);
  }
  return sourcePath;
}

function extractEntries(sourcePath, workDir) {
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  execFileSync("unzip", ["-q", sourcePath, "entries-*.json", "-d", workDir]);
  const files = [
    "entries-0.json",
    "entries-a.json",
    "entries-b.json",
    "entries-c.json",
    "entries-d.json",
    "entries-e.json",
    "entries-f.json",
    "entries-g.json",
    "entries-h.json",
    "entries-i.json",
    "entries-j.json",
    "entries-k.json",
    "entries-l.json",
    "entries-m.json",
    "entries-n.json",
    "entries-o.json",
    "entries-p.json",
    "entries-q.json",
    "entries-r.json",
    "entries-s.json",
    "entries-t.json",
    "entries-u.json",
    "entries-v.json",
    "entries-w.json",
    "entries-x.json",
    "entries-y.json",
    "entries-z.json",
  ].filter((name) => existsSync(join(workDir, name))).sort((left, right) => left.localeCompare(right));
  if (!files.length) fail("Pinned OEWN artifact has no entries-*.json files");

  const candidates = new Map();
  const collisions = [];
  for (const file of files) {
    const source = JSON.parse(readFileSync(join(workDir, file), "utf8"));
    for (const sourceLemma of Object.keys(source)) {
      if (!/^[a-z]+$/.test(sourceLemma)) continue;
      const normalized = sourceLemma.normalize("NFKC").trim().toLowerCase();
      if (normalized !== sourceLemma || !/^[a-z]+$/.test(normalized) || normalized.length < 2 || normalized.length > 16) continue;
      for (const [pos, posData] of Object.entries(source[sourceLemma])) {
        const category = POS_TO_CATEGORY.get(pos);
        if (!category) continue;
        const key = `${category}^@${normalized}`;
        if (candidates.has(key)) {
          collisions.push({ key, file, action: "retained-first" });
          continue;
        }
        const senseIds = (posData?.sense ?? []).map((sense) => sense.id).filter(Boolean);
        const senseCount = new Set(senseIds).size;
        candidates.set(key, { lemma: normalized, category, senseCount });
      }
    }
  }
  return { candidates, collisions, files };
}

function priorityFor(candidate, seedKeys) {
  const seedBonus = seedKeys.has(`${candidate.category}^@${candidate.lemma}`) ? 100 : 0;
  const senseBonus = Math.min(candidate.senseCount, 8) * 5;
  const lengthBonus = Math.max(0, 13 - candidate.lemma.length) * 2;
  return { priority: seedBonus + senseBonus + lengthBonus, seedBonus, senseBonus, lengthBonus };
}

function normalizeEntry(input, origin) {
  const tones = input.tones ?? ["cheerful", "curious", "grumpy"];
  return {
    lemma: input.lemma,
    category: input.category,
    tones: [...tones],
    ...(input.persona ? { persona: [...input.persona] } : {}),
    origin,
  };
}

function validateCurationEntry(input, origin, blocked, errors, label) {
  if (!/^[a-z]+$/.test(input.lemma) || input.lemma.length < 1 || input.lemma.length > 16) {
    errors.push(`${label} ${input.lemma}: invalid lemma`);
  }
  if (!LEXICON_CATEGORIES.includes(input.category)) errors.push(`${label} ${input.lemma}: invalid category`);
  if (!Array.isArray(input.tones) || input.tones.length === 0) {
    errors.push(`${label} ${input.lemma}: missing tone`);
  } else if (input.tones.some((tone) => !LEXICON_TONES.includes(tone))) {
    errors.push(`${label} ${input.lemma}: invalid tone`);
  } else if (new Set(input.tones).size !== input.tones.length) {
    errors.push(`${label} ${input.lemma}: duplicate tone`);
  }
  if (input.persona !== undefined) {
    if (!Array.isArray(input.persona) || input.persona.length > 2) {
      errors.push(`${label} ${input.lemma}: persona must contain at most two values`);
    } else if (input.persona.some((persona) => !LEXICON_PERSONAS.includes(persona))) {
      errors.push(`${label} ${input.lemma}: invalid persona`);
    } else if (new Set(input.persona).size !== input.persona.length) {
      errors.push(`${label} ${input.lemma}: duplicate persona`);
    }
  }
  if (blocked.has(input.lemma)) errors.push(`${label} ${input.lemma}: blocklisted`);
}

async function buildLexicon(outputDir) {
  const lock = JSON.parse(readFileSync(SOURCE_LOCK_PATH, "utf8"));
  for (const key of ["artifact", "release", "artifactDate", "url", "sizeBytes", "sha256", "license"]) {
    if (!(key in lock)) fail(`Source lock is missing ${key}`);
  }
  if (lock.artifact !== "english-wordnet-2025-json.zip") fail("Unexpected source artifact identity");
  if (!/^\d{4}-edition$/.test(lock.release)) fail("Source release is invalid");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lock.artifactDate)) fail("Source artifact date is invalid");
  if (!lock.url.startsWith("https://github.com/globalwordnet/english-wordnet/releases/download/")) {
    fail("Source URL is invalid");
  }
  if (lock.license !== "CC BY 4.0") fail("Source license is invalid");
  const sourcePath = await ensureSourceArtifact(lock);
  const workDir = join(tmpdir(), `wisp-oewn-${process.pid}`);
  const { candidates, collisions, files } = extractEntries(sourcePath, workDir);
  rmSync(workDir, { recursive: true, force: true });

  const curation = loadCurationInputs();
  const seedKeys = new Set(curation.seeds.map((row) => `${row.category}^@${row.lemma}`));
  const errors = [];
  const entries = [];
  const authoredKeys = new Set();
  for (const row of curation.seeds) {
    validateCurationEntry(row, "oewn-derived", curation.blocklist, errors, "seed");
    const key = `${row.category}^@${row.lemma}`;
    if (seedKeys.has(key) && curation.seeds.filter((seed) => `${seed.category}^@${seed.lemma}` === key).length > 1) {
      errors.push(`seed ${row.lemma}: duplicate`);
    }
  }
  for (const row of curation.authored) {
    validateCurationEntry(row, "wisp-authored", curation.blocklist, errors, "authored");
    const key = `${row.category}^@${row.lemma}`;
    if (authoredKeys.has(key)) errors.push(`authored ${row.lemma}: duplicate`);
    authoredKeys.add(key);
    entries.push(normalizeEntry(row, "wisp-authored"));
  }

  const rejected = [];
  const selectable = [];
  for (const candidate of candidates.values()) {
    const key = `${candidate.category}^@${candidate.lemma}`;
    if (authoredKeys.has(key)) continue;
    let rejection = null;
    if (candidate.senseCount < 1) rejection = "no accepted sense";
    else if (curation.blocklist.has(candidate.lemma)) rejection = "blocklist";
    else if (curation.manual.has(candidate.lemma)) rejection = "manual rejection";
    else {
      const marker = curation.markers.find((item) => candidate.lemma.includes(item.marker));
      if (marker) rejection = `definition marker: ${marker.marker}`;
    }
    if (rejection) rejected.push({ ...candidate, rejection });
    else selectable.push(candidate);
  }
  selectable.sort((left, right) => {
    const leftPriority = priorityFor(left, seedKeys).priority;
    const rightPriority = priorityFor(right, seedKeys).priority;
    return rightPriority - leftPriority || left.lemma.localeCompare(right.lemma, "en-US");
  });

  const needed = new Map(Object.entries(FIRST_BANK_SLOTS).map(([category, target]) => {
    const authoredCount = entries.filter((entry) => entry.category === category).length;
    return [category, target - authoredCount];
  }));
  const selected = [];
  const overflow = [];
  const categorySelected = new Map(LEXICON_CATEGORIES.map((category) => [category, 0]));
  for (const candidate of selectable) {
    if ((needed.get(candidate.category) ?? 0) <= categorySelected.get(candidate.category)) {
      overflow.push(candidate);
      continue;
    }
    selected.push({ ...candidate, ...priorityFor(candidate, seedKeys), tones: ["cheerful", "curious", "grumpy"] });
    categorySelected.set(candidate.category, categorySelected.get(candidate.category) + 1);
    entries.push(normalizeEntry(candidate, "oewn-derived"));
  }

  entries.sort((left, right) =>
    left.category.localeCompare(right.category, "en-US") || left.lemma.localeCompare(right.lemma, "en-US"));
  const document = {
    schemaVersion: 1,
    extractionContract: 1,
    provenance: {
      source: "Open English WordNet 2025",
      release: lock.release,
      url: lock.url,
      sha256: lock.sha256,
      license: lock.license,
      attribution: ["Princeton WordNet", "Open English WordNet team"],
      modification: "Lemmas were filtered, categorized, tone-tagged, and merged with Wisp-authored vocabulary; senses and definitions are not redistributed.",
      originCounts: {
        "oewn-derived": entries.filter((entry) => entry.origin === "oewn-derived").length,
        "wisp-authored": entries.filter((entry) => entry.origin === "wisp-authored").length,
      },
    },
    entries,
  };
  const serialized = `${JSON.stringify(document)}\n`;
  const gzipSizeBytes = gzipSync(serialized).length;
  errors.push(...validateLexiconDocument(JSON.parse(serialized), {
    expectedCounts: FIRST_BANK_SLOTS,
    maxSizeBytes: SOURCE_LEXICON_MAX_BYTES,
    gzipSizeBytes,
    sourceLock: lock,
  }));
  if (errors.length) fail(errors.join("\n"));

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "lexicon.json"), serialized);
  const reportDir = join(TARGET_DIR, "reports");
  mkdirSync(reportDir, { recursive: true });
  const reportPath = join(reportDir, "curation-report.json");
  const report = {
    generatedWith: "contract 1",
    source: { ...lock, sourcePath: basename(sourcePath) },
    sourceFilesScanned: files,
    candidateCount: candidates.size,
    selectedCount: selected.length,
    categoryCounts: Object.fromEntries(categorySelected),
    authoredCount: curation.authored.length,
    collisions,
    selected,
    overflow: overflow.slice(0, 500),
    rejected: rejected.slice(0, 5000),
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const provenance = `# Wisp Speech Lexicon Provenance\n\n## Source\n\n- Open English WordNet 2025, release \`${lock.release}\`\n- Artifact: \`${lock.artifact}\`\n- URL: ${lock.url}\n- Artifact date: ${lock.artifactDate}\n- SHA-256: \`${lock.sha256}\`\n- License: ${lock.license}\n- Attribution: Princeton WordNet and the Open English WordNet team.\n\n## Modification and curation\n\nThe pinned OEWN JSON was deterministically normalized, filtered to speech-register open-class lemmas, categorized, scored, and tone-tagged. The committed bank adds Wisp-authored closed-class and persona/discourse vocabulary. It does not redistribute OEWN senses, definitions, or the full artifact. The generated curation report remains local-only.\n\n## Origins\n\n- \`oewn-derived\`: lemma identity comes from OEWN 2025 and has Wisp tone curation.\n- \`wisp-authored\`: closed-class/function and persona/discourse vocabulary authored for Wisp.\n\n- OEWN-derived entries: ${document.provenance.originCounts["oewn-derived"]}\n- Wisp-authored entries: ${document.provenance.originCounts["wisp-authored"]}\n- Total entries: ${entries.length}\n- Uncompressed source lexicon: ${Buffer.byteLength(serialized)} bytes\n- Advisory gzip size: ${gzipSizeBytes} bytes\n`;
  writeFileSync(join(outputDir, "LEXICON_PROVENANCE.md"), provenance);
  return { document, serialized };
}

const command = process.argv[2] ?? "build";
if (command === "build") {
  await buildLexicon(SPEECH_DIR);
  console.log(`Built ${join(SPEECH_DIR, "lexicon.json")}`);
} else if (command === "check") {
  const tempDir = join(TARGET_DIR, "check");
  rmSync(tempDir, { recursive: true, force: true });
  await buildLexicon(tempDir);
  for (const name of ["lexicon.json", "LEXICON_PROVENANCE.md"]) {
    const committed = readFileSync(join(SPEECH_DIR, name));
    const rebuilt = readFileSync(join(tempDir, name));
    if (!committed.equals(rebuilt)) fail(`${name} is not byte-identical to a clean rebuild`);
  }
  rmSync(tempDir, { recursive: true, force: true });
  console.log("Lexicon rebuild is byte-identical");
} else {
  fail(`Unknown command: ${command}`);
}
