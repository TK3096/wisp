import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";

const schema = await import("../src/speech/lexiconSchema.mjs");
const lexicon = JSON.parse(readFileSync("src/speech/lexicon.json", "utf8"));
const lock = JSON.parse(readFileSync("src/speech/LEXICON_SOURCE_LOCK.json", "utf8"));

function entry(
  category: string,
  lemma: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    lemma,
    category,
    tones: ["cheerful"],
    origin: category === "function" ? "wisp-authored" : "oewn-derived",
    ...overrides,
  };
}

function validDocument() {
  const entries = [
    entry("adjective", "bright"),
    entry("adverb", "gently"),
    entry("function", "hello", { persona: ["social"] }),
    entry("noun", "lantern"),
    entry("verb", "wander"),
  ];
  return {
    schemaVersion: 1,
    extractionContract: 1,
    provenance: {
      source: "Open English WordNet 2025",
      release: lock.release,
      url: lock.url,
      sha256: lock.sha256,
      license: lock.license,
      attribution: ["Princeton WordNet", "Open English WordNet team"],
      modification: "test fixture",
      originCounts: {
        "oewn-derived": entries.filter((item) => item.origin === "oewn-derived").length,
        "wisp-authored": entries.filter((item) => item.origin === "wisp-authored").length,
      },
    },
    entries,
  };
}

const fixtureOptions = {
  expectedCounts: { adjective: 1, adverb: 1, function: 1, noun: 1, verb: 1 },
  minTotal: 5,
  maxTotal: 5,
  maxSizeBytes: 1024 * 1024,
  sourceLock: lock,
};

describe("Speech lexicon first bank", () => {
  it("has the accepted deterministic category slots", () => {
    const counts = Object.fromEntries(
      schema.LEXICON_CATEGORIES.map((category: string) => [
        category,
        lexicon.entries.filter((entry: any) => entry.category === category).length,
      ]),
    );
    expect(counts).toEqual(schema.FIRST_BANK_SLOTS);
    expect(lexicon.entries).toHaveLength(1200);
  });

  it("stores explicit origins, valid tones, bounded personas, and compact fields", () => {
    for (const entry of lexicon.entries) {
      expect(Object.keys(entry).sort()).toEqual(
        expect.arrayContaining(["category", "lemma", "origin", "tones"]),
      );
      expect(schema.LEXICON_ORIGINS).toContain(entry.origin);
      expect(entry.tones.length).toBeGreaterThan(0);
      if (entry.persona !== undefined) {
        expect(entry.persona.length).toBeLessThanOrEqual(2);
      }
    }
    expect(lexicon.provenance.originCounts).toEqual({
      "oewn-derived": 1080,
      "wisp-authored": 120,
    });
  });

  it("meets uncompressed and advisory gzip budgets", () => {
    const serialized = `${JSON.stringify(lexicon)}\n`;
    expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(160 * 1024);
    expect(statSync("src/speech/lexicon.json").size).toBeLessThanOrEqual(200 * 1024);
    expect(zlib.gzipSync(serialized).length).toBeLessThanOrEqual(40 * 1024);
  });

  it("pins the accepted OEWN 2025 artifact and keeps full source out of the bank", () => {
    expect(lock).toEqual({
      artifact: "english-wordnet-2025-json.zip",
      release: "2025-edition",
      artifactDate: "2025-12-12",
      url: "https://github.com/globalwordnet/english-wordnet/releases/download/2025-edition/english-wordnet-2025-json.zip",
      sizeBytes: 9_986_555,
      sha256: "7d749f6e2c39e6970e4997839dcf6e42fd281f3c2fae0171d2192bae8cfa4b51",
      license: "CC BY 4.0",
    });
    const files = readdirSync("src/speech", { recursive: true });
    for (const file of files) {
      const path = join("src/speech", String(file));
      expect(statSync(path).isFile() && path.endsWith(".zip")).toBe(false);
      if (statSync(path).isFile()) expect(statSync(path).size).toBeLessThanOrEqual(200 * 1024);
    }
  });

  it("ships no blocklisted, manually rejected, or definition-marker vocabulary", () => {
    const blocked = readFileSync("src/speech/curation/speech_blocklist.tsv", "utf8")
      .trim().split("\n").slice(1).map((line) => line.split("\t")[0]);
    const manual = readFileSync("src/speech/curation/speech_manual_rejections.tsv", "utf8")
      .trim().split("\n").slice(1).map((line) => line.split("\t")[0]);
    const shipped = new Set(lexicon.entries.map((entry: any) => entry.lemma));
    expect(blocked.filter((lemma) => shipped.has(lemma))).toEqual([]);
    expect(manual.filter((lemma) => shipped.has(lemma))).toEqual([]);
  });

  it("accepts valid schema fixtures in every category", () => {
    const errors = schema.validateLexiconDocument(validDocument(), fixtureOptions);
    expect(errors).toEqual([]);
  });

  it("rejects invalid schema fixtures", () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["category", { category: "clause" }],
      ["origin", { origin: "external" }],
      ["tones", { tones: [] }],
      ["invalid tone", { tones: ["happy"] }],
      ["missing tone", { tones: undefined }],
      ["invalid persona", { persona: ["brave"] }],
      ["contradictory persona", { persona: ["bold", "cautious"] }],
    ];
    for (const [name, overrides] of cases) {
      const document = validDocument();
      Object.assign(document.entries[3], overrides);
      const errors = schema.validateLexiconDocument(document, fixtureOptions);
      expect(errors, name).not.toEqual([]);
    }
  });

  it("rejects duplicate category/lemma and unordered output", () => {
    const duplicate = validDocument();
    duplicate.entries.push({ ...duplicate.entries[3] });
    expect(schema.validateLexiconDocument(duplicate, {
      ...fixtureOptions,
      maxTotal: 6,
    })).toContain("lexicon.entries[5] duplicates noun^@lantern");

    const unordered = validDocument();
    [unordered.entries[0], unordered.entries[1]] = [unordered.entries[1], unordered.entries[0]];
    expect(schema.validateLexiconDocument(unordered, fixtureOptions))
      .toContain("lexicon.entries[1] is out of canonical category/lemma order");
  });

  it("rejects source-lock mismatch and size overflow fixtures", () => {
    const mismatch = validDocument();
    mismatch.provenance.sha256 = `${lock.sha256.slice(0, -1)}0`;
    expect(schema.validateLexiconDocument(mismatch, fixtureOptions))
      .toContain("source-lock digest mismatch");

    const overflow = validDocument();
    expect(
      schema.validateLexiconDocument(overflow, { ...fixtureOptions, maxSizeBytes: 1 })
        .some((error: string) => error.includes("exceeds 1")),
    ).toBe(true);
  });
});
