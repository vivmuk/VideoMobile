import { createServer } from "node:http";
import { Readable } from "node:stream";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { extname, join } from "node:path";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";

const PORT = Number(process.env.PORT || 3000);
// Overridable so the studio can be pointed at a Venice-compatible stub in a test or a
// staging environment. Production leaves it unset.
const VENICE_BASE = (process.env.VENICE_BASE_URL || "https://api.venice.ai/api/v1").replace(/\/+$/, "");
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
const MAX_REFERENCE_IMAGES = 5;
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
  console.warn(`[${new Date().toISOString()}] job ${queueId} failed: ${errorMessage}`);
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
    "/about": ["public/about.html", "text/html; charset=utf-8"],
    "/styles.css": ["public/styles.css", "text/css; charset=utf-8"],
    "/app.js": ["public/app.js", "text/javascript; charset=utf-8"],
    "/about.js": ["public/about.js", "text/javascript; charset=utf-8"]
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
    name: text?.model_spec?.name || image?.model_spec?.name || profile.provider,
    provider: text?.model_spec?.name || image?.model_spec?.name || profile.provider,
    description: profile.description,
    privacy: profile.privacy,
    supportsText: catalog.length === 0 || Boolean(text),
    supportsPhoto: catalog.length === 0 || Boolean(image),
    textOptions: modelOptions(text),
    photoOptions: modelOptions(image)
  };
}

const modelSlug = (value) => String(value || "").toLowerCase();

// Five input kinds cover every video model Venice publishes. They decide the payload
// shape, so they stay exactly as the queue handler expects them.
function modelInputKind(model) {
  const id = modelSlug(model?.id);
  const type = model?.model_spec?.constraints?.model_type;
  if (type === "video" || id.includes("video-to-video") || id.includes("motion-control") || id.includes("upscale") || id.includes("aleph")) return "video";
  if (id.includes("first-last-frame") || id.includes("transition")) return "transition";
  if (id.includes("reference-to-video") || id.includes("reference-image")) return "reference";
  if (type === "image-to-video" || id.includes("image-to-video")) return "image";
  return "text";
}

// The picker offers four categories. Transitions start from stills, so they belong
// with the other image-led models rather than in a category of their own.
const MODEL_CATEGORIES = ["image", "text", "reference", "video"];
const categoryForKind = (kind) => (kind === "transition" ? "image" : kind);

// Ordered hints used only to seed the two or three RECOMMENDED entries at the top of
// each category. A family here is a suggestion, never a filter: every model the
// account can reach still appears underneath, newest first.
const recommendedFamilies = {
  text: ["seedance", "veo", "kling", "sora", "wan", "grok-imagine", "ltx"],
  image: ["seedance", "kling", "wan", "veo", "grok-imagine", "sora", "ltx"],
  reference: ["kling", "vidu", "wan", "seedance", "pixverse"],
  video: ["wan", "runway", "kling", "seedance", "ltx"]
};
const RECOMMENDED_PER_CATEGORY = 3;

// Task and qualifier words carry no generation information, so they are dropped
// before an id is split into a family and a version.
const TASK_WORDS = ["text-to-video", "image-to-video", "reference-to-video", "video-to-video", "first-last-frame", "reference-image", "motion-control", "transition", "upscale"];
const QUALIFIER_WORDS = ["private", "uncensored", "fast", "pro", "standard", "turbo", "plus", "lite", "mini", "max", "preview", "beta", "hd", "quality"];

// Venice writes a model's generation into its id — wan-2-7, seedance-2-0, kling-o3,
// ltx-2-v2-3 — so the newest variant of a family is answerable without a table that
// would go stale the moment Venice ships another model.
function modelIdentity(id) {
  let slug = modelSlug(id);
  for (const word of TASK_WORDS) slug = slug.split(word).join("-");
  const tokens = slug.split("-").filter((token) => token && !QUALIFIER_WORDS.includes(token));
  const firstVersion = tokens.findIndex((token) => /\d/.test(token));
  const nameTokens = firstVersion === -1 ? tokens : tokens.slice(0, firstVersion);
  const version = firstVersion === -1
    ? []
    : tokens.slice(firstVersion).flatMap((token) => (token.match(/\d+/g) || []).map(Number));
  return { family: nameTokens.join("-") || slug, version };
}

