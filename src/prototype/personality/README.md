# Personality-to-behavior prototype

**PROTOTYPE — throwaway decision aid, not production code.**

This terminal prototype answers one question: which personality dimensions and reward signals should Wisp use, and how should they concretely change observable behavior?

Run it with:

```bash
npm run prototype:personality
```

The candidate model starts with four user-legible dimensions per individual—**Energy**, **Curiosity**, **Boldness**, and **Sociability**. It projects them into bounded behavior tendencies rather than commands:

- idle dwell range,
- walk speed,
- probability at the existing jump roll,
- animation pacing (idle/walk FPS multipliers),
- bubble tone weights and text selection.

It also separates three feedback concepts:

- an open-palm gesture is a **stimulus** (surprising/social, but not reward),
- explicit delight/dismiss is **per-character reward** for a retained individual,
- spawn/despawn selection is **archetype-level evidence**, not a direct reward to a deleted individual.

The prototype's mutable affect and reward drift exist to make the decision concrete. They are not production code.

Confirmed behavior design:

- the four dimensions above are the personality vocabulary;
- Curiosity increases the idle-to-walk urge rather than only increasing walk speed;
- outputs remain bounded behavior biases, not direct commands;
- `animationPace` is bounded to `0.75–1.25` and multiplies idle/walk FPS;
- bubble lines have one tone tag and are selected by weighted random sampling.

Confirmed reward design:

- explicit delight/dismiss can drift a credited personality dimension by ±0.015 per event, up to ±0.15 per dimension in this session;
- only expressions within the 5-second credit window cause drift;
- jump credits Boldness, walk/curious bubble credits Curiosity, social bubble credits Sociability, playful bubble credits Energy+Boldness, and calm bubble lowers Energy;
- startled bubble causes no drift because Wisp has no Sensitivity dimension;
- gesture, spawn, and despawn never drift;
- restart resets drift until a later long-term-memory decision.
