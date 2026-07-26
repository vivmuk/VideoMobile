# Movie workflow

Use this reference for scenes, episodes, trailers, or any request with more than one shot.

## 1. Shot bible

Create before prompting. Use exact, repeatable wording for:

- Characters: identity, age range, face/hair markers, body type, wardrobe, behavior.
- World: location, time, weather, palette, texture, period, props.
- Cinematography: aspect ratio, lens/framing vocabulary, camera restraint, lighting.
- Sound: language, speaker voices, music palette, ambience, silence rules.
- Assets: approved character, wardrobe, prop, location, sound, and previous-shot references.

Only change a bible value in an explicit continuity revision.

## 2. Beat sheet

Split the story into short clips. Every shot needs:

| Field | Requirement |
| --- | --- |
| Dramatic goal | One change or revelation. |
| Opening state | What the audience sees first. |
| Action | Ordered, physical action. |
| Camera | One dominant move or an explicit provider-supported timed/cut plan. |
| Sound | Dialogue, ambience, effects, music, or intentional silence. |
| Ending handoff | An approved frame, clip, prop state, or action for the next shot. |

## 3. Generation ledger

Record every attempted and approved take:

    shot_id:
    model_family:
    exact_model_version:
    mode:
    prompt_revision:
    reference_asset_ids:
    validated_settings:
    seed_or_run_id:
    output_archive_path:
    approval_status:
    continuity_notes:
    next_shot_handoff:

Archive approved media promptly. Do not rely on a temporary provider URL as a film library.

## 4. Review loop

Review one variable at a time: identity/wardrobe, action/physics, camera, audio/lipsync, text/signage, and end frame. Revise narrowly; do not re-roll an approved visual world for a tiny edit.

## 5. Provider-independent delivery format

Use this output structure:

    ## Shot 03 — [short title]
    Adapter/mode: [provider mode]
    References: [asset -> role]
    Prompt: [paste-ready prompt]
    Settings: [only live-schema-validated fields]
    Review: [acceptance checks]
    Handoff: [what the next shot receives]
