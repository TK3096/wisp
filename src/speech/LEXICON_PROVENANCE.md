# Wisp Speech Lexicon Provenance

## Source

- Open English WordNet 2025, release `2025-edition`
- Artifact: `english-wordnet-2025-json.zip`
- URL: https://github.com/globalwordnet/english-wordnet/releases/download/2025-edition/english-wordnet-2025-json.zip
- Artifact date: 2025-12-12
- SHA-256: `7d749f6e2c39e6970e4997839dcf6e42fd281f3c2fae0171d2192bae8cfa4b51`
- License: CC BY 4.0
- Attribution: Princeton WordNet and the Open English WordNet team.

## Modification and curation

The pinned OEWN JSON was deterministically normalized, filtered to speech-register open-class lemmas, categorized, scored, and tone-tagged. The committed bank adds Wisp-authored closed-class and persona/discourse vocabulary. It does not redistribute OEWN senses, definitions, or the full artifact. The generated curation report remains local-only.

## Origins

- `oewn-derived`: lemma identity comes from OEWN 2025 and has Wisp tone curation.
- `wisp-authored`: closed-class/function and persona/discourse vocabulary authored for Wisp.

- OEWN-derived entries: 1080
- Wisp-authored entries: 120
- Total entries: 1200
- Uncompressed source lexicon: 122397 bytes
- Advisory gzip size: 5934 bytes
