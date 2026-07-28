# Kuaishou Kling

Use Kling for custom shot segments and named visual references. Kuaishou describes Multimodal Visual Language as text for semantic intent plus image/video references for identity, appearance, style, scenarios, actions, expressions, and camera movement. Current Kling V3 documentation exposes text-to-video, image-to-video, first/last-frame work, reference-to-video, editing, audio, and custom multishot segments.

## Prompt shapes

Single shot:

    [Framing.] [Named subject] [does one clear action] in [specific setting].
    Camera [one move]. [Lighting/style]. Audio: [essential sound].

Custom multishot:

    Shot 1, [duration]: Establish place and immediate objective.
    Shot 2, [duration]: Action/reveal; state the camera change.
    Shot 3, [duration]: Reaction/end frame for the next shot.

Use provider placeholders such as <<<element_1>>>, <<<image_1>>>, or <<<video_1>>> only when the exact active Kling Omni API exposes them and the media order is validated. Bind a recurring entity/reference instead of re-describing it in every shot.

Select duration, ratio, audio, and reference fields from the live schema; do not derive them from prose.

Sources: [Kling V3 API documentation](https://help.aliyun.com/en/model-studio/kling-video-generation-api-reference/), [Kuaishou Kling 2.0 announcement](https://ir.kuaishou.com/news-releases/news-release-details/kling-ai-advances-20-era-empowering-everyone-tell-great-stories/).
