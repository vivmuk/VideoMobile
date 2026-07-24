# Roam video studio

Roam is a focused, mobile-first Venice video front end. It presents four plain-English choices, then selects the matching current Venice model server-side: LTX Video 2.3 Fast, HappyHorse 1.1, Kling O3 Standard, or Wan 2.7. The model catalog is refreshed every five minutes so unavailable and beta models are not sent to customers.

## Run locally

PowerShell:

```powershell
$env:VENICE_API_KEY = "your-key"
node server.mjs
```

Open `http://localhost:3000`.

The API key is held by the Node server and is never delivered to the browser.

## What continues when the screen goes away

- The server writes each accepted Venice queue ID to `data/jobs.json`, then resumes unfinished jobs whenever it starts.
- A background worker polls Venice, downloads a completed MP4, and stores it under `data/videos/` before the browser has to return.
- The browser saves the active job token in `localStorage`. Returning to the app resumes the job view automatically.
- Completed clips are stored in IndexedDB, not `localStorage`, because video files are much larger than browser local-storage quotas. The Download action remains available if device storage is refused or cleared.

For a public deployment, run this server on durable hosting and connect jobs to an authenticated user account. Mobile browsers can suspend or terminate background tabs, so the server worker is the reliable mechanism that keeps a Venice generation moving while a user is away. Clipboard shortcuts require HTTPS in production; the normal long-press Paste menu remains the fallback on iPhone and Android.

## Deploy to Railway

Create a new Railway service from `vivmuk/VideoMobile` and set its branch to `codex/roam-video-studio` (or merge that branch into the one you want Railway to track). Add the `VENICE_API_KEY` service variable, then deploy. Railway supplies `PORT` automatically and the `npm start` script starts the app.

No database is required for the first deployment. For durable generation recovery across Railway container restarts, attach a Railway Volume and mount it at `/app/data`; the app writes its job records and completed MP4 files there.

## Mobile behavior

- Native photo picker and a separate camera action work with the operating system's own Photos, Files, and camera choices.
- JPG, PNG, WebP, and GIF files up to 25 MB are accepted. HEIC is caught early with a direct recovery path.
- The description is saved without the image, avoiding large mobile-storage writes.
- The interface uses 16 px form text to avoid iPhone Safari input zoom, safe-area padding, and `100dvh` where viewport height matters.
- Every model choice is shown as an outcome first and an actual Venice model second, so a new user can choose without learning vendor terminology.
