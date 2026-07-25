# vivvideo

vivvideo is a focused, mobile-first Venice video front end, presented as a dark terminal-style **Command Center**: one prompt console, one row of labelled controls, one preview, one Generate button. The server refreshes the Venice catalog before catalog, quote, and queue requests, then only exposes fields that the selected model currently accepts.

## Command Center interface

- **Three modes, clearly labelled:** `IMAGE → VIDEO` (the default, because it is what most people want), `TEXT → VIDEO`, and `VIDEO → VIDEO`. The mode filters the model list, changes the upload requirements, and renames the source panel.
- **Every live Venice video model is selectable.** The picker groups the studio's recommended models first, then lists the rest of the account's catalog. Transition, reference, motion-control, and upscale models appear under the mode that matches their input.
- **Only supported parameters are shown.** Length, shape, quality, upscale factor, sound, and the prompt character limit come from that model's current `model_spec.constraints`, so a setting that a model does not accept is never displayed or sent.
- **Price before generation.** `GENERATE` fetches the exact Venice quote and turns into `CONFIRM · $x.xx`; the job is only submitted on the second press, and any settings change invalidates the price.
- **Prompt optimizer.** The wand button in the corner of the prompt box rewrites a rough draft into a full shot description — subject, action, setting, camera, light, atmosphere, style, motion detail — through Venice's own text model, adapted to the selected video model, mode, clip length, framing and sound support. Pressing it again restores the creator's own wording, and typing clears the undo buffer. Set `VENICE_PROMPT_MODEL` to pin a specific text model; otherwise the `default` text trait is resolved from Venice and cached.
- **Advanced, not hidden:** sound, negative prompt, and the full model spec live in a collapsed `ADVANCED` panel. History and access controls open as drawers.
- **Sound is on by default** and stays that way. Choosing a model that cannot generate audio no longer overwrites the creator's preference for every model chosen afterwards; the toggle reflects what the current model actually supports while remembering what was asked for.
- **Generating again from the same photo just works.** A queued job consumes its upload on the server, so the console re-uploads the attached file automatically instead of failing the second run.
- **The whole frame, never cropped.** The preview sizes itself from the finished clip's real dimensions once its metadata loads, so a model that returns a shape other than the one requested is still shown in full rather than cropped to a guessed box. Before generating, the console matches the requested shape to the uploaded photo's own proportions, keeps a `SHAPE` control visible reading `Model decides` when a model fixes its own frame, and warns when the chosen frame cannot hold the whole photo — naming the shape that would.
- **Multiple images, only where the model accepts them.** The server declares how many images each model takes — one for ordinary image-to-video, two for transition models, up to five for reference models — and the picker labels the multi-image ones. A thumbnail tray with add and remove appears only for models with room for more than one, so no slot is ever offered that Venice would reject. Reference images are sent as `reference_image_urls`, or as a Kling `elements[0]` entry with `frontal_image_url` plus its own `reference_image_urls`; transition models get `image_url` and `end_image_url`.
- **`/about`** is a plain-language model guide: what each mode is for, which model family suits which job, and how to write a better prompt. It also lists the models the connected account can use right now.
- Keyboard: `Cmd`/`Ctrl` + `Enter` generates, `Esc` closes drawers, plain `Enter` inserts a newline in the prompt.

## Run locally

PowerShell:

```powershell
$env:VENICE_API_KEY = "your-key"
$env:ROAM_SHARED_PASSWORD = "Aubrey" # optional: defaults to Aubrey
$env:ROAM_JOB_ENCRYPTION_KEY = "a-long-random-secret" # recommended for personal-key job recovery
node server.mjs
```

Open `http://localhost:3000`.

The API key is held by the Node server and is never delivered to the browser.

## Access modes

- **Personal Venice key:** a creator pastes their own API key. The browser keeps it in session storage only, not local storage. The server uses it for quotes and generation, and encrypts it at rest only while its background worker needs it to finish the queued job. It is removed when the job completes or fails.
- **Shared studio:** the creator enters the shared password (`Aubrey` by default, or `ROAM_SHARED_PASSWORD`). The server issues a 30-day, HttpOnly device cookie and uses its own `VENICE_API_KEY`. This is a convenience gate, not a substitute for individual accounts or billing controls.
- Set `ROAM_JOB_ENCRYPTION_KEY` in production to a long random value. Do not rotate it while personal-key jobs are in progress.

## What continues when the screen goes away

