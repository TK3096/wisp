# Speech lexicon sources and constraints

**Research ticket:** [Research Speech lexicon sources and constraints · #72](https://github.com/TK3096/wisp/issues/72)  
**Research date:** 2026-09-08  
**Scope:** English vocabulary for grammar-skeleton generated speech.  
**Constraint:** Wisp may ship a small derived word bank, but must not import `katgpt-rs`, ship a large corpus, or use token-by-token model generation.

## Executive answer

Use **Open English WordNet 2025** as the primary external source for open-class lexical candidates, then apply deterministic Wisp-owned filtering and speech-register curation. Supplement it with a small Wisp-authored closed-class/function-word list for words and constructions that WordNet does not model usefully for short bubble speech.

The resulting bank should target approximately **1,000–2,000 curated lemmas**, stored in a compact Wisp-owned schema. This should remain tens to low hundreds of kilobytes as JSON before compression. The full OEWN source must not ship with the app.

## Recommended sources

| Source | License / provenance | Coverage and tagging | Extraction effort | Storage fit | Decision |
| --- | --- | --- | --- | --- | --- |
| **Open English WordNet 2025** | Derived from Princeton WordNet and further developed under CC BY 4.0; attribution is required to both Princeton WordNet and the Open English WordNet team | Broad English lemma/synset coverage with noun, verb, adjective, and adverb structure | Deterministic XML/RDF/JSON extraction and Wisp-owned filtering | Small derived output is practical | **Primary source.** Prefer the base 2025 edition because proper nouns were moved to Open English Namenet; the `2025+` edition adds curated proper nouns that Wisp does not need. |
| **Wisp-owned function words** | Wisp-owned authored data | Pronouns, determiners, auxiliaries, conjunctions, particles, greetings, interjections, and persona-specific openers/closers | Manual curation and review | Very small | **Required supplement.** WordNet is not the right source for all grammar/connective vocabulary. |
| **Princeton WordNet 3.1** | Princeton WordNet license | Broad coverage and POS/synset structure | Similar extraction work | Small derived output is practical | Usable, but less preferable than OEWN because OEWN has clearer modern open licensing and active maintenance. |
| **SUBTLEX-US** | OSF marks the project license as “Other” and provides a separate `license.txt`; exact terms were not verified in this pass | Word-frequency data and associated POS information | Simple filtering if terms permit | Frequency values would enlarge the bank | Useful only as an internal frequency-ranking reference if its terms permit. Do not redistribute derived frequency metadata until its license is confirmed. |
| **SCOWL / Hunspell-derived English dictionaries** | Mixed upstream licensing depending on selected subset | Broad spelling vocabulary, but no reliable grammatical POS | Would require external POS enrichment | Small word lists are practical | Useful for spelling/variant validation only; not suitable as the primary source. |
| **English Wiktionary / Wiktextract / Kaikki** | Wiktionary text is dual-licensed CC BY-SA 4.0 and GFDL; Wiktextract code is MIT | Very broad modern coverage with rich but noisy POS and morphology data | Requires aggressive filtering and normalization | Extraction source is large; derived output can be small | Share-alike/GFDL obligations make it a poor fit for a compact redistributed bank. Better for internal spot-checking than production extraction. |
| **Moby Part of Speech List** | Public domain via Project Gutenberg | Large but dated part-of-speech list | Simple extraction | Derived subset can be small | Useful fallback or validation source, but too coarse and dated for the primary source. |
| **UD English-EWT** | CC BY-SA 4.0 | Gold POS/tags for a web/social-media corpus | Requires corpus-to-vocabulary extraction | Derived subset can be small | Good POS/tagging reference, but share-alike and corpus-genre make it unsuitable as the production vocabulary source. |

## OEWN licensing notes

The Open English WordNet license requires attribution to both:

1. Princeton WordNet, because OEWN is derived from it.
2. The Open English WordNet team, because OEWN was further developed under CC BY 4.0.

A derived Wisp bank should record:

- exact source edition, for example `Open English WordNet 2025`;
- source URL and download date;
- whether the base `2025` or `2025+` edition was used;
- a short modification statement such as “filtered, categorized, and reduced for Wisp generated speech”;
- license references for CC BY 4.0 and the underlying Princeton WordNet terms;
- separation between Wisp-authored entries and OEWN-derived entries where practical.

“Wisp-owned” should mean **Wisp-curated, versioned, and maintained by Wisp**. It should not imply that substantial OEWN-derived vocabulary has no upstream attribution obligation.

## Recommended extraction workflow

1. Pin the exact OEWN edition and source archive.
2. Extract lemma forms and broad POS categories:
   - nouns;
   - verbs;
   - adjectives;
   - adverbs.
3. Exclude:
   - proper nouns;
   - multiword expressions unless explicitly supported by the grammar;
   - obsolete or highly specialized terms;
   - unsafe, offensive, or off-tone vocabulary;
   - terms unsuitable for very short bubble utterances.
4. Add a Wisp-owned closed-class and persona vocabulary layer.
5. Assign Wisp-owned speech priority buckets rather than redistributing external frequency values.
6. Emit a compact entry schema containing:
   - lemma;
   - allowed speech categories;
   - optional frequency bucket;
   - persona/tone suitability tags;
   - provenance class.
7. Freeze the generated bank with a schema/version hash.
8. Keep the extraction script and source-edition metadata reproducible, but keep the large source archive out of the repository.

## Storage guidance

Approximate JSON output before compression:

| Curated lemmas | Approximate footprint |
| ---: | ---: |
| 500–1,000 | 15–60 KB |
| 1,000–2,000 | 30–120 KB |
| 2,000–3,000 | 80–180 KB |
| 5,000 | 200–400 KB |

For Wisp bubble speech, **1,000–2,000 curated lemmas** is a practical first target. This gives useful variety while staying comfortably below corpus scale.

## Decision

Use **Open English WordNet 2025 plus Wisp-authored closed-class/persona vocabulary**.

Avoid using Wiktionary, UD treebanks, or SUBTLEX-derived data as redistributed production inputs unless the licensing burden is explicitly accepted. Use SCOWL and Moby only as validation or fallback aids. Do not import `katgpt-rs`.

## References

- Open English WordNet repository: <https://github.com/globalwordnet/english-wordnet>  
- OEWN downloads, including the 2025 edition: <https://en-word.net/downloads>  
- OEWN license file: <https://github.com/globalwordnet/english-wordnet/blob/master/LICENSE.md>  
- Princeton WordNet: <https://wordnet.princeton.edu/homepage>  
- English Wiktionary copyright policy: <https://en.wiktionary.org/wiki/Wiktionary:Copyrights>  
- Wiktextract license: <https://github.com/tatuylonen/wiktextract/blob/master/LICENSE>  
- SUBTLEX-US OSF project: <https://osf.io/djpqz/overview>  
- SCOWL / English word lists: <https://wordlist.aspell.net/>  
- Moby Part of Speech List: <https://www.gutenberg.org/ebooks/3203>
