# Google Gemini Omni Flash

Use for multimodal reference-to-video and conversational edits. Google documents text, image, audio, and video input, text-to-video audio output, timecoded generation beats, and edits through a previous interaction ID.

## Prompt shape

    [0-3s] Framing and camera move. Specific subject performs one action in a named place.
    [3-8s] The action resolves to one clear end state. Lighting, materials, and mood.
    Sound: ambience and precise effects. Dialogue: [named speaker]: [short line].

For references:

    Use image 1 for [character], image 2 for [wardrobe], and video 1 for [motion rhythm].
    Preserve [anchors]. Change only [requested change]. Camera: [move]. Sound: [direction].

Use timecodes only when a clip genuinely needs several timed beats. Use a narrow follow-up edit in the same interaction to preserve approved details.

Do not imply that a preview model or a particular input limit is permanently available. Verify the live model/schema.

Sources: [Gemini Omni API guide](https://ai.google.dev/gemini-api/docs/omni), [Gemini Omni model page](https://deepmind.google/models/gemini-omni/).