function compareVersions(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? -1) - (right[index] ?? -1);
    if (difference !== 0) return difference;
  }
  return 0;
}

// Newest first. Venice stamps each model with `created`, which is the only honest
// recency signal; the parsed version breaks ties inside a family, and the catalog's
// own order breaks anything still level so the list never reshuffles between loads.
function compareByRecency(a, b) {
  if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
  const version = compareVersions(b.version, a.version);
  if (version !== 0) return version;
  return a.order - b.order;
}

function modelCreatedAt(model) {
  const created = Number(model?.created ?? model?.model_spec?.created);
  return Number.isFinite(created) && created > 0 ? created : 0;
}

// Reference models do not share one prompt syntax. Kling addresses each subject
// through an elements[] entry and @ElementN in the prompt; everything else takes a
// flat reference_image_urls array. The console always shows the creator
// @image1…@imageN and this table decides what those become on the wire.
const referenceSchemes = [
  { test: (id) => id.includes("kling"), scheme: "elements", label: "Element", maxImages: 4 },
  { test: () => true, scheme: "reference-urls", label: "image", maxImages: MAX_REFERENCE_IMAGES }
];

function referenceSchemeFor(modelId) {
  const id = modelSlug(modelId);
  return referenceSchemes.find((entry) => entry.test(id));
}

// The console labels every reference upload @image1…@imageN, so that is the syntax a
// creator types. Loose spellings are accepted too, because people type what they see
// on the thumbnail rather than a documented token. The two-digit bound plus the word
// boundary keep an ordinary "@2026" in a prompt from reading as a reference.
const REFERENCE_TAG_PATTERN = /@\s*(?:images?|img|refs?|references?|elements?|subjects?)?\s*(\d{1,2})\b/gi;

function referenceTagsIn(prompt) {
  const indexes = [];
  for (const match of String(prompt).matchAll(REFERENCE_TAG_PATTERN)) {
    const index = Number(match[1]);
    if (index > 0 && !indexes.includes(index)) indexes.push(index);
  }
  return indexes;
}

// Rewrites the creator's @imageN into the token the selected reference model actually
// reads — @ElementN for Kling, @imageN everywhere else — so one console syntax works
// across every reference model Venice offers.
function bindReferenceTags(prompt, label, count) {
  const beyond = referenceTagsIn(prompt).find((index) => index > count);
  if (beyond) {
    throw inputError(`Your description mentions @image${beyond}, but only ${count} reference image${count === 1 ? " is" : "s are"} attached. Add it, or remove the tag.`);
  }
  const bound = prompt.replace(REFERENCE_TAG_PATTERN, (match, digits) => {
    const index = Number(digits);
    return index >= 1 && index <= count ? `@${label}${index}` : match;
  });
  // An untagged prompt would leave the extra references unused, so bind them all up
  // front and let the description that follows say what they do.
  if (referenceTagsIn(prompt).length) return bound;
  const tags = Array.from({ length: count }, (_, index) => `@${label}${index + 1}`).join(" ");
  return `${tags} ${bound}`.trim();
}

function imageSlotsFor(model, kind) {
  if (kind === "transition") return 2;
  if (kind === "image" || kind === "video") return 1;
  if (kind !== "reference") return 0;
  const constraints = model?.model_spec?.constraints || {};
  const declared = [constraints.max_reference_images, constraints.reference_images, constraints.max_images]
    .map(Number)
    .find((value) => Number.isInteger(value) && value > 0);
  return Math.min(declared || referenceSchemeFor(model?.id).maxImages, MAX_REFERENCE_IMAGES);
}

