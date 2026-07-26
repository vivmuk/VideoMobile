---
name: video-movie-prompting
description: Create model-aware prompts and shot packages for AI video generation and movie workflows. Use when an agent needs to choose or prompt Gemini Omni Flash, Grok Imagine, Seedance, Kling, Wan, or Happy Horse; turn a scene/script into text-to-video, image-to-video, reference-to-video, multishot, or continuation prompts; preserve character and visual continuity; or plan a multi-shot AI film.
---

# Video Movie Prompting

Create a controlled set of short, reviewable AI-video shots. Do not promise a feature-length, continuity-perfect generation in one prompt.

## Required workflow

1. Identify the requested provider, exact model/version, mode, target duration, output ratio, and available inputs.
2. If the active API/catalog can be queried, retrieve the live model capabilities and constraints before naming a mode or parameter. Do not hard-code model IDs, reference limits, or duration ranges from this skill.
3. If the user did not select a model, recommend one based on the task and explain the trade-off briefly.
4. Build or reuse a shot bible before creating more than one shot. Lock identity, wardrobe, props, location, time of day, palette, camera vocabulary, sound rules, and approved reference assets.
5. Make each prompt one observable dramatic beat: opening state, action progression, one principal camera intention, audio intention, and ending state.
6. Output the provider-specific prompt, the selected mode, references with explicit roles, validated settings, and an acceptance checklist. Mark unknown settings as "verify in live schema"; never invent them.
7. For a movie, include a shot ledger with model/version, prompt revision, input asset IDs, run settings, output archive path/URL, and approval status.
8. Do not submit a generation, alter a provider project, or upload source media unless the user asks.

## Select the adapter

| Need | Use | Read |
| --- | --- | --- |
| Mixed text/image/video/audio reference or conversational revision | Google Gemini Omni Flash | [references/google-omni.md](references/google-omni.md) |
| Fast I2V from an art-directed opening still, natural-language camera/motion/audio | xAI Grok Imagine | [references/grok-imagine.md](references/grok-imagine.md) |
| Complex physical action, designed audio, or a compact multishot sequence | ByteDance Seedance | [references/seedance.md](references/seedance.md) |
| Explicit custom shot segments, entities, image/video references, or endpoint frames | Kuaishou Kling | [references/kling.md](references/kling.md) |
| Structured content/motion/camera prompts, endpoint transitions, or open-model reproducibility | Alibaba Wan | [references/wan.md](references/wan.md) |
| Happy Horse | [references/happy-horse.md](references/happy-horse.md) before advising |

Read only the selected adapter reference. For a movie/multishot request, also read [references/movie-workflow.md](references/movie-workflow.md).

## Prompt construction rules

- Describe what is visible and audible in chronological order. Prefer concrete verbs and physical consequences to abstract mood tags.
- Name a reference's role: character, wardrobe, prop, setting, storyboard, camera rhythm, or sound palette. Do not upload a pile of unlabeled reference media.
- Keep the camera readable. Use one dominant move per short beat unless the selected provider explicitly supports a timed/cut sequence.
- Keep dialogue brief enough for the clip. Attach each line to a named speaker and state intentional silence/no-music conditions.
- For image-to-video, use the image as the composition/identity anchor. Spend the prompt on how the source evolves: subject movement, environmental response, camera, and sound.
- For revisions, alter the smallest possible dimension. Preserve all approved anchors in the revision prompt.
- Keep safety, likeness, rights, and provider-policy constraints in force. Do not use "uncensored" as an instruction to evade a provider's policy.

## Required output

For a one-shot request, return:

1. **Adapter and mode** — exact model/version if known; otherwise the model family plus a live-schema verification note.
2. **Prompt** — ready to paste, using the selected adapter's syntax.
3. **References** — numbered/named assets and their roles.
4. **Settings** — only verified values; include ratio/duration/audio/seed only when supported.
5. **Acceptance check** — identity, action, camera, audio, text rendering, transition endpoint.

For a scene or movie request, return the above for every shot plus:

- **Shot bible** — immutable continuity tokens and source assets.
- **Beat sheet** — one goal and one ending handoff per shot.
- **Shot ledger** — see [references/movie-workflow.md](references/movie-workflow.md).
- **Editorial handoff** — the next shot's approved first frame, last frame, source clip, or references.

## Handling unknown or unsupported providers

Never silently substitute another model. If live capabilities differ from a reference, the live schema wins and the output must note the divergence.

Happy Horse has no verified provider-owned prompt guide, technical report, or model documentation in this research set. Do not create a "best-practice" adapter for it. Use only the live platform schema verbatim, or recommend a model with documented capabilities.
