import { createServer } from "node:http";
import { Readable } from "node:stream";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
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
const videoCatalogs = new Map();

const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const videoTypes = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const videoExtensions = new Set([".mp4", ".mov", ".webm"]);
const fallbackDurations = ["5s", "10s"];
const fallbackRatios = ["9:16", "16:9", "1:1"];
const fallbackResolutions = ["720p"];
const MODEL_CATALOG_TTL_MS = 0;
const SHARED_ACCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const videoProfiles = [
  {
    id: "fast",
    name: "Fast draft",
    provider: "LTX Video 2.3 Fast",
    description: "Quick tests and simple scenes.",
    privacy: "Anonymized",
    models: { text: "ltx-2-v2-3-fast-text-to-video", image: "ltx-2-v2-3-fast-image-to-video" }
  },
  {
    id: "movement",
    name: "Natural movement",
    provider: "HappyHorse 1.1",
    description: "People, animals, and lively movement.",
    privacy: "Anonymized",
    models: { text: "happyhorse-1-1-text-to-video", image: "happyhorse-1-1-image-to-video" }
  },
  {
    id: "seedance",
    name: "Cinematic precision",
    provider: "Seedance 2.0",
    description: "Detailed shots, lighting, camera direction, and native audio.",
    privacy: "Anonymized",
    models: { text: "seedance-2-0-text-to-video", image: "seedance-2-0-image-to-video" }
  },
  {
    id: "grok-private",
    name: "Mood and emotion",
    provider: "Grok Imagine Private",
    description: "Private, conversational storytelling with human emotion and atmosphere.",
    privacy: "Private",
    models: { text: "grok-imagine-text-to-video-private", image: "grok-imagine-image-to-video-private" }
  },
  {
    id: "grok-15-private",
    name: "Grok Imagine 1.5 Private",
    provider: "Grok Imagine 1.5 Private",
    description: "Private photo animation with a strong starting image.",
    privacy: "Private · Photo required",
    models: { image: "grok-imagine-1-5-image-to-video-private" }
  },
  {
    id: "kling",
    name: "Polished production",
    provider: "Kling O3 Standard",
    description: "Balanced quality and speed for refined camera work.",
    privacy: "Anonymized",
    models: { text: "kling-o3-standard-text-to-video", image: "kling-o3-standard-image-to-video" }
  },
  {
    id: "wan-unrestricted",
    name: "Uncensored creative",
    provider: "Wan 2.7 Uncensored",
    description: "Venice's uncensored option for explicit, detailed creative direction.",
    privacy: "Anonymized · Uncensored",
    models: { text: "wan-2-7-text-to-video", image: "wan-2-7-image-to-video" }
  },
  {
    id: "wan-private",
    name: "Private photo motion",
    provider: "Wan 2.1 Pro",
    description: "Private image-to-video when you want to animate a supplied frame.",
    privacy: "Private · Photo required",
    models: { image: "wan-2-1-pro-image-to-video" }
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

async function failJob(queueId, errorMessage) {
  await updateJob(queueId, { status: "FAILED", error_message: errorMessage, encrypted_personal_key: null });
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

function serverApiKey() {
  const key = process.env.VENICE_API_KEY;
  if (!key) throw new Error("VENICE_API_KEY is not set on the server.");
  return key;
}

function accessSecret() {
  return process.env.ROAM_ACCESS_TOKEN_SECRET || serverApiKey();
}

function encryptionKey() {
  return createHash("sha256").update(process.env.ROAM_JOB_ENCRYPTION_KEY || serverApiKey()).digest();
}

function equalSecrets(left, right) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function cookieValue(req, name) {
  const prefix = `${name}=`;
  return String(req.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length) || null;
}

function createSharedAccessToken() {
  const expiresAt = Date.now() + SHARED_ACCESS_TTL_MS;
  const signature = createHmac("sha256", accessSecret()).update(`shared:${expiresAt}`).digest("base64url");
  return `${expiresAt}.${signature}`;
}

function hasSharedAccess(req) {
  const token = cookieValue(req, "roam_shared_access");
  if (!token) return false;
  const [expiresAt, signature] = token.split(".");
  const expires = Number(expiresAt);
  if (!Number.isSafeInteger(expires) || expires < Date.now() || !signature) return false;
  const expected = createHmac("sha256", accessSecret()).update(`shared:${expires}`).digest("base64url");
  return equalSecrets(signature, expected);
}

function sharedCookie(req, token, maxAge) {
  const secure = String(req.headers["x-forwarded-proto"] || "").split(",")[0] === "https" ? "; Secure" : "";
  return `roam_shared_access=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function encryptPersonalKey(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptPersonalKey(value) {
  const [iv, tag, encrypted] = String(value || "").split(".");
  if (!iv || !tag || !encrypted) throw new Error("The saved credentials for this video are incomplete.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

function inferenceAccess(req) {
  const personalKey = String(req.headers["x-venice-api-key"] || "").trim();
  if (personalKey) {
    if (personalKey.length > 512) throw new Error("That Venice API key is not valid.");
    return { apiKey: personalKey, encryptedPersonalKey: encryptPersonalKey(personalKey) };
  }
  if (hasSharedAccess(req)) return { apiKey: serverApiKey(), encryptedPersonalKey: null };
  const error = new Error("Enter your Venice API key or unlock the shared studio first.");
  error.statusCode = 401;
  throw error;
}

function jobApiKey(job) {
  return job.encrypted_personal_key ? decryptPersonalKey(job.encrypted_personal_key) : serverApiKey();
}

async function venice(path, body, key) {
  const response = await fetch(`${VENICE_BASE}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { response, contentType: response.headers.get("content-type") || "" };
}

async function veniceGet(path, key) {
  const response = await fetch(`${VENICE_BASE}/${path}`, {
    headers: { Authorization: `Bearer ${key}` }
  });
  return response;
}

async function getVideoCatalog(key) {
  const cacheKey = createHash("sha256").update(key).digest("base64url");
  const cached = videoCatalogs.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.data;
  try {
    const response = await veniceGet("models?type=video", key);
    if (!response.ok) throw new Error("Venice could not load its video models.");
    const body = await response.json();
    const data = Array.isArray(body.data) ? body.data.filter((entry) => !entry.model_spec?.offline) : [];
    videoCatalogs.set(cacheKey, { data, expiresAt: Date.now() + MODEL_CATALOG_TTL_MS });
    return data;
  } catch {
    return [];
  }
}

function profileFor(id) {
  return videoProfiles.find((profile) => profile.id === id) || videoProfiles[0];
}

function modelForProfile(profile, catalog, hasImage) {
  const modelId = profile.models[hasImage ? "image" : "text"];
  if (!modelId) return null;
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
    privacy: profile.privacy,
    supportsText: catalog.length === 0 || Boolean(text),
    supportsPhoto: catalog.length === 0 || Boolean(image),
    textOptions: modelOptions(text),
    photoOptions: modelOptions(image)
  };
}

function supportsSource(model, hasImage) {
  return modelInputKind(model) === (hasImage ? "image" : "text");
}

function modelInputKind(model) {
  const id = model?.id || "";
  const type = model?.model_spec?.constraints?.model_type;
  if (type === "video" || id.includes("video-to-video") || id.includes("motion-control") || id.includes("upscale")) return "video";
  if (id.includes("transition")) return "transition";
  if (id.includes("reference-to-video")) return "reference";
  if (type === "image-to-video" || id.includes("image-to-video")) return "image";
  return "text";
}

function advancedModelResponse(model) {
  const spec = model.model_spec || {};
  return {
    id: model.id,
    name: spec.name || model.id,
    provider: model.id,
    description: spec.description || "Use Venice's live quote to check this model's current options and price.",
    privacy: spec.privacy || "Check Venice settings",
    supportsText: supportsSource(model, false),
    supportsPhoto: supportsSource(model, true),
    inputKind: modelInputKind(model),
    options: modelOptions(model),
    bestFor: modelBestFor(model),
    beta: spec.beta === true || spec.betaModel === true
  };
}

function simpleVideoModels(catalog) {
  return catalog.map(advancedModelResponse);
}

function stringValues(values) {
  return Array.isArray(values) ? values.filter((value) => typeof value === "string" && value.length > 0) : [];
}

function modelOptions(model) {
  if (!model) {
    return {
      durations: fallbackDurations,
      aspectRatios: fallbackRatios,
      resolutions: fallbackResolutions,
      aspectRatioConfigurable: true,
      resolutionConfigurable: true,
      audioAvailable: true,
      audioConfigurable: true,
      promptCharacterLimit: 2_500,
      upscaleFactors: []
    };
  }
  const constraints = model?.model_spec?.constraints || {};
  const durations = stringValues(constraints.durations);
  const aspectRatios = stringValues(constraints.aspect_ratios);
  const resolutions = stringValues(constraints.resolutions);
  const isUpscale = model.id.includes("upscale") || (resolutions.length > 0 && resolutions.every((value) => /^\d+x$/i.test(value)));
  return {
    durations: durations.length ? durations : fallbackDurations,
    aspectRatios,
    resolutions: isUpscale ? [] : resolutions,
    aspectRatioConfigurable: aspectRatios.length > 0,
    resolutionConfigurable: resolutions.length > 0 && !isUpscale,
    audioAvailable: constraints.audio === true,
    audioConfigurable: constraints.audio_configurable === true,
    promptCharacterLimit: Number.isInteger(constraints.prompt_character_limit) ? constraints.prompt_character_limit : 2_500,
    upscaleFactors: isUpscale ? resolutions.map((value) => value.replace(/x$/i, "")) : []
  };
}

function modelBestFor(model) {
  const id = model.id.toLowerCase();
  if (id.includes("upscale")) return "Improving the detail of an existing video.";
  if (id.includes("motion-control")) return "Applying movement from a source video to a new look.";
  if (id.includes("video-to-video") || id.includes("aleph")) return "Restyling or editing an existing video.";
  if (id.includes("transition")) return "Creating a smooth transition between two images.";
  if (id.includes("reference-to-video")) return "Keeping a character, product, or scene consistent from reference images.";
  if (id.includes("wan-2-7") || id.includes("uncensored")) return "Venice's uncensored creative direction; be explicit and detailed in the prompt.";
  if (id.includes("grok-imagine-1-5")) return "Private image-to-video animation with a strong starting frame.";
  if (id.includes("grok-imagine")) return "Private, mood-led storytelling and expressive atmosphere.";
  if (id.includes("seedance")) return "Cinematic shots, specific camera moves, lighting, and detailed direction.";
  if (id.includes("happyhorse")) return "Natural human movement, dance, fitness, and physical action.";
  if (id.includes("wan-2.6")) return "Flexible image or text animation with audio-aware options.";
  if (id.includes("wan-2.5")) return "Quick experiments with short, flexible clips.";
  if (id.includes("veo")) return "Polished short-form scenes with generated sound.";
  if (id.includes("sora")) return "High-fidelity image-led scenes and longer composed clips.";
  if (id.includes("kling")) return "Polished camera work, motion, and production-style shots.";
  if (id.includes("pixverse")) return "Fast social clips, stylized motion, and flexible formats.";
  if (id.includes("vidu")) return "Fast, format-flexible clips with generated sound.";
  if (id.includes("gemini")) return "Quick modern scenes with a compact set of formats.";
  if (id.includes("ovi")) return "Private image-led animation from a single strong frame.";
  if (id.includes("runway")) return "Image-led creative direction and rapid visual iterations.";
  if (id.includes("longcat")) return "Longer private clips where duration matters.";
  if (id.includes("ltx")) return "Fast iterations with explicit control over format and resolution.";
  return "Trying this model's current video style and capabilities.";
}

function inputError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

async function jobSettings(input, key) {
  const hasImage = Boolean(input.hasImage);
  const profile = profileFor(input.profile);
  const catalog = await getVideoCatalog(key);
  const requestedModelId = typeof input.modelId === "string" ? input.modelId : "";
  const selected = requestedModelId ? catalog.find((model) => model.id === requestedModelId) || null : modelForProfile(profile, catalog, hasImage);
  const displayName = selected?.model_spec?.name || profile.name;
  if (requestedModelId && !selected) {
    throw inputError("That model is no longer available. Choose another option from the live catalog.");
  }
  if (!requestedModelId && !profile.models[hasImage ? "image" : "text"]) {
    throw inputError(`${profile.name} needs ${hasImage ? "a different starting point" : "a photo"}.`);
  }
  if (!requestedModelId && catalog.length > 0 && !selected) {
    throw inputError(`${profile.name} is not available for ${hasImage ? "photo" : "text"} videos right now. Choose another option.`);
  }
  const options = modelOptions(selected);
  if (typeof input.duration !== "string" || !options.durations.includes(input.duration)) {
    throw inputError(`${displayName} supports ${options.durations.join(" or ")} clips in this studio.`);
  }
  if (options.aspectRatioConfigurable && (typeof input.aspectRatio !== "string" || !options.aspectRatios.includes(input.aspectRatio))) {
    throw inputError(`${displayName} does not support that format. Try ${options.aspectRatios[0] || "a different format"}.`);
  }
  if (options.resolutionConfigurable && (typeof input.resolution !== "string" || !options.resolutions.includes(input.resolution))) {
    throw inputError(`${displayName} does not support that resolution. Try ${options.resolutions[0] || "a different resolution"}.`);
  }
  if (options.upscaleFactors.length && (!options.upscaleFactors.includes(String(input.upscaleFactor)))) {
    throw inputError(`${displayName} supports ${options.upscaleFactors.map((factor) => `${factor}×`).join(" or ")} enhancement.`);
  }
  const settings = {
    model: selected?.id || profile.models[hasImage ? "image" : "text"],
    duration: input.duration
  };
  if (options.aspectRatioConfigurable) settings.aspect_ratio = input.aspectRatio;
  if (options.resolutionConfigurable) settings.resolution = input.resolution;
  if (options.upscaleFactors.length) settings.upscale_factor = Number(input.upscaleFactor);
  if (options.audioConfigurable) settings.audio = Boolean(input.audio);
  Object.defineProperty(settings, "inputKind", { value: selected ? modelInputKind(selected) : hasImage ? "image" : "text", enumerable: false });
  Object.defineProperty(settings, "promptCharacterLimit", { value: options.promptCharacterLimit, enumerable: false });
  return settings;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function finalizeAtVenice(job, key) {
  try {
    await venice("video/complete", { model: job.model, queue_id: job.queue_id }, key);
  } catch {
    // The downloaded file remains available locally if Venice cleanup is delayed.
  }
}

async function saveCompletedVideo(job, video) {
  const key = jobApiKey(job);
  const filename = `${job.queue_id}.mp4`;
  const destination = join(VIDEO_DIR, filename);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await writeFile(temporary, video);
  await rename(temporary, destination);
  await updateJob(job.queue_id, { status: "COMPLETED", video_path: filename, error_message: null });
  await finalizeAtVenice(job, key);
  await updateJob(job.queue_id, { encrypted_personal_key: null });
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
        upstream = await venice("video/retrieve", { model: job.model, queue_id: job.queue_id }, jobApiKey(job));
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
        await failJob(job.queue_id, body.error || "Venice could not complete this video.");
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
          await failJob(job.queue_id, "The video is ready, but its download link could not be opened.");
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
      await failJob(job.queue_id, body.error || "Venice returned an unexpected job status.");
      return;
    }
  } catch (error) {
    await failJob(queueId, error instanceof Error ? error.message : "The background worker stopped unexpectedly.");
  } finally {
    activeMonitors.delete(queueId);
  }
}

async function handleAccessUnlock(req, res) {
  const input = await readJson(req);
  const password = String(input.password || "");
  const expected = process.env.ROAM_SHARED_PASSWORD || "Aubrey";
  if (!password || !equalSecrets(password, expected)) {
    return json(res, 401, { error: "That shared password is not correct." });
  }
  const token = createSharedAccessToken();
  res.setHeader("Set-Cookie", sharedCookie(req, token, Math.floor(SHARED_ACCESS_TTL_MS / 1000)));
  json(res, 200, { sharedAccess: true });
}

function handleAccessStatus(req, res) {
  json(res, 200, { sharedAccess: hasSharedAccess(req) });
}

function handleAccessLogout(req, res) {
  res.setHeader("Set-Cookie", sharedCookie(req, "", 0));
  json(res, 200, { sharedAccess: false });
}

async function handleMedia(req, res) {
  inferenceAccess(req);
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
  const isImage = imageTypes.has(file.type) || imageExtensions.has(extension);
  const isVideo = videoTypes.has(file.type) || videoExtensions.has(extension);
  if (!isImage && !isVideo) return json(res, 415, { error: "Use a JPG, PNG, WebP, GIF, MP4, MOV, or WebM file." });
  if (file.size > MAX_MEDIA_BYTES) return json(res, 413, { error: "This file is larger than 25 MB." });
  const buffer = Buffer.from(await file.arrayBuffer());
  const token = randomUUID();
  const type = isImage ? (imageTypes.has(file.type) ? file.type : "image/jpeg") : (videoTypes.has(file.type) ? file.type : extension === ".mov" ? "video/quicktime" : "video/mp4");
  uploads.set(token, { kind: isImage ? "image" : "video", dataUrl: `data:${type};base64,${buffer.toString("base64")}`, createdAt: Date.now() });
  json(res, 201, { mediaToken: token, kind: isImage ? "image" : "video" });
}

async function handleQuote(req, res) {
  const input = await readJson(req);
  const access = inferenceAccess(req);
  const settings = await jobSettings(input, access.apiKey);
  const { response } = await venice("video/quote", settings, access.apiKey);
  const body = await response.json().catch(() => ({ error: "Venice could not provide a quote." }));
  json(res, response.status, body);
}

async function handleQueue(req, res) {
  const input = await readJson(req);
  const access = inferenceAccess(req);
  const prompt = String(input.prompt || "").trim();
  if (!prompt) return json(res, 400, { error: "Describe the video you want to make." });
  if (prompt.length > 5_000) return json(res, 400, { error: "Keep the description under 5,000 characters." });
  const hasImage = Boolean(input.mediaToken);
  const settings = await jobSettings({ ...input, hasImage }, access.apiKey);
  if (prompt.length > settings.promptCharacterLimit) return json(res, 400, { error: `${settings.model} accepts descriptions up to ${settings.promptCharacterLimit.toLocaleString()} characters.` });
  const requestBody = { ...settings, prompt };
  const sourceMedia = input.mediaToken ? uploads.get(input.mediaToken) : null;
  const expiredMessage = "Your file session expired. Add it again, then try once more.";
  if (settings.inputKind === "text") {
    if (sourceMedia) return json(res, 400, { error: "This model starts from a description. Remove the file or choose an image-to-video model." });
  } else if (!sourceMedia) {
    return json(res, 400, { error: settings.inputKind === "video" ? "Choose a video for this model first." : "Choose a starting image for this model first." });
  } else if (settings.inputKind === "video") {
    if (sourceMedia.kind !== "video") return json(res, 400, { error: "This model needs an MP4, MOV, or WebM video." });
    requestBody.video_url = sourceMedia.dataUrl;
  } else {
    if (sourceMedia.kind !== "image") return json(res, 400, { error: "This model needs a JPG, PNG, WebP, or GIF image." });
    if (settings.inputKind === "transition") {
      const endMedia = input.endMediaToken ? uploads.get(input.endMediaToken) : null;
      if (!endMedia) return json(res, 400, { error: "Choose an ending image for this transition." });
      if (endMedia.kind !== "image") return json(res, 400, { error: "The ending frame needs to be an image." });
      requestBody.image_url = sourceMedia.dataUrl;
      requestBody.end_image_url = endMedia.dataUrl;
    } else if (settings.inputKind === "reference") {
      const referenceTokens = Array.isArray(input.referenceMediaTokens) ? input.referenceMediaTokens.slice(0, 8) : [];
      const references = [sourceMedia, ...referenceTokens.map((token) => uploads.get(token))];
      if (references.some((media) => !media || media.kind !== "image")) return json(res, 410, { error: expiredMessage });
      if (settings.model.includes("kling") && settings.model.includes("reference-to-video")) {
        requestBody.elements = [{ frontal_image_url: sourceMedia.dataUrl }];
        requestBody.prompt = prompt.includes("@Element1") ? prompt : `@Element1, ${prompt}`;
      } else {
        requestBody.reference_image_urls = references.map((media) => media.dataUrl);
      }
    } else {
      requestBody.image_url = sourceMedia.dataUrl;
    }
  }
  const { response } = await venice("video/queue", requestBody, access.apiKey);
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
      encrypted_personal_key: access.encryptedPersonalKey,
      created_at: now,
      updated_at: now
    });
    for (const token of [input.mediaToken, input.endMediaToken, ...(Array.isArray(input.referenceMediaTokens) ? input.referenceMediaTokens : [])]) {
      if (typeof token === "string") uploads.delete(token);
    }
    void monitorJob(body.queue_id);
    return json(res, response.status, { queueId: body.queue_id, accessToken, createdAt: now });
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
      createdAt: job.created_at,
      updatedAt: job.updated_at,
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
    if (req.method === "GET" && url.pathname === "/api/access/status") return handleAccessStatus(req, res);
    if (req.method === "POST" && url.pathname === "/api/access/unlock") return await handleAccessUnlock(req, res);
    if (req.method === "POST" && url.pathname === "/api/access/logout") return handleAccessLogout(req, res);
    if (req.method === "GET" && url.pathname === "/api/video/models") {
      const access = inferenceAccess(req);
      const catalog = await getVideoCatalog(access.apiKey);
      return json(res, 200, { profiles: videoProfiles.map((profile) => profileResponse(profile, catalog)), advancedModels: simpleVideoModels(catalog), live: catalog.length > 0 });
    }
    if (req.method === "POST" && url.pathname === "/api/media") return await handleMedia(req, res);
    if (req.method === "POST" && url.pathname === "/api/video/quote") return await handleQuote(req, res);
    if (req.method === "POST" && url.pathname === "/api/video/queue") return await handleQueue(req, res);
    json(res, 404, { error: "Not found." });
  } catch (error) {
    json(res, Number.isInteger(error?.statusCode) ? error.statusCode : 500, { error: error instanceof Error ? error.message : "Unexpected server error." });
  }
});

server.listen(PORT, () => {
  for (const job of pendingJobs()) void monitorJob(job.queue_id);
  console.log(`Roam is ready at http://localhost:${PORT}`);
});
