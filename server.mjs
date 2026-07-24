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

const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const validDurations = new Set(["5s", "10s"]);
const validRatios = new Set(["9:16", "16:9", "1:1"]);

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

function jobSettings(input) {
  if (!validDurations.has(input.duration) || !validRatios.has(input.aspectRatio)) {
    throw new Error("Choose a supported duration and format.");
  }
  return {
    model: input.hasImage ? "seedance-2-0-fast-image-to-video" : "seedance-2-0-fast-text-to-video",
    duration: input.duration,
    aspect_ratio: input.aspectRatio,
    resolution: "720p",
    audio: Boolean(input.audio)
  };
}

function validSeedanceConsent(consents) {
  const consent = consents?.seedance;
  if (!consent) return undefined;
  const fields = ["confirmed_terms_and_privacy", "confirmed_legal_right", "confirmed_screening_acknowledged"];
  if (Object.keys(consent).length !== fields.length || !fields.every((field) => consent[field] === true)) {
    throw new Error("All face consent confirmations are required.");
  }
  return { seedance: Object.fromEntries(fields.map((field) => [field, true])) };
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
  const settings = jobSettings(input);
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
  const settings = jobSettings({ ...input, hasImage });
  const requestBody = { ...settings, prompt };
  if (hasImage) {
    const media = uploads.get(input.mediaToken);
    if (!media) return json(res, 410, { error: "Your photo session expired. Please add it again." });
    requestBody.image_url = media.dataUrl;
  }
  const consents = validSeedanceConsent(input.consents);
  if (consents) requestBody.consents = consents;

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