function advancedModelResponse(model, order) {
  const spec = model.model_spec || {};
  const kind = modelInputKind(model);
  const identity = modelIdentity(model.id);
  return {
    id: model.id,
    name: spec.name || model.id,
    provider: model.id,
    description: spec.description || "Use Venice's live quote to check this model's current options and price.",
    privacy: spec.privacy || "Check Venice settings",
    supportsText: kind === "text",
    supportsPhoto: kind === "image",
    inputKind: kind,
    category: categoryForKind(kind),
    family: identity.family,
    version: identity.version,
    createdAt: modelCreatedAt(model),
    order,
    options: modelOptions(model),
    bestFor: modelBestFor(model),
    imageSlots: imageSlotsFor(model, kind),
    referenceLabel: kind === "reference" ? referenceSchemeFor(model.id).label : null,
    recommended: false,
    recommendedRank: null,
    beta: spec.beta === true || spec.betaModel === true
  };
}

// Two or three shortlisted models per category: the newest variant of each preferred
// family, topped up with the newest models the category actually has so a category
// full of families nobody has heard of still gets a shortlist.
function pickRecommended(category, models) {
  const newestByFamily = new Map();
  for (const model of models) {
    const existing = newestByFamily.get(model.family);
    if (!existing || compareByRecency(model, existing) < 0) newestByFamily.set(model.family, model);
  }
  const chosen = [];
  for (const family of recommendedFamilies[category] || []) {
    if (chosen.length >= RECOMMENDED_PER_CATEGORY) break;
    const best = newestByFamily.get(family);
    if (best) chosen.push(best);
  }
  for (const pass of [true, false]) {
    for (const model of models) {
      if (chosen.length >= RECOMMENDED_PER_CATEGORY) break;
      if (chosen.includes(model)) continue;
      if (pass && chosen.some((entry) => entry.family === model.family)) continue;
      chosen.push(model);
    }
  }
  return chosen;
}

function simpleVideoModels(catalog) {
  const models = catalog.map((model, index) => advancedModelResponse(model, index));
  const ordered = [];
  for (const category of MODEL_CATEGORIES) {
    const inCategory = models.filter((model) => model.category === category).sort(compareByRecency);
    // The shortlist is chosen by family but presented newest first, so the very top of
    // the picker is both recommended and the most recent thing Venice has shipped.
    const shortlist = pickRecommended(category, inCategory).sort(compareByRecency);
    for (const [rank, model] of shortlist.entries()) {
      model.recommended = true;
      model.recommendedRank = rank;
    }
    // Recommended first in shortlist order, then everything else newest first.
    ordered.push(...inCategory.sort((a, b) => {
      if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
      if (a.recommended) return a.recommendedRank - b.recommendedRank;
      return compareByRecency(a, b);
    }));
  }
  return ordered;
}

function stringValues(values) {
  return Array.isArray(values) ? values.filter((value) => typeof value === "string" && value.length > 0) : [];
}

