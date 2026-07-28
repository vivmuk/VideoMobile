# Alibaba Wan

Use Wan for structured visual direction, first/last-frame transitions, and reproducible task-specific runs. The Wan family has separate text-to-video, image-to-video, unified text-image-to-video, speech-to-video, and Animate variants; select the route before writing the prompt.

## Prompt shape

    Subject and opening composition: [specific subject] in [place].
    Motion: [one ordered movement and environmental response].
    Camera: [framing and one movement].
    Visual: [lighting, palette, texture, style].
    Audio: [only when supported by the chosen route].
    End state: [the handoff to the next shot].

For first/last frame:

    Start at supplied frame 1. [Describe the visible transition and motion].
    Resolve naturally into supplied final frame while preserving [continuity anchors].

Do not send character animation, speech-driven video, or an endpoint transition to a generic T2V route. Record model/checkpoint, task, prompt, assets, seed, and exposed inference settings in the ledger.

Sources: [Alibaba Wan prompting guide](https://help.aliyun.com/en/model-studio/text-to-video-prompt), [Wan first/last-frame guide](https://help.aliyun.com/en/model-studio/image-to-video-first-and-last-frames-guide), [Wan2.2 official repository](https://github.com/Wan-Video/Wan2.2).
