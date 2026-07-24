import { createServer } from "node:http";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { extname, join } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

const PORT = Number(process.env.PORT || 3000);
const VENICE_BASE = "https://api.venice.ai/api/v1";
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const MEDIA_TTL_MS = 15 * 60 * 1000;
const DATA_DIR = join(process.cwd(), "data");
const VIDEO_DIR = join(DATA_DIR, "videos");
const JOBS_FILE = join(DATA_DIR, "jobs.json");
const uploads = new Map();
const jobs = new Map();
const activeMonitors = new Set();
let pendingJobWrite = Promise.resolve();
let videoCatalog = null;
let videoCatalogExpiresAt = 0;

const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const validDurations = new Set(["5s", "10s"]);
const validRatios = new Set(["9:16", "16:9", "1:1"]);
const MODEL_CATALOG_TTL_MS = 5 * 60 * 1000;
const videoProfiles = [
  {
    id: "fast",
    name: "Fast draft",
    provider: "LTX Video 2.3 Fast",
    description: "Quick tests and simple scenes.",
    models: { text: "ltx-2-v2-3-fast-text-to-video", image: "ltx-2-v2-3-fast-image-to-video" }
  },
  {
    id: "movement",
    name: "Natural movement",
    provider: "HappyHorse 1.1",
    description: "People, animals, and lively movement.",
    models: { text: "happyhorse-1-1-text-to-video", image: "happyhorse-1-1-image-to-video" }
  },
  {
    id: "cinematic",
    name: "Cinematic",
    provider: "Kling O3 Standard",
    description: "Polished camera work and visual detail.",
    models: { text: "kling-o3-standard-text-to-video", image: "kling-o3-standard-image-to-video" }
  },
  {
    id: "creative",
    name: "Creative detail",
    provider: "Wan 2.7",
    description: "Expressive scenes led by a detailed prompt.",
    models: { text: "wan-2-7-text-to-video", image: "wan-2-7-image-to-video" }
  }
];

await mkdir(VIDEO_DIR, { recursive: true });

async function loadJobs() {
  try {
    const saved = JSON.parse(await readFile(JOBS_FILE, "utf8"));
    for (const job of saved) {
      if (job?.queue_id && job?.access_token && job?.model && job?.status) jobs.set(job.queue_id, job);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") console.warn("Could not restore saved jobs. Starting with an empty queue.");
  }
}

function persistJobs() {
  const contents = JSON.stringify([...jobs.values()]);
  pendingJobWrite = pendingJobWrite.catch(() => undefined).then(async () => {
    const temporary = `${JOBS_FILE}.${randomUUID()}.tmp`;
    await writeFile(temporary, contents, "utf8");
    await rename(temporary, JOBS_FILE);
  });
  return pendingJobWrite;
}

async function createJobRecord(job) {
  jobs.set(job.queue_id, job);
  await persistJobs();
}

async function updateJob(queueId, changes) {
  const existing = jobs.get(queueId);
  if (!existing) return;
  jobs.set(queueId, { ...existing, ...changes, updated_at: Date.now() });
  await persistJobs();
}

const getJob = (queueId) => jobs.get(queueId);
const getOwnedJob = (queueId, accessToken) => {
  const job = jobs.get(queueId);
  return job?.access_token === accessToken ? job : undefined;
};
const pendingJobs = () => [...jobs.values()].filter((job) => ["QUEUED", "PROCESSING"].includes(job.status));

await loadJobs();

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function sendStatic(res, pathname) {
  const files = {
    "/": ["public/index.html", "text/html; charset=utf-8"],
    "/styles.css": ["public/styles.css", "text/css; charset=utf-8"],
    "/app.js": ["public/app.js", "text/javascript; charset=utf-8"]
  };
  const entry = files[pathname];
  if (!entry) return false;
  readFile(entry[0])
    .then((content) => {
      res.writeHead(200, { "Content-Type": entry[1], "Cache-Control": "no-cache" });
      res.end(content);
    })
    .catch(() => json(res, 500, { error: "Could not load the app." }));
  return true;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 200_000) throw new Error("Request is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request was not valid JSON.");
  }
}