// Used only while Venice's catalog is unreachable. `known: false` tells the rest of
// the server that these numbers are assumptions rather than the model's own limits.
const unknownModelOptions = {
  known: false,
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

// A model's settings come from its own `model_spec.constraints` and nowhere else. A
// list Venice does not publish stays empty, and an empty list means the control is
// hidden and the parameter is never sent — a guessed "5s" is worse than letting the
// model choose.
function modelOptions(model) {
  if (!model) return unknownModelOptions;
  const constraints = model?.model_spec?.constraints || {};
  const durations = stringValues(constraints.durations);
  const aspectRatios = stringValues(constraints.aspect_ratios);
  const resolutions = stringValues(constraints.resolutions);
  const isUpscale = model.id.includes("upscale") || (resolutions.length > 0 && resolutions.every((value) => /^\d+x$/i.test(value)));
  return {
    known: true,
    durations: isUpscale && !durations.length ? ["Auto"] : durations,
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
  if (id.includes("first-last-frame") || id.includes("transition")) return "Creating a smooth transition between two images.";
  if (id.includes("reference-to-video") || id.includes("reference-image")) return "Keeping a character, product, or scene consistent from reference images.";
  if (id.includes("wan-2-7") || id.includes("uncensored")) return "Venice's uncensored creative direction; be explicit and detailed in the prompt.";
  if (id.includes("grok-imagine-1-5")) return "Private image-to-video animation with a strong starting frame.";
  if (id.includes("grok-imagine")) return "Private, mood-led storytelling and expressive atmosphere.";
  if (id.includes("seedance")) return "Cinematic shots, specific camera moves, lighting, and detailed direction.";
  if (id.includes("happyhorse")) return "Natural human movement, dance, fitness, and physical action.";
  if (id.includes("wan-2.6") || id.includes("wan-2-6")) return "Flexible image or text animation with audio-aware options.";
  if (id.includes("wan-2.5") || id.includes("wan-2-5")) return "Quick experiments with short, flexible clips.";
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

const PROMPT_MODEL_TTL_MS = 10 * 60 * 1000;
const promptModels = new Map();

// Venice accepts a trait name wherever a model id is accepted, so "default" stays
// valid even when the traits lookup itself fails.
async function getPromptModel(key) {
  const override = process.env.VENICE_PROMPT_MODEL;
  if (override) return override;
  const cacheKey = createHash("sha256").update(key).digest("base64url");
  const cached = promptModels.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.model;
  let model = "default";
  try {
    const response = await veniceGet("models/traits?type=text", key);
    if (response.ok) {
      const body = await response.json();
      const traits = body?.data && typeof body.data === "object" ? body.data : {};
      model = traits.default || traits.most_intelligent || traits.fastest || "default";
    }
  } catch {
    // The trait name is used directly when the catalog cannot be reached.
  }
  promptModels.set(cacheKey, { model, expiresAt: Date.now() + PROMPT_MODEL_TTL_MS });
  return model;
}

// Adapter guidance distilled from .claude/skills/video-movie-prompting. Each entry shapes the
// order and emphasis of the optimized prompt for one documented model family. The live model
// constraints resolved above always win over anything written here.
const promptAdapters = [
  {
    id: "happy-horse",
    name: "HappyHorse",
    test: (id, name) => /happy[-\s]?horse/.test(id) || /happy[-\s]?horse/.test(name),
    guidance: [
      "No provider-owned prompt guide exists for this model family, so no family-specific technique applies.",
      "Stay close to the creator's own wording, order and emphasis. Add only plainly observable detail — subject, action, setting, light, one camera intention — that the shot needs to be renderable, and drop nothing they wrote.",
      "Do not borrow another provider's prompt syntax, and do not imply modes, reference behaviour or audio behaviour beyond the settings above."
    ]
  },
  {
    id: "grok-imagine",
    name: "xAI Grok Imagine",
    test: (id, name) => id.includes("grok-imagine") || name.includes("grok imagine"),
    guidance: [
      "Open with the framing and the opening composition, then the physical action and the environment's response in chronological order.",
      "Give the camera a starting position, one move with a stated pace, and where it ends.",
      "Close on the shot's end state — the last thing the frame holds.",
      "When an opening frame is supplied it owns identity and composition, so spend every clause on motion, camera, changing light and the end state."
    ]
  },
  {
    id: "seedance",
    name: "ByteDance Seedance",
    test: (id, name) => id.includes("seedance") || name.includes("seedance"),
    guidance: [
      "Write the physical events in strict order, including speed changes and the consequence each action has on the scene.",
      "State the opening framing, then the one camera move that reveals the next event.",
      "Keep lighting and style to one concise clause of concrete visual direction.",
      "Treat sound as designed rather than decorative: ambience, specific foley, or deliberate quiet.",
      "This is still one continuous beat. Never write a multishot sequence unless the creator asked for one."
    ]
  },
  {
    id: "kling",
    name: "Kuaishou Kling",
    test: (id, name) => id.includes("kling") || name.includes("kling"),
    guidance: [
      "Lead with plain semantic intent: the named subject, one clear action, one specific setting.",
      "Use one readable camera move, then a short lighting and style clause, then only essential sound.",
      "Never write provider placeholders such as <<<image_1>>>, <<<video_1>>> or <<<element_1>>>. The interface binds every reference asset, and any @image tag already in the draft is part of that binding."
    ]
  },
  {
    id: "wan",
    name: "Alibaba Wan",
    test: (id, name) => /(^|[^a-z])wan([^a-z]|$)/.test(id) || /(^|[^a-z])wan([^a-z]|$)/.test(name),
    guidance: [
      "Follow this order: subject and opening composition, then motion and the environment's response, then camera framing with one movement, then light, palette, texture and style, then the end state.",
      "This family follows explicit concrete direction, so keep every clause physically checkable rather than evocative.",
      "For a first-frame-to-last-frame clip, describe the visible journey between the supplied frames and name the anchors that must not change across it."
    ]
  },
  {
    id: "google-omni",
    name: "Google Gemini Omni",
    test: (id, name) => id.includes("gemini-omni") || name.includes("gemini omni"),
    guidance: [
      "Move strictly in time: the opening framing and camera move, the single action, the clear end state, then materials, light and mood.",
      "Keep any sound direction to one precise clause — the ambience plus one specific effect.",
      "Any spoken line must belong to a named speaker and be short enough to land inside the clip."
    ]
  }
];

const genericAdapter = {
  id: "generic",
  name: "No provider guide loaded",
  guidance: [
    "No provider-specific prompt guide is loaded for this model, so apply the general craft rules only.",
    "Do not borrow another provider's prompt syntax and do not imply capabilities beyond the settings above."
  ]
};

// The console falls back to profile ids such as "profile:seedance" when the live catalog is
// unreachable, so resolve those to the real Venice model id before matching a family.
function resolveModelId(modelId) {
  const raw = String(modelId || "").trim();
  if (!raw.startsWith("profile:")) return raw.toLowerCase();
  const profile = videoProfiles.find((entry) => entry.id === raw.slice("profile:".length));
  return String(profile ? Object.values(profile.models)[0] || "" : "").toLowerCase();
}

function promptAdapterFor(modelId, modelName) {
  const id = resolveModelId(modelId);
  const name = String(modelName || "").toLowerCase();
  if (!id && !name) return genericAdapter;
  return promptAdapters.find((adapter) => adapter.test(id, name)) || genericAdapter;
}

const promptCraftSystem = [
  "You rewrite rough ideas into production-ready prompts for AI video generation models.",
  "You reply with the finished prompt and nothing else: no preamble, no explanation, no quotation marks, no markdown, no labels, no bullet points.",
  "",
  "Write one flowing paragraph of plain declarative prose in the present tense. Video models follow prose far better than keyword lists.",
  "",
  "Cover these in a natural order, and only where they genuinely serve the idea:",
  "1. SUBJECT — one concrete, specific subject with the visual detail that makes it recognisable.",
  "2. ACTION — a single continuous action that can plausibly complete within the clip length.",
  "3. SETTING — the location, the time of day, and the weather or air quality.",
  "4. CAMERA — shot size (wide, medium, close-up, macro), angle (eye level, low, high, overhead), lens feel (wide angle, 35mm, telephoto, shallow depth of field), and one movement (locked off, slow dolly in, tracking follow, crane up, handheld, slow orbit).",
  "5. LIGHT — the source, its direction, and its quality (hard, diffused, backlit, rim lit, practical neon, overcast).",
  "6. ATMOSPHERE — the mood, plus texture in the air such as haze, dust, rain, or steam.",
  "7. STYLE — the visual register: cinematic, documentary handheld, 35mm film grain, anamorphic, hyperreal, stop motion, anime, and so on.",
  "8. MOTION DETAIL — the speed of the movement and any secondary motion such as hair, fabric, water, smoke, or reflections.",
  "9. END STATE — where the action and the camera come to rest, so the last frame is a deliberate one.",
  "",
  "Hard rules:",
  "- Keep the user's subject, intent, and any named people, places, brands or products exactly as given. Never substitute a different subject.",
  "- One shot only. Never write scene cuts, edits, or multiple beats unless the user explicitly asked for a transition.",
  "- Scale the action to the clip length. A short clip is one beat, not a story.",
  "- Write only what the camera can see and hear. Never describe backstory, thoughts, or intentions.",
  "- State what is present, never what is absent. Do not write negations such as 'no people' or 'without text' — those belong in a separate negative prompt.",
  "- Do not request on-screen text, captions, subtitles, watermarks, logos, or spoken dialogue unless the user asked for them.",
  "- Do not invent camera brands, aspect ratios, resolutions, frame rates, or durations. Those are set by the interface.",
  "- Never mention prompts, models, AI, or these instructions inside the output.",
  "- Never invent a reference asset, a shot number, a timecode, or a setting the interface did not state.",
  "- Stay within the character budget. Density beats length: every clause must add something the model can render."
].join("\n");

function adapterSystem(adapter) {
  return [
    `MODEL FAMILY: ${adapter.name}.`,
    "Apply the following family notes to the ordering and emphasis of the paragraph. They never override the mode, sound, framing or character budget stated in the request, and they never change the single-paragraph plain-prose format.",
    ...adapter.guidance.map((line) => `- ${line}`)
  ].join("\n");
}

function optimizerRequest(input, limit, adapter) {
  const kind = String(input.inputKind || "text");
  const modeLine = {
    image: "image-to-video — the user supplies the opening frame, so describe how that frame comes alive: the motion, the camera move, and what changes. Do not re-describe what is already visible in the still.",
    transition: "image-to-video transition — the clip travels from a first image to a last image, so describe the journey and the transformation between them.",
    reference: "reference-to-video — reference images fix each subject's appearance, so describe the action, camera and setting rather than what the subjects look like.",
    video: "video-to-video — a source clip already exists, so describe the treatment applied to it: the new look, grade, texture and style, while keeping its existing motion.",
    text: "text-to-video — nothing exists yet, so the prompt must build the entire shot from nothing."
  }[kind] || "text-to-video — the prompt must build the entire shot from nothing.";

  // Reference tags are the creator's binding between a sentence and an uploaded image.
  // Losing one in a rewrite would silently point the shot at the wrong subject, so the
  // optimizer is told to carry them through untouched.
  const tags = Array.isArray(input.referenceTags) ? input.referenceTags.filter((tag) => /^@image\d{1,2}$/.test(tag)) : [];
  const tagLine = tags.length
    ? `REFERENCE TAGS: the draft contains ${tags.join(", ")}. Reproduce every one of them exactly as written, attached to the same subject and action as in the draft. Never renumber them, never remove one, and never add a tag that is not in this list.`
    : null;

  const context = [
    `MODE: ${modeLine}`,
    tagLine,
    input.modelName ? `TARGET MODEL: ${input.modelName}` : null,
    `MODEL FAMILY: ${adapter.name}`,
    input.duration ? `CLIP LENGTH: ${input.duration}` : null,
    input.aspectRatio ? `FRAMING: ${input.aspectRatio}` : null,
    input.audio === true
      ? "SOUND: this model generates its own audio, so you may add one short sentence of sound direction at the end."
      : "SOUND: this model is silent, so do not describe sound.",
    `CHARACTER BUDGET: ${limit}`
  ].filter(Boolean).join("\n");

  return [
    { role: "system", content: `${promptCraftSystem}\n\n${adapterSystem(adapter)}` },
    { role: "user", content: `${context}\n\nRewrite the draft below into one finished video prompt. Reply with the prompt only.\n\nDRAFT:\n${String(input.prompt || "").trim()}` }
  ];
}

function cleanOptimizedPrompt(raw, limit) {
  let text = String(raw || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```[a-z]*\n?/gi, "")
    .trim();
  text = text.replace(/^(?:here(?:'s| is)[^:\n]*:|optimi[sz]ed prompt:|prompt:|final prompt:)\s*/i, "").trim();
  if (text.length > 1 && /^["'“”']/.test(text) && /["'“”']$/.test(text)) text = text.slice(1, -1).trim();
  text = text.replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim();
  if (text.length > limit) {
    const clipped = text.slice(0, limit);
    const sentenceEnd = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("! "), clipped.lastIndexOf("? "));
    const lastSpace = clipped.lastIndexOf(" ");
    text = sentenceEnd > limit * 0.6
      ? clipped.slice(0, sentenceEnd + 1)
      : (lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped).trim();
  }
  return text;
}

async function handlePromptEnhance(req, res) {
  const input = await readJson(req);
  const access = inferenceAccess(req);
  const draft = String(input.prompt || "").trim();
  if (draft.length < 3) return json(res, 400, { error: "Write a few words first, then optimize them." });
  if (draft.length > 5_000) return json(res, 400, { error: "That description is too long to optimize." });
  const requested = Number(input.promptCharacterLimit);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.round(requested), 300), 5_000) : 2_000;
  const model = await getPromptModel(access.apiKey);
  const adapter = promptAdapterFor(input.modelId, input.modelName);
  const { response } = await venice("chat/completions", {
    model,
    messages: optimizerRequest(input, limit, adapter),
    // The evidence-gated family is rewritten conservatively, close to the creator's own wording.
    temperature: adapter.id === "happy-horse" ? 0.4 : 0.7,
    max_completion_tokens: Math.min(1_400, Math.max(400, Math.round(limit / 2))),
    venice_parameters: { include_venice_system_prompt: false, disable_thinking: true, strip_thinking_response: true }
  }, access.apiKey);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    logFailure("prompt/enhance", `${model} -> ${response.status} ${body.error || "no message"}`);
    return json(res, response.status, { error: body.error || "Could not optimize that description right now." });
  }
  const optimized = cleanOptimizedPrompt(body?.choices?.[0]?.message?.content, limit);
  if (!optimized) return json(res, 502, { error: "The optimizer did not return a usable description. Try again." });
  json(res, 200, { prompt: optimized, adapter: adapter.id });
}

function logFailure(scope, detail) {
  console.warn(`[${new Date().toISOString()}] ${scope}: ${detail}`);
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
  // Every parameter below is gated on the selected model publishing it. A model that
  // does not declare durations, a frame shape or a resolution keeps that choice for
  // itself, and this request stays silent about it rather than sending a guess.
  if (options.durations.length && (typeof input.duration !== "string" || !options.durations.includes(input.duration))) {
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
  const settings = { model: selected?.id || profile.models[hasImage ? "image" : "text"] };
  if (options.durations.length) settings.duration = input.duration;
  if (options.aspectRatioConfigurable) settings.aspect_ratio = input.aspectRatio;
  if (options.resolutionConfigurable) settings.resolution = input.resolution;
  if (options.upscaleFactors.length) settings.upscale_factor = Number(input.upscaleFactor);
  if (options.audioConfigurable) settings.audio = Boolean(input.audio);
  const inputKind = selected ? modelInputKind(selected) : hasImage ? "image" : "text";
  Object.defineProperty(settings, "inputKind", { value: inputKind, enumerable: false });
  Object.defineProperty(settings, "displayName", { value: displayName, enumerable: false });
  Object.defineProperty(settings, "imageSlots", { value: imageSlotsFor(selected, inputKind), enumerable: false });
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
  console.log(`[${new Date().toISOString()}] job ${job.queue_id} completed (${video.length} bytes)`);
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
  if (!response.ok) logFailure("quote", `${settings.model} -> ${response.status} ${body.error || "no message"}`);
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
  const negativePrompt = String(input.negativePrompt || "").trim();
  if (negativePrompt.length > settings.promptCharacterLimit) return json(res, 400, { error: `Keep the negative prompt under ${settings.promptCharacterLimit.toLocaleString()} characters.` });
  if (negativePrompt) requestBody.negative_prompt = negativePrompt;
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
      const referenceTokens = Array.isArray(input.referenceMediaTokens) ? input.referenceMediaTokens.slice(0, settings.imageSlots - 1) : [];
      const references = [sourceMedia, ...referenceTokens.map((token) => uploads.get(token))];
      if (references.some((media) => !media || media.kind !== "image")) return json(res, 410, { error: expiredMessage });
      const scheme = referenceSchemeFor(settings.model);
      requestBody.prompt = bindReferenceTags(prompt, scheme.label, references.length);
      if (requestBody.prompt.length > settings.promptCharacterLimit) {
        return json(res, 400, { error: `Tagging the reference images pushes this description past ${settings.displayName}'s ${settings.promptCharacterLimit.toLocaleString()} character limit. Shorten it a little.` });
      }
      if (scheme.scheme === "elements") {
        // Kling addresses each subject separately, so every upload becomes its own
        // element and @image2 in the console arrives as @Element2 on the wire.
        requestBody.elements = references.map((media) => ({ frontal_image_url: media.dataUrl }));
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
    console.log(`[${new Date().toISOString()}] queued ${body.queue_id} on ${body.model || settings.model}`);
    return json(res, response.status, { queueId: body.queue_id, accessToken, createdAt: now });
  }
  logFailure("queue", `${settings.model} -> ${response.status} ${body.error || "no message"}`);
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

// Safari refuses to play a video that is not served with byte-range support, and
// Android media players seek by range too, so the finished MP4 is streamed rather
// than returned as one buffered response.
function parseRange(header, total) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match) return null;
  const hasStart = match[1] !== "";
  const hasEnd = match[2] !== "";
  if (!hasStart && !hasEnd) return null;
  let start = hasStart ? Number(match[1]) : total - Number(match[2]);
  let end = hasStart ? (hasEnd ? Number(match[2]) : total - 1) : total - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  start = Math.max(0, start);
  end = Math.min(total - 1, end);
  if (start > end) return { unsatisfiable: true };
  return { start, end };
}

async function sendVideoFile(req, res, job) {
  const path = join(VIDEO_DIR, job.video_path);
  let size;
  try {
    size = (await stat(path)).size;
  } catch {
    return json(res, 410, { error: "The saved video is no longer available." });
  }
  const headers = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=31536000"
  };
  const range = req.headers.range ? parseRange(req.headers.range, size) : null;
  if (range?.unsatisfiable) {
    res.writeHead(416, { ...headers, "Content-Range": `bytes */${size}` });
    return res.end();
  }
  const start = range ? range.start : 0;
  const end = range ? range.end : size - 1;
  res.writeHead(range ? 206 : 200, {
    ...headers,
    "Content-Length": end - start + 1,
    ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {})
  });
  if (req.method === "HEAD") return res.end();
  const stream = createReadStream(path, { start, end });
  stream.on("error", () => res.destroy());
  res.on("close", () => stream.destroy());
  stream.pipe(res);
}

