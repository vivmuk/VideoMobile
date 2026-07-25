# Roam video studio

Roam is a focused, mobile-first Venice video front end, presented as a dark terminal-style **Command Center**: one prompt console, one row of labelled controls, one preview, one Generate button. The server refreshes the Venice catalog before catalog, quote, and queue requests, then only exposes fields that the selected model currently accepts.

## Command Center interface

- **Three modes, clearly labelled:** `IMAGE → VIDEO` (the default, because it is what most people want), `TEXT → VIDEO`, and `VIDEO → VIDEO`. The mode filters the model list, changes the upload requirements, and renames the source panel.
- **Every live Venice video model is selectable.** The picker groups the studio's recommended models first, then lists the rest of the account's catalog. Transition, reference, motion-control, and upscale models appear under the mode that matches their input.
- **Only supported parameters are shown.** Length, shape, quality, upscale factor, sound, and the prompt character limit come from that model's current `model_spec.constraints`, so a setting that a model does not accept is never displayed or sent.
- **Price before generation.** `GENERATE` fetches the exact Venice quote and turns into `CONFIRM · $x.xx`; the job is only submitted on the second press, and any settings change invalidates the price.
- **Advanced, not hidden:** sound, negative prompt, and the full model spec live in a collapsed `ADVANCED` panel. History and access controls open as drawers.
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
- The browser saves the active job token in `localStorage`. Returning to the app resumes the job view automatically.
- Completed clips are stored in IndexedDB, not `localStorage`, because video files are much larger than browser local-storage quotas. The Download action remains available if device storage is refused or cleared.
- The last 20 finished clips stay in the `HISTORY` drawer. Opening one replays it from device storage; deleting one removes both the entry and the stored file.

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