function apiKey() {
  const key = process.env.VENICE_API_KEY;
  if (!key) throw new Error("VENICE_API_KEY is not set on the server.");
  return key;
}

async function venice(path, body) {
  const response = await fetch(`${VENICE_BASE}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { response, contentType: response.headers.get("content-type") || "" };
}

async function veniceGet(path) {
  const response = await fetch(`${VENICE_BASE}/${path}`, {
    headers: { Authorization: `Bearer ${apiKey()}` }
  });
  return response;
}

async function getVideoCatalog() {
  if (videoCatalog && Date.now() < videoCatalogExpiresAt) return videoCatalog;
  try {
    const response = await veniceGet("models?type=video");
    if (!response.ok) throw new Error("Venice could not load its video models.");
    const body = await response.json();
    videoCatalog = Array.isArray(body.data) ? body.data.filter((entry) => !entry.model_spec?.offline && !entry.model_spec?.beta && !entry.model_spec?.betaModel) : [];
    videoCatalogExpiresAt = Date.now() + MODEL_CATALOG_TTL_MS;
    return videoCatalog;
  } catch {
    return [];
  }
}

function profileFor(id) {
  return videoProfiles.find((profile) => profile.id === id) || videoProfiles[0];
}

function modelForProfile(profile, catalog, hasImage) {
  const modelId = profile.models[hasImage ? "image" : "text"];
  return catalog.find((entry) => entry.id === modelId) || null;
}

function profileResponse(profile, catalog) {
  const text = modelForProfile(profile, catalog, false);
  const image = modelForProfile(profile, catalog, true);
  return {
    id: profile.id,
    name: profile.name,
    provider: text?.model_spec?.name || image?.model_spec?.name || profile.provider,
    description: profile.description,
    supportsText: catalog.length === 0 || Boolean(text),
    supportsPhoto: catalog.length === 0 || Boolean(image)
  };
}

function supportedValues(values, allowed) {
  if (!Array.isArray(values) || values.length === 0) return allowed;
  return allowed.filter((value) => values.includes(value));
}

async function jobSettings(input) {
  if (!validDurations.has(input.duration) || !validRatios.has(input.aspectRatio)) {
    throw new Error("Choose a supported duration and format.");
  }
  const hasImage = Boolean(input.hasImage);
  const profile = profileFor(input.profile);
  const catalog = await getVideoCatalog();
  const selected = modelForProfile(profile, catalog, hasImage);
  if (catalog.length > 0 && !selected) {
    throw new Error(`${profile.name} is not available for ${hasImage ? "photo" : "text"} videos right now. Choose another option.`);
  }
  const constraints = selected?.model_spec?.constraints || {};
  const durations = supportedValues(constraints.durations, [...validDurations]);
  const aspectRatios = supportedValues(constraints.aspect_ratios, [...validRatios]);
  if (!durations.includes(input.duration)) {
    throw new Error(`${profile.name} supports ${durations.join(" or ")} clips in this studio.`);
  }
  if (!aspectRatios.includes(input.aspectRatio)) {
    throw new Error(`${profile.name} does not support that format. Try ${aspectRatios[0] || "a different format"}.`);
  }
  const resolution = Array.isArray(constraints.resolutions) && constraints.resolutions.length > 0
    ? (constraints.resolutions.includes("720p") ? "720p" : constraints.resolutions[0])
    : "720p";
  const settings = {
    model: selected?.id || profile.models[hasImage ? "image" : "text"],
    duration: input.duration
  };
  if (!selected || Array.isArray(constraints.aspect_ratios)) settings.aspect_ratio = input.aspectRatio;
  if (!selected || Array.isArray(constraints.resolutions)) settings.resolution = resolution;
  if (!selected || constraints.audio_configurable === true) settings.audio = Boolean(input.audio);
  return settings;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function finalizeAtVenice(job) {
  try {
    await venice("video/complete", { model: job.model, queue_id: job.queue_id });
  } catch {
    // The downloaded file remains available locally if Venice cleanup is delayed.
  }
}

async function saveCompletedVideo(job, video) {
  const filename = `${job.queue_id}.mp4`;
  const destination = join(VIDEO_DIR, filename);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await writeFile(temporary, video);
  await rename(temporary, destination);
  await updateJob(job.queue_id, { status: "COMPLETED", video_path: filename, error_message: null });
  await finalizeAtVenice(job);
}

async function monitorJob(queueId) {
  if (activeMonitors.has(queueId)) return;
  activeMonitors.add(queueId);
  try {
    while (true) {
      const job = getJob(queueId);
      if (!job || !["QUEUED", "PROCESSING"].includes(job.status)) return;
      let upstream;
      try {
        upstream = await venice("video/retrieve", { model: job.model, queue_id: job.queue_id });
      } catch (error) {
        await wait(10_000);
        continue;
      }
      const { response, contentType } = upstream;
      if (response.status === 503) {
        await updateJob(job.queue_id, { status: "PROCESSING", average_execution_time: null, execution_duration: null, error_message: null });
        await wait(10_000);
        continue;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        await updateJob(job.queue_id, { status: "FAILED", error_message: body.error || "Venice could not complete this video." });
        return;
      }
      if (contentType.startsWith("video/")) {
        await saveCompletedVideo(job, Buffer.from(await response.arrayBuffer()));
        return;
      }
      const body = await response.json().catch(() => ({}));
      if (body.status === "COMPLETED" && job.download_url) {
        const download = await fetch(job.download_url);
        if (!download.ok) {
          await updateJob(job.queue_id, { status: "FAILED", error_message: "The video is ready, but its download link could not be opened." });
          return;
        }
        await saveCompletedVideo(job, Buffer.from(await download.arrayBuffer()));
        return;
      }
      if (body.status === "PROCESSING" || body.status === "QUEUED") {
        await updateJob(job.queue_id, { status: body.status, average_execution_time: body.average_execution_time || null, execution_duration: body.execution_duration || null, error_message: null });
        await wait(5_000);
        continue;
      }
      await updateJob(job.queue_id, { status: "FAILED", error_message: body.error || "Venice returned an unexpected job status." });
      return;
    }
  } catch (error) {
    await updateJob(queueId, { status: "FAILED", error_message: error instanceof Error ? error.message : "The background worker stopped unexpectedly." });
  } finally {
    activeMonitors.delete(queueId);
  }
}

async function handleMedia(req, res) {
  const length = Number(req.headers["content-length"] || 0);
  if (length && length > MAX_MEDIA_BYTES + 1_000_000) return json(res, 413, { error: "This file is larger than 25 MB." });
  const request = new Request("http://localhost/api/media", {
    method: "POST",
    headers: req.headers,
    body: Readable.toWeb(req),
    duplex: "half"
  });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return json(res, 400, { error: "Choose a photo first." });
  const extension = extname(file.name).toLowerCase();
  if (file.type === "image/heic" || file.type === "image/heif" || [".heic", ".heif"].includes(extension)) {
    return json(res, 415, { error: "This is a HEIC photo. Export or share it as JPG, PNG, or WebP, then try again." });
  }
  if (!imageTypes.has(file.type) && !imageExtensions.has(extension)) return json(res, 415, { error: "Use a JPG, PNG, WebP, or GIF photo." });
  if (file.size > MAX_MEDIA_BYTES) return json(res, 413, { error: "This file is larger than 25 MB." });
  const buffer = Buffer.from(await file.arrayBuffer());
  const token = randomUUID();
  uploads.set(token, { dataUrl: `data:${imageTypes.has(file.type) ? file.type : "image/jpeg"};base64,${buffer.toString("base64")}`, createdAt: Date.now() });
  json(res, 201, { mediaToken: token });
}

async function handleQuote(req, res) {
  const input = await readJson(req);
  const settings = await jobSettings(input);
  const { response } = await venice("video/quote", settings);
  const body = await response.json().catch(() => ({ error: "Venice could not provide a quote." }));
  json(res, response.status, body);
}

async function handleQueue(req, res) {
  const input = await readJson(req);
  const prompt = String(input.prompt || "").trim();
  if (!prompt) return json(res, 400, { error: "Describe the video you want to make." });
  if (prompt.length > 2_500) return json(res, 400, { error: "Keep the description under 2,500 characters." });
  const hasImage = Boolean(input.mediaToken);
  const settings = await jobSettings({ ...input, hasImage });
  const requestBody = { ...settings, prompt };
  if (hasImage) {
    const media = uploads.get(input.mediaToken);
    if (!media) return json(res, 410, { error: "Your photo session expired. Please add it again." });
    requestBody.image_url = media.dataUrl;
  }
  const { response } = await venice("video/queue", requestBody);
  const body = await response.json().catch(() => ({ error: "Venice did not return a readable response." }));
  if (response.ok && body.queue_id) {
    const accessToken = randomUUID();
    const now = Date.now();
    await createJobRecord({
      queue_id: body.queue_id,
      access_token: accessToken,
      model: body.model || settings.model,
      download_url: body.download_url || null,
      status: "QUEUED",
      average_execution_time: null,
      execution_duration: null,
      video_path: null,
      error_message: null,
      created_at: now,
      updated_at: now
    });
    if (input.mediaToken) uploads.delete(input.mediaToken);
    void monitorJob(body.queue_id);
    return json(res, response.status, { queueId: body.queue_id, accessToken });
  }
  json(res, response.status, body);
}

function getAuthorizedJob(url) {
  const match = url.pathname.match(/^\/api\/video\/jobs\/([0-9a-f-]+)(?:\/file)?$/i);
  if (!match) return null;
  const accessToken = url.searchParams.get("token");
  if (!accessToken) return { error: "Missing job token." };
  const job = getOwnedJob(match[1], accessToken);
  return job ? { job, isFile: url.pathname.endsWith("/file") } : { error: "This job is not available on this device." };
}

async function handleJobGet(url, res) {
  const result = getAuthorizedJob(url);
  if (!result) return false;
  if (result.error) {
    json(res, 404, { error: result.error });
    return true;
  }
  const { job, isFile } = result;
  if (!isFile) {
    json(res, 200, {
      status: job.status,
      averageExecutionTime: job.average_execution_time,
      executionDuration: job.execution_duration,
      error: job.error_message,
      ready: job.status === "COMPLETED"
    });
    return true;
  }
  if (job.status !== "COMPLETED" || !job.video_path) {
    json(res, 409, { error: "This video is not ready yet." });
    return true;
  }
  try {
    const video = await readFile(join(VIDEO_DIR, job.video_path));
    res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": video.length, "Cache-Control": "private, max-age=31536000" });
    res.end(video);
  } catch {
    json(res, 410, { error: "The saved video is no longer available." });
  }
  return true;
}

setInterval(() => {
  const cutoff = Date.now() - MEDIA_TTL_MS;
  for (const [token, media] of uploads) if (media.createdAt < cutoff) uploads.delete(token);
}, 60_000).unref();

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  try {
    if (req.method === "GET" && await handleJobGet(url, res)) return;
    if (req.method === "GET" && sendStatic(res, url.pathname)) return;
    if (req.method === "GET" && url.pathname === "/api/video/models") {
      const catalog = await getVideoCatalog();
      return json(res, 200, { profiles: videoProfiles.map((profile) => profileResponse(profile, catalog)), live: catalog.length > 0 });
    }
    if (req.method === "POST" && url.pathname === "/api/media") return await handleMedia(req, res);
    if (req.method === "POST" && url.pathname === "/api/video/quote") return await handleQuote(req, res);
    if (req.method === "POST" && url.pathname === "/api/video/queue") return await handleQueue(req, res);
    json(res, 404, { error: "Not found." });
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : "Unexpected server error." });
  }
});

server.listen(PORT, () => {
  for (const job of pendingJobs()) void monitorJob(job.queue_id);
  console.log(`Roam is ready at http://localhost:${PORT}`);
});