async function handleJobGet(req, url, res) {
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
  await sendVideoFile(req, res, job);
  return true;
}

setInterval(() => {
  const cutoff = Date.now() - MEDIA_TTL_MS;
  for (const [token, media] of uploads) if (media.createdAt < cutoff) uploads.delete(token);
}, 60_000).unref();

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  try {
    if ((req.method === "GET" || req.method === "HEAD") && await handleJobGet(req, url, res)) return;
    if (req.method === "GET" && sendStatic(res, url.pathname)) return;
    if (req.method === "GET" && url.pathname === "/api/access/status") return handleAccessStatus(req, res);
    if (req.method === "POST" && url.pathname === "/api/access/unlock") return await handleAccessUnlock(req, res);
    if (req.method === "POST" && url.pathname === "/api/access/logout") return handleAccessLogout(req, res);
    if (req.method === "GET" && url.pathname === "/api/video/models") {
      const access = inferenceAccess(req);
      const catalog = await getVideoCatalog(access.apiKey);
      return json(res, 200, { profiles: videoProfiles.map((profile) => profileResponse(profile, catalog)), advancedModels: simpleVideoModels(catalog), live: catalog.length > 0 });
    }
    if (req.method === "POST" && url.pathname === "/api/prompt/enhance") return await handlePromptEnhance(req, res);
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
  console.log(`vivvideo is ready at http://localhost:${PORT}`);
});