- The server writes each accepted Venice queue ID to `data/jobs.json`, then resumes unfinished jobs whenever it starts.
- A personal Venice key is encrypted in that job record only while it is needed for recovery; it is cleared as soon as the generation reaches a terminal state.
- A background worker polls Venice, downloads a completed MP4, and stores it under `data/videos/` before the browser has to return.
- Finished clips are served with byte-range support (`Accept-Ranges`, `206 Partial Content`, `HEAD`), which iOS Safari requires before it will play a video at all, and which lets Android players seek. The preview element tries the streamed URL first and falls back to the stored copy on this device; if neither decodes, it says so plainly and keeps Download and open-in-a-new-tab available rather than showing a broken player.
- The browser saves the active job token in `localStorage`. Returning to the app resumes the job view automatically. Status checks are guarded against re-entry, because a phone firing `visibilitychange` and `online` while a job finishes would otherwise deliver the same clip twice and lose it.
- The server logs each accepted queue id, each completion, and every failed Venice call with its status and message, so a generation that does not arrive can be traced from the log.
- Completed clips are stored in IndexedDB, not `localStorage`, because video files are much larger than browser local-storage quotas. The Download action remains available if device storage is refused or cleared.
- The last 20 finished clips stay in the `HISTORY` drawer. Opening one replays it from device storage; deleting one removes both the entry and the stored file.
- **`NEW` is a real reset.** It stops following the current job and forgets its token, clears the prompt, the negative prompt, the attached image and any extra frames, drops the finished clip and revokes its object URL, deletes the saved draft, and re-checks access and the live model catalog. Saved clips in `HISTORY` are deliberately untouched.
- **Coming back after a long gap starts clean.** Settings are preferences and always return, but a written prompt older than six hours is dropped, a finished clip older than two hours stays in `HISTORY` instead of filling the preview, and a remembered job older than six hours is discarded rather than polled.
- **A job the server no longer knows about no longer wedges the console.** Status checks give up after five consecutive failures, clear the stored token, and say so — previously they retried forever, leaving `GENERATE` disabled and no way to start another video.
- **`CLEAR EVERYTHING`** in the access drawer deletes every stored clip, the history list, the saved draft and the active job token, and drops the IndexedDB database. It takes two taps to confirm and leaves the creator connected.

For a public deployment, run this server on durable hosting and connect jobs to an authenticated user account. Mobile browsers can suspend or terminate background tabs, so the server worker is the reliable mechanism that keeps a Venice generation moving while a user is away. Clipboard shortcuts require HTTPS in production; the normal long-press Paste menu remains the fallback on iPhone and Android.

## Live Venice model catalog

- The model picker asks Venice for `GET /models?type=video` before every catalog, quote, and queue request. Offline models are omitted; beta models remain visible and are labelled because their availability depends on the creator's Venice access level.
- The advanced picker includes text-to-video, image-to-video, reference-image, two-image transition, video-to-video, motion-control, and video-upscale models. It changes the required upload guidance for each model.
- Duration, aspect ratio, resolution, configurable audio, prompt limit, and upscale factor are derived from that model's current `model_spec.constraints`. A parameter that the model does not accept is not sent to Venice.
- Every advanced entry includes a plain-language “Great for” note. Wan 2.7 is explicitly labelled **Uncensored**, and Grok Imagine 1.5 Private is explicitly labelled as private image-to-video.

## Deploy to Railway

Create a new Railway service from `vivmuk/VideoMobile` and set its branch to `codex/roam-video-studio` (or merge that branch into the one you want Railway to track). Add the `VENICE_API_KEY` service variable, then deploy. Railway supplies `PORT` automatically and the `npm start` script starts the app.

No database is required for the first deployment. For durable generation recovery across Railway container restarts, attach a Railway Volume and mount it at `/app/data`; the app writes its job records and completed MP4 files there.

## Mobile behavior

- The mode tabs, prompt, starting image, all four controls, and the Generate button fit on one phone screen; the preview and advanced settings sit just below. There is never horizontal scrolling.
- The Generate button and its status line stick to the bottom of the viewport, so the primary action stays reachable while scrolling.
- Native photo picker and a separate camera action work with the operating system's own Photos, Files, and camera choices.
- JPG, PNG, WebP, and GIF files up to 25 MB are accepted. HEIC is caught early with a direct recovery path.
- The description is saved without the image, avoiding large mobile-storage writes.
- The interface uses 15–16 px form text to avoid iPhone Safari input zoom, safe-area padding, and `100dvh` where viewport height matters.
- Every model choice shows a plain-language "Good for:" line under the control, so a new user can choose without learning vendor terminology.
- Grok Imagine 1.5 Private and Wan 2.1 Pro are photo-only options. Wan 2.7 is labelled **Uncensored** to match Venice's model guidance, while still not implying that a user can bypass applicable law or platform rules.
