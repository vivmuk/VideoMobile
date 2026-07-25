const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const el = {
  modeTabs: $$(".mode-tab"),
  prompt: $("#prompt"),
  promptCount: $("#prompt-count"),
  pastePrompt: $("#paste-prompt"),
  chipRow: $(".chip-row"),
  optimizeButton: $("#optimize-button"),
  optimizeLabel: $("#optimize-label"),

  sourcePanel: $("#source-panel"),
  sourceTitle: $("#source-title"),
  sourceTag: $("#source-tag"),
  dropzone: $("#dropzone"),
  dropEmpty: $("#drop-empty"),
  uploadTitle: $("#upload-title"),
  uploadDescription: $("#upload-description"),
  chooseFileLabel: $("#choose-file-label"),
  cameraLabel: $("#camera-label"),
  pasteMedia: $("#paste-media"),
  photoInput: $("#photo-file"),
  cameraInput: $("#camera-file"),
  mediaPreview: $("#media-preview"),
  previewImage: $("#preview-image"),
  previewVideo: $("#preview-video"),
  mediaName: $("#media-name"),
  mediaDetail: $("#media-detail"),
  removeMedia: $("#remove-media"),
  mediaError: $("#media-error"),
  extraFrames: $("#extra-frames"),
  extraLabel: $("#extra-label"),
  extraCount: $("#extra-count"),
  extraFile: $("#extra-file"),
  extraStatus: $("#extra-status"),
  frameTray: $("#frame-tray"),
  framingNote: $("#framing-note"),

  modelSelect: $("#model-select"),
  ratioControl: $("#ratio-control"),
  ratioSelect: $("#ratio-select"),
  durationControl: $("#duration-control"),
  durationSelect: $("#duration-select"),
  resolutionControl: $("#resolution-control"),
  resolutionSelect: $("#resolution-select"),
  upscaleControl: $("#upscale-control"),
  upscaleSelect: $("#upscale-select"),
  modelHint: $("#model-hint"),

  audio: $("#audio"),
  audioRow: $("#audio-row"),
  audioNote: $("#audio-note"),
  negativePrompt: $("#negative-prompt"),
  modelSpec: $("#model-spec"),

  previewFrame: $("#preview-frame"),
  previewPanel: $(".preview-panel"),
  previewEmpty: $("#preview-empty"),
  previewSub: $("#preview-sub"),
  previewLoading: $("#preview-loading"),
  loadingPhase: $("#loading-phase"),
  loadingDetail: $("#loading-detail"),
  loadingElapsed: $("#loading-elapsed"),
  progressFill: $("#progress-fill"),
  previewError: $("#preview-error"),
  errorMessage: $("#error-message"),
  retryButton: $("#retry-button"),
  resultVideo: $("#result-video"),
  previewActions: $("#preview-actions"),
  downloadVideo: $("#download-video"),
  makeAnother: $("#make-another"),
  playbackNote: $("#playback-note"),
  playbackNoteText: $("#playback-note-text"),
  playbackOpen: $("#playback-open"),

  generateButton: $("#generate-button"),
  generateLabel: $("#generate-label"),
  statusLine: $("#status-line"),

  scrim: $("#scrim"),
  historyButton: $("#history-button"),
  historyDrawer: $("#history-drawer"),
  closeHistory: $("#close-history"),
  historyList: $("#history-list"),
  historyEmpty: $("#history-empty"),
  settingsButton: $("#settings-button"),
  settingsDrawer: $("#settings-drawer"),
  closeSettings: $("#close-settings"),
  accessState: $("#access-state"),
  accessError: $("#access-error"),
  apiKey: $("#venice-api-key"),
  useApiKey: $("#use-api-key"),
  sharedPassword: $("#shared-password"),
  unlockShared: $("#unlock-shared"),
  clearAccess: $("#clear-access"),
  clearStorage: $("#clear-storage"),
  storageSummary: $("#storage-summary"),
  toast: $("#toast")
};

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const FALLBACK_IMAGE_SLOTS = { transition: 2, reference: 5, image: 1, video: 1, text: 0 };
const DRAFT_KEY = "roam-video-draft";
const ACTIVE_JOB_KEY = "roam-active-video-job";
const LATEST_VIDEO_KEY = "roam-latest-video";
const HISTORY_KEY = "roam-video-history";
const PERSONAL_KEY_SESSION = "roam-personal-venice-key";
const HISTORY_LIMIT = 20;
// A visit after a long gap should start clean rather than resurrecting old work.
const DRAFT_TTL_MS = 6 * 60 * 60 * 1000;
const RESULT_TTL_MS = 2 * 60 * 60 * 1000;
const JOB_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_STATUS_FAILURES = 5;

const MODE_KINDS = { image: ["image", "transition", "reference"], text: ["text"], video: ["video"] };
const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif";
const VIDEO_ACCEPT = "video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm";

const DEFAULT_OPTIONS = {
  durations: ["5s", "10s"],
  aspectRatios: ["9:16", "16:9", "1:1"],
  resolutions: ["720p"],
  aspectRatioConfigurable: true,
  resolutionConfigurable: true,
  audioAvailable: true,
  audioConfigurable: true,
  promptCharacterLimit: 2500,
  upscaleFactors: []
};

// Used only before the live Venice catalog loads. These are server-side profile ids,
// not model identifiers, so the server still resolves the real model from its catalog.
const fallbackProfiles = [
  { profileId: "fast", name: "Fast draft - LTX 2.3 Fast", bestFor: "Quick tests and simple scenes.", privacy: "Anonymized", text: true, image: true },
  { profileId: "movement", name: "Natural movement - HappyHorse 1.1", bestFor: "People, animals, and lively movement.", privacy: "Anonymized", text: true, image: true },
  { profileId: "seedance", name: "Cinematic - Seedance 2.0", bestFor: "Detailed shots, lighting, and camera direction.", privacy: "Anonymized", text: true, image: true },
  { profileId: "grok-private", name: "Mood - Grok Imagine Private", bestFor: "Private, expressive storytelling.", privacy: "Private", text: true, image: true },
  { profileId: "kling", name: "Polished - Kling O3 Standard", bestFor: "Balanced quality and refined camera work.", privacy: "Anonymized", text: true, image: true },
  { profileId: "wan-unrestricted", name: "Uncensored - Wan 2.7", bestFor: "Explicit, detailed creative direction.", privacy: "Anonymized · Uncensored", text: true, image: true }
];

const state = {
  mode: "image",
  catalog: [],
  live: false,
  modelByMode: { image: null, text: null, video: null },
  ratio: "9:16",
  duration: "5s",
  resolution: "720p",
  upscaleFactor: "2",
  audio: true,
  audioPreference: true,
  personalApiKey: "",
  sharedAccess: false,
  file: null,
  mediaKind: null,
  mediaToken: null,
  previewUrl: null,
  endMediaToken: null,
  referenceMediaTokens: [],
  extraFiles: [],
  extraPreviews: [],
  sourceAspect: null,
  ratioTouched: false,
  previewRatioLocked: false,
  quote: null,
  quoteSignature: null,
  phase: "idle",
  job: null,
  jobStatus: null,
  polling: false,
  delivering: false,
  uploading: false,
  resultUrl: null,
  playbackSources: [],
  pollTimer: null,
  clockTimer: null,
  startedAt: null,
  finishedIn: null,
  errorText: "",
  statusFailureCount: 0,
  openDrawer: null,
  promptBeforeOptimize: null,
  optimizing: false,
  purgeArmed: false
};

/* ------------------------------------------------------------------ helpers */

const safeStorage = (action) => { try { return action(); } catch { return null; } };
const setText = (node, value) => { node.textContent = value || ""; };
const currency = (value) => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(value);

let toastTimer;
function showToast(message) {
  clearTimeout(toastTimer);
  el.toast.hidden = false;
  el.toast.textContent = message;
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 4200);
}

function formatElapsed(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function setPreviewFrame(width, height) {
  const valid = width > 0 && height > 0;
  el.previewFrame.style.setProperty("--preview-ratio", valid ? `${width} / ${height}` : "9 / 16");
  el.previewFrame.style.setProperty("--preview-ar", String(valid ? width / height : 0.5625));
}

function applyPreviewRatio(ratio) {
  // A loaded video's own dimensions win: the model does not always return the
  // shape that was requested, and the frame must not crop whatever arrives.
  if (state.previewRatioLocked) return;
  const [width, height] = String(ratio || "9:16").split(":").map(Number);
  setPreviewFrame(width, height);
}

function onVideoMetadata() {
  const { videoWidth, videoHeight } = el.resultVideo;
  if (!videoWidth || !videoHeight) return;
  state.previewRatioLocked = true;
  setPreviewFrame(videoWidth, videoHeight);
}

function unlockPreviewRatio() {
  state.previewRatioLocked = false;
  applyPreviewRatio(currentOptions().aspectRatios?.length ? state.ratio : "16:9");
}

const parseRatio = (value) => {
  const [width, height] = String(value || "").split(":").map(Number);
  return width > 0 && height > 0 ? width / height : null;
};

function closestRatio(aspect, ratios) {
  let best = null;
  let bestGap = Infinity;
  for (const candidate of ratios) {
    const value = parseRatio(candidate);
    if (!value) continue;
    const gap = Math.abs(Math.log(value / aspect));
    if (gap < bestGap) { bestGap = gap; best = candidate; }
  }
  return best;
}

// Warn before generating when the requested frame cannot hold the whole photo,
// because that is the crop the model will perform.
function renderFramingNote() {
  const options = currentOptions();
  const ratios = options.aspectRatios || [];
  const kind = currentInputKind();
  if (!state.sourceAspect || kind === "text" || kind === "video") {
    el.framingNote.hidden = true;
    return;
  }
  if (!ratios.length) {
    el.framingNote.hidden = false;
    setText(el.framingNote, "This model picks its own frame shape, so it may crop your photo. Choose a model with a SHAPE control to keep all of it.");
    return;
  }
  const target = parseRatio(state.ratio);
  if (!target) { el.framingNote.hidden = true; return; }
  const gap = Math.abs(Math.log(target / state.sourceAspect));
  const better = closestRatio(state.sourceAspect, ratios);
  if (better && better !== state.ratio) {
    const orientation = state.sourceAspect < target ? "taller" : "wider";
    el.framingNote.hidden = false;
    setText(el.framingNote, `Your photo is ${orientation} than the ${state.ratio} frame, so the model will crop it. ${better} keeps more of it.`);
    return;
  }
  // Already on the closest frame this model offers, so only mention a trim
  // that will actually be visible.
  if (gap >= 0.15) {
    el.framingNote.hidden = false;
    setText(el.framingNote, `${state.ratio} is the closest frame this model offers, so the edges of your photo will be trimmed a little.`);
    return;
  }
  el.framingNote.hidden = true;
}

/* ------------------------------------------------------------------- access */

const accessHeaders = () => (state.personalApiKey ? { "X-Venice-API-Key": state.personalApiKey } : {});
const hasAccess = () => Boolean(state.personalApiKey || state.sharedAccess);

function renderAccess() {
  const usingKey = Boolean(state.personalApiKey);
  setText(el.accessState, usingKey ? "CONNECTED · YOUR VENICE KEY" : state.sharedAccess ? "CONNECTED · SHARED STUDIO" : "NOT CONNECTED");
  el.accessState.style.color = hasAccess() ? "var(--accent)" : "var(--warning)";
  el.clearAccess.hidden = !hasAccess();
  el.settingsButton.classList.toggle("is-alert", !hasAccess());
  renderOptimizer();
}

async function usePersonalApiKey() {
  const key = el.apiKey.value.trim();
  if (!key) { setText(el.accessError, "Paste your Venice API key first."); el.apiKey.focus(); return; }
  state.personalApiKey = key;
  safeStorage(() => sessionStorage.setItem(PERSONAL_KEY_SESSION, key));
  el.apiKey.value = "";
  setText(el.accessError, "");
  renderAccess();
  await loadCatalog();
  closeDrawer();
  renderDock();
}

async function unlockSharedStudio() {
  const password = el.sharedPassword.value;
  if (!password) { setText(el.accessError, "Enter the shared studio password first."); el.sharedPassword.focus(); return; }
  el.unlockShared.disabled = true;
  try {
    const response = await fetch("/api/access/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not unlock the shared studio.");
    state.sharedAccess = true;
    el.sharedPassword.value = "";
    setText(el.accessError, "");
    renderAccess();
    await loadCatalog();
    closeDrawer();
    renderDock();
  } catch (error) {
    setText(el.accessError, error instanceof Error ? error.message : "Could not unlock the shared studio.");
  } finally {
    el.unlockShared.disabled = false;
  }
}

async function clearAccess() {
  state.personalApiKey = "";
  state.sharedAccess = false;
  safeStorage(() => sessionStorage.removeItem(PERSONAL_KEY_SESSION));
  await fetch("/api/access/logout", { method: "POST" }).catch(() => undefined);
  state.catalog = [];
  state.live = false;
  setText(el.accessError, "");
  renderAccess();
  renderModels();
  invalidateQuote();
}

async function restoreAccess() {
  state.personalApiKey = safeStorage(() => sessionStorage.getItem(PERSONAL_KEY_SESSION)) || "";
  try {
    const response = await fetch("/api/access/status", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    state.sharedAccess = response.ok && data.sharedAccess === true;
  } catch {
    state.sharedAccess = false;
  }
  renderAccess();
}

function requireAccess() {
  if (hasAccess()) return true;
  openDrawer(el.settingsDrawer);
  setText(el.accessError, "Connect a Venice API key or unlock the shared studio to continue.");
  return false;
}

/* ------------------------------------------------------------------ catalog */

async function loadCatalog() {
  if (!hasAccess()) return;
  try {
    const response = await fetch("/api/video/models", { cache: "no-store", headers: accessHeaders() });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(data.advancedModels)) return;
    state.catalog = data.advancedModels;
    state.live = data.live === true && data.advancedModels.length > 0;
    renderModels();
  } catch {
    // The console keeps working with the local fallback list until the server answers.
  }
}

function modelsForMode(mode) {
  const kinds = MODE_KINDS[mode] || MODE_KINDS.image;
  if (state.live) {
    return state.catalog
      .filter((model) => kinds.includes(model.inputKind))
      .map((model) => ({
        id: model.id,
        name: model.name || model.id,
        bestFor: model.bestFor || model.description || "",
        privacy: model.privacy || "",
        inputKind: model.inputKind,
        beta: model.beta === true,
        imageSlots: model.imageSlots,
        recommended: model.recommended === true,
        options: { ...DEFAULT_OPTIONS, ...(model.options || {}) }
      }))
      .sort((a, b) => Number(b.recommended) - Number(a.recommended));
  }
  if (mode === "video") return [];
  return fallbackProfiles
    .filter((profile) => profile[mode === "image" ? "image" : "text"])
    .map((profile) => ({
      id: `profile:${profile.profileId}`,
      profileId: profile.profileId,
      name: profile.name,
      bestFor: profile.bestFor,
      privacy: profile.privacy,
      inputKind: mode === "image" ? "image" : "text",
      beta: false,
      recommended: true,
      options: { ...DEFAULT_OPTIONS }
    }));
}

function currentModel() {
  const models = modelsForMode(state.mode);
  if (!models.length) return null;
  return models.find((model) => model.id === state.modelByMode[state.mode]) || models[0];
}

const currentOptions = () => currentModel()?.options || DEFAULT_OPTIONS;
const imageSlots = () => {
  const model = currentModel();
  const kind = currentInputKind();
  return Number.isInteger(model?.imageSlots) ? model.imageSlots : FALLBACK_IMAGE_SLOTS[kind] ?? 1;
};
const currentInputKind = () => currentModel()?.inputKind || (state.mode === "text" ? "text" : state.mode);

function renderModels() {
  const models = modelsForMode(state.mode);
  const selectedId = currentModel()?.id || "";
  state.modelByMode[state.mode] = selectedId || null;
  el.modelSelect.replaceChildren();

  if (!models.length) {
    const option = document.createElement("option");
    option.textContent = hasAccess() ? "No models available" : "Connect to load models";
    el.modelSelect.append(option);
    el.modelSelect.disabled = true;
  } else {
    el.modelSelect.disabled = false;
    const groups = [
      ["RECOMMENDED", models.filter((model) => model.recommended)],
      [state.live ? "ALL VENICE MODELS" : "MORE", models.filter((model) => !model.recommended)]
    ];
    for (const [label, entries] of groups) {
      if (!entries.length) continue;
      const group = document.createElement("optgroup");
      group.label = label;
      for (const model of entries) {
        const option = document.createElement("option");
        option.value = model.id;
        const slots = Number.isInteger(model.imageSlots) ? model.imageSlots : FALLBACK_IMAGE_SLOTS[model.inputKind] ?? 1;
        option.textContent = `${model.name}${model.beta ? " · beta" : ""}${slots > 1 ? ` · ${slots} images` : ""}`;
        group.append(option);
      }
      el.modelSelect.append(group);
    }
    el.modelSelect.value = selectedId;
  }
  syncOptions();
}

function fillSelect(select, values, selected, label) {
  select.replaceChildren();
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label(value);
    select.append(option);
  }
  select.value = selected;
}

function syncOptions() {
  const model = currentModel();
  const options = currentOptions();
  const durations = options.durations?.length ? options.durations : DEFAULT_OPTIONS.durations;
  const ratios = options.aspectRatios || [];
  const resolutions = options.resolutions || [];
  const upscales = options.upscaleFactors || [];

  if (!durations.includes(state.duration)) state.duration = durations[0];
  if (ratios.length && !ratios.includes(state.ratio)) state.ratio = ratios[0];
  if (resolutions.length && !resolutions.includes(state.resolution)) state.resolution = resolutions[0];
  if (upscales.length && !upscales.includes(state.upscaleFactor)) state.upscaleFactor = upscales[0];

  // A model that cannot be configured must not overwrite the creator's choice,
  // otherwise sound stays off for every model chosen afterwards.
  const audioConfigurable = options.audioConfigurable === true;
  state.audio = audioConfigurable ? state.audioPreference : options.audioAvailable === true;

  fillSelect(el.durationSelect, durations, state.duration, (value) => (value === "Auto" ? "Auto" : value.replace("s", " sec")));
  const ratioChoosable = options.aspectRatioConfigurable && ratios.length > 0;
  if (ratioChoosable) {
    fillSelect(el.ratioSelect, ratios, state.ratio, (value) => `${value}${value === "9:16" ? " tall" : value === "16:9" ? " wide" : value === "1:1" ? " square" : ""}`);
  } else {
    fillSelect(el.ratioSelect, ["model"], "model", () => "Model decides");
  }
  el.ratioSelect.disabled = !ratioChoosable;
  fillSelect(el.resolutionSelect, resolutions, state.resolution, (value) => value);
  fillSelect(el.upscaleSelect, upscales, state.upscaleFactor, (value) => `${value}× sharper`);

  el.ratioControl.classList.toggle("is-locked", !ratioChoosable);
  el.resolutionControl.hidden = !(options.resolutionConfigurable && resolutions.length);
  el.upscaleControl.hidden = !upscales.length;
  el.durationControl.hidden = durations.length <= 1 && durations[0] === "Auto" && upscales.length > 0;

  el.audio.checked = state.audio;
  el.audio.disabled = !audioConfigurable;
  el.audioRow.classList.toggle("is-unavailable", !audioConfigurable);
  setText(el.audioNote, audioConfigurable ? "This model can generate its own sound." : options.audioAvailable ? "This model always returns sound." : "This model does not generate sound.");

  const limit = options.promptCharacterLimit || 2500;
  el.prompt.maxLength = String(limit);
  updatePromptCount();

  applyPreviewRatio(ratios.length ? state.ratio : "16:9");
  renderFramingNote();

  if (model) {
    const requirement = {
      text: "Starts from your words only.",
      image: "Needs one starting image.",
      transition: "Combines two images: the clip travels from the first to the last.",
      reference: `Combines up to ${imageSlots()} images of one subject to keep it consistent.`,
      video: "Needs a source video."
    }[model.inputKind] || "";
    el.modelHint.innerHTML = "";
    el.modelHint.append(document.createTextNode("Good for: "));
    const strong = document.createElement("b");
    strong.textContent = model.bestFor || "general video generation.";
    el.modelHint.append(strong, document.createTextNode(` ${requirement}`));
  } else {
    setText(el.modelHint, hasAccess() ? "No model in this mode right now." : "Connect in Settings to load the live Venice model list.");
  }

  renderSpec(model, options);
  renderSource();
  renderDock();
}

function renderSpec(model, options) {
  el.modelSpec.replaceChildren();
  if (!model) return;
  const rows = [
    ["Model ID", model.profileId ? "resolved by the server" : model.id],
    ["Privacy", model.privacy || "See Venice settings"],
    ["Lengths", (options.durations || []).join(", ") || "Not listed"],
    ["Shapes", (options.aspectRatios || []).join(", ") || "Fixed by the model"],
    ["Quality", (options.resolutions || []).join(", ") || (options.upscaleFactors || []).map((value) => `${value}×`).join(", ") || "Fixed by the model"],
    ["Sound", options.audioConfigurable ? "Optional" : options.audioAvailable ? "Always on" : "None"],
    ["Prompt limit", `${(options.promptCharacterLimit || 2500).toLocaleString()} chars`],
    ["Images", imageSlots() === 0 ? "None" : imageSlots() === 1 ? "1" : `Up to ${imageSlots()}`]
  ];
  for (const [term, value] of rows) {
    const wrap = document.createElement("div");
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    dd.textContent = value;
    wrap.append(dt, dd);
    el.modelSpec.append(wrap);
  }
}

/* -------------------------------------------------------------------- modes */

function setMode(mode) {
  if (!MODE_KINDS[mode] || mode === state.mode) return;
  state.mode = mode;
  for (const tab of el.modeTabs) tab.setAttribute("aria-selected", String(tab.dataset.mode === mode));
  const wantedKind = mode === "video" ? "video" : "image";
  if (state.file && state.mediaKind !== wantedKind) clearMedia();
  renderModels();
  saveDraft();
  invalidateQuote();
}

function renderSource() {
  const kind = currentInputKind();
  const needsVideo = kind === "video";
  el.sourcePanel.hidden = kind === "text";
  if (kind === "text") { renderExtraFrames(kind); return; }

  const copy = {
    image: { title: "STARTING IMAGE", upload: "Add the photo to animate", detail: "JPG, PNG, WebP or GIF · max 25 MB", choose: "CHOOSE PHOTO" },
    transition: { title: "FIRST FRAME", upload: "Add the opening frame", detail: "Then add the last frame below.", choose: "CHOOSE FIRST" },
    reference: { title: "MAIN REFERENCE", upload: "Add the subject to keep consistent", detail: "Then add more angles of it below.", choose: "CHOOSE IMAGE" },
    video: { title: "SOURCE VIDEO", upload: "Add the video to work from", detail: "MP4, MOV or WebM · max 25 MB", choose: "CHOOSE VIDEO" }
  }[kind];

  setText(el.sourceTitle, copy.title);
  setText(el.uploadTitle, copy.upload);
  setText(el.uploadDescription, copy.detail);
  setText(el.chooseFileLabel, copy.choose);
  el.sourceTag.textContent = "REQUIRED";
  el.sourceTag.className = "tag tag-required";
  el.cameraLabel.hidden = needsVideo;
  el.pasteMedia.hidden = needsVideo;
  el.photoInput.accept = needsVideo ? VIDEO_ACCEPT : IMAGE_ACCEPT;
  renderExtraFrames(kind);
}

function clearExtraFiles() {
  for (const url of state.extraPreviews) URL.revokeObjectURL(url);
  state.extraPreviews = [];
  state.extraFiles = [];
  state.endMediaToken = null;
  state.referenceMediaTokens = [];
  el.extraFile.value = "";
}

// Only models that actually accept more than one image get a tray. Everything
// else keeps the single dropzone, so the interface never offers a slot Venice
// would reject.
function renderExtraFrames(kind) {
  const slots = imageSlots();
  const showExtra = slots > 1;
  el.extraFrames.hidden = !showExtra;
  if (!showExtra) {
    if (state.extraFiles.length) clearExtraFiles();
    return;
  }
  const extraSlots = slots - 1;
  if (state.extraFiles.length > extraSlots) {
    for (const url of state.extraPreviews.splice(extraSlots)) URL.revokeObjectURL(url);
    state.extraFiles = state.extraFiles.slice(0, extraSlots);
  }
  el.extraFile.multiple = extraSlots > 1;
  setText(el.extraLabel, kind === "transition" ? "LAST FRAME" : "MORE ANGLES OF THE SAME SUBJECT");
  setText(el.extraCount, `${state.extraFiles.length} / ${extraSlots}`);
  if (!state.extraFiles.length) {
    setText(el.extraStatus, kind === "transition"
      ? "The clip travels from your first image to this one."
      : "Optional. More angles keep the subject consistent as it moves.");
  }
  renderFrameTray(kind, extraSlots);
}

function renderFrameTray(kind, extraSlots) {
  el.frameTray.replaceChildren();
  state.extraFiles.forEach((file, index) => {
    const slot = document.createElement("li");
    slot.className = "frame-slot";

    const image = document.createElement("img");
    image.src = state.extraPreviews[index];
    image.alt = kind === "transition" ? "Last frame" : `Reference image ${index + 2}`;

    const drop = document.createElement("button");
    drop.type = "button";
    drop.className = "frame-drop";
    drop.dataset.dropIndex = String(index);
    drop.setAttribute("aria-label", `Remove ${file.name || "this image"}`);
    drop.innerHTML = '<svg class="ico"><use href="#i-x"></use></svg>';

    const tag = document.createElement("span");
    tag.className = "frame-tag";
    tag.textContent = kind === "transition" ? "LAST" : `REF ${index + 2}`;

    slot.append(image, drop, tag);
    el.frameTray.append(slot);
  });
  if (state.extraFiles.length < extraSlots) {
    const add = document.createElement("li");
    const label = document.createElement("label");
    label.className = "frame-add";
    label.setAttribute("for", "extra-file");
    label.setAttribute("role", "button");
    label.tabIndex = 0;
    label.setAttribute("aria-label", kind === "transition" ? "Add the last frame" : "Add another reference image");
    label.innerHTML = '<svg class="ico"><use href="#i-plus"></use></svg>';
    label.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); label.click(); }
    });
    add.append(label);
    el.frameTray.append(add);
  }
}

function removeExtraFile(index) {
  URL.revokeObjectURL(state.extraPreviews[index]);
  state.extraPreviews.splice(index, 1);
  state.extraFiles.splice(index, 1);
  state.endMediaToken = null;
  state.referenceMediaTokens = [];
  renderExtraFrames(currentInputKind());
  invalidateQuote();
  renderDock();
}

/* -------------------------------------------------------------------- media */

function clearMedia() {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.file = null;
  state.mediaKind = null;
  state.mediaToken = null;
  state.previewUrl = null;
  state.sourceAspect = null;
  el.previewImage.removeAttribute("src");
  el.previewVideo.removeAttribute("src");
  el.previewImage.hidden = true;
  el.previewVideo.hidden = true;
  el.mediaPreview.hidden = true;
  el.dropEmpty.hidden = false;
  el.photoInput.value = "";
  el.cameraInput.value = "";
  setText(el.mediaError, "");
  invalidateQuote();
  renderDock();
}

function mediaKindFor(file) {
  if (file.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name)) return "image";
  if (file.type.startsWith("video/") || /\.(mp4|mov|webm)$/i.test(file.name)) return "video";
  return null;
}

function mediaProblem(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".heic") || name.endsWith(".heif") || file.type === "image/heic" || file.type === "image/heif") return "This is a HEIC photo. Share or export it as JPG, then try again.";
  if (file.size > MAX_FILE_BYTES) return "This file is larger than 25 MB. Choose a smaller one.";
  if (!mediaKindFor(file)) return "Use a JPG, PNG, WebP, GIF, MP4, MOV, or WebM file.";
  return "";
}

const mediaSize = (bytes) => (bytes < 1024 * 1024
  ? `${Math.max(1, Math.round(bytes / 1024))} KB`
  : `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`);

async function uploadMedia(file) {
  const form = new FormData();
  form.append("file", file, file.name || "upload.bin");
  const response = await fetch("/api/media", { method: "POST", headers: accessHeaders(), body: form });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Could not prepare that file.");
  return body;
}

async function selectMedia(file) {
  if (!file) return;
  if (!requireAccess()) return;
  const problem = mediaProblem(file);
  if (problem) { setText(el.mediaError, problem); return; }
  const kind = mediaKindFor(file);
  const wanted = currentInputKind() === "video" ? "video" : "image";
  if (kind !== wanted) {
    setText(el.mediaError, wanted === "video" ? "This model needs an MP4, MOV, or WebM video." : "This model needs a JPG, PNG, WebP, or GIF image.");
    return;
  }
  clearMedia();
  state.file = file;
  state.mediaKind = kind;
  state.previewUrl = URL.createObjectURL(file);
  el.previewImage.hidden = kind !== "image";
  el.previewVideo.hidden = kind !== "video";
  if (kind === "image") el.previewImage.src = state.previewUrl;
  else el.previewVideo.src = state.previewUrl;
  void measureSource(file, kind);
  setText(el.mediaName, file.name || "File from clipboard");
  setText(el.mediaDetail, `Preparing ${mediaSize(file.size)}…`);
  el.dropEmpty.hidden = true;
  el.mediaPreview.hidden = false;
  state.uploading = true;
  renderDock();
  try {
    const body = await uploadMedia(file);
    state.mediaToken = body.mediaToken;
    state.mediaKind = body.kind;
    setText(el.mediaDetail, `${mediaSize(file.size)} · ready`);
  } catch (error) {
    state.mediaToken = null;
    setText(el.mediaError, error instanceof Error ? error.message : "Could not prepare that file.");
    setText(el.mediaDetail, "Choose another file");
  } finally {
    state.uploading = false;
    invalidateQuote();
    renderDock();
  }
}

// Knowing the source's shape lets the console request a frame that fits it.
async function measureSource(file, kind) {
  state.sourceAspect = null;
  try {
    const aspect = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const node = kind === "video" ? document.createElement("video") : new Image();
      const done = (value) => { URL.revokeObjectURL(url); resolve(value); };
      node.onerror = () => { URL.revokeObjectURL(url); reject(new Error("unreadable")); };
      if (kind === "video") {
        node.preload = "metadata";
        node.onloadedmetadata = () => done(node.videoWidth / node.videoHeight);
      } else {
        node.onload = () => done(node.naturalWidth / node.naturalHeight);
      }
      node.src = url;
    });
    if (!Number.isFinite(aspect) || aspect <= 0) return;
    state.sourceAspect = aspect;
    const options = currentOptions();
    const ratios = options.aspectRatios || [];
    if (!state.ratioTouched && options.aspectRatioConfigurable && ratios.length) {
      const match = closestRatio(aspect, ratios);
      if (match && match !== state.ratio) {
        state.ratio = match;
        saveDraft();
        invalidateQuote();
      }
    }
    syncOptions();
  } catch {
    renderFramingNote();
  }
}

async function selectExtraFiles(files) {
  const list = [...(files || [])];
  el.extraFile.value = "";
  if (!list.length) return;
  if (!requireAccess()) return;
  const kind = currentInputKind();
  const room = Math.max(0, imageSlots() - 1 - state.extraFiles.length);
  if (!room) { setText(el.extraStatus, "This model has no room for another image."); return; }
  for (const file of list) {
    const problem = mediaProblem(file);
    if (problem || mediaKindFor(file) !== "image") { setText(el.extraStatus, problem || "Extra frames must be images."); return; }
  }
  const chosen = list.slice(0, room);
  const skipped = list.length - chosen.length;
  state.uploading = true;
  setText(el.extraStatus, "Preparing…");
  try {
    const uploaded = await Promise.all(chosen.map((file) => uploadMedia(file)));
    for (const file of chosen) {
      state.extraFiles.push(file);
      state.extraPreviews.push(URL.createObjectURL(file));
    }
    if (kind === "transition") state.endMediaToken = uploaded[0].mediaToken;
    else state.referenceMediaTokens = [...state.referenceMediaTokens, ...uploaded.map((body) => body.mediaToken)];
    renderExtraFrames(kind);
    setText(el.extraStatus, skipped
      ? `Added ${chosen.length}. This model takes ${imageSlots()} images in total.`
      : `${state.extraFiles.length + 1} image${state.extraFiles.length ? "s" : ""} will go into this video.`);
    invalidateQuote();
  } catch (error) {
    setText(el.extraStatus, error instanceof Error ? error.message : "Could not prepare those images.");
  } finally {
    state.uploading = false;
    renderDock();
  }
}

async function readClipboardImage() {
  if (!navigator.clipboard?.read) throw new Error("Use your device's own Paste menu. This browser does not allow image paste here.");
  const items = await navigator.clipboard.read();
  for (const item of items) {
    const type = item.types.find((candidate) => candidate.startsWith("image/"));
    if (type) return new File([await item.getType(type)], `pasted-image.${type.split("/")[1] || "png"}`, { type });
  }
  throw new Error("Your clipboard does not contain an image.");
}

async function pastePrompt() {
  try {
    if (!navigator.clipboard?.readText) throw new Error("Use your device's Paste menu inside the prompt.");
    const text = await navigator.clipboard.readText();
    if (!text) throw new Error("Your clipboard has no text.");
    el.prompt.setRangeText(text, el.prompt.selectionStart, el.prompt.selectionEnd, "end");
    state.promptBeforeOptimize = null;
    el.prompt.focus();
    onPromptInput();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Use your device's Paste menu inside the prompt.");
  }
}

/* --------------------------------------------------------------- draft/state */

function updatePromptCount() {
  const limit = Number(el.prompt.maxLength || 2500);
  setText(el.promptCount, `${el.prompt.value.length.toLocaleString()} / ${limit.toLocaleString()}`);
}

function autoGrowPrompt() {
  el.prompt.style.height = "auto";
  el.prompt.style.height = `${Math.min(el.prompt.scrollHeight, window.innerHeight * 0.34)}px`;
}

function onPromptInput() {
  updatePromptCount();
  autoGrowPrompt();
  saveDraft();
  invalidateQuote();
  renderDock();
}

function renderOptimizer() {
  const button = el.optimizeButton;
  const canUndo = !state.optimizing && state.promptBeforeOptimize !== null;
  button.classList.toggle("is-busy", state.optimizing);
  button.classList.toggle("is-undo", canUndo);
  if (state.optimizing) {
    button.disabled = true;
    setText(el.optimizeLabel, "WORKING");
    button.title = "Improving your prompt…";
  } else if (canUndo) {
    button.disabled = false;
    setText(el.optimizeLabel, "UNDO");
    button.title = "Restore the prompt you wrote";
  } else {
    button.disabled = !hasAccess() || el.prompt.value.trim().length < 3;
    setText(el.optimizeLabel, "IMPROVE");
    button.title = hasAccess() ? "Improve this prompt" : "Connect in Settings to use the optimizer";
  }
  button.setAttribute("aria-label", button.title);
  button.querySelector("use")?.setAttribute("href", canUndo ? "#i-undo" : "#i-wand");
}

async function optimizePrompt() {
  if (state.optimizing) return;
  if (state.promptBeforeOptimize !== null) {
    el.prompt.value = state.promptBeforeOptimize;
    state.promptBeforeOptimize = null;
    onPromptInput();
    el.prompt.focus({ preventScroll: true });
    showToast("Your own wording is back.");
    return;
  }
  if (!requireAccess()) return;
  const draft = el.prompt.value.trim();
  if (draft.length < 3) { showToast("Write a few words first, then improve them."); return; }
  const options = currentOptions();
  state.optimizing = true;
  renderOptimizer();
  try {
    const { response, data } = await requestJson("/api/prompt/enhance", {
      prompt: draft,
      inputKind: currentInputKind(),
      modelName: currentModel()?.name || null,
      duration: state.duration,
      aspectRatio: options.aspectRatios?.length ? state.ratio : null,
      audio: state.audio === true && (options.audioAvailable === true || options.audioConfigurable === true),
      promptCharacterLimit: options.promptCharacterLimit || 2500
    });
    if (!response.ok || typeof data.prompt !== "string" || !data.prompt.trim()) {
      throw new Error(data.error || "Could not improve that prompt right now.");
    }
    state.promptBeforeOptimize = el.prompt.value;
    el.prompt.value = data.prompt;
    state.optimizing = false;
    onPromptInput();
    showToast("Prompt improved. Press UNDO to go back.");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Could not improve that prompt right now.");
  } finally {
    state.optimizing = false;
    renderOptimizer();
  }
}

function saveDraft() {
  const draft = {
    prompt: el.prompt.value,
    negativePrompt: el.negativePrompt.value,
    mode: state.mode,
    modelByMode: state.modelByMode,
    ratio: state.ratio,
    duration: state.duration,
    resolution: state.resolution,
    upscaleFactor: state.upscaleFactor,
    audio: state.audioPreference,
    savedAt: Date.now()
  };
  safeStorage(() => localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)));
}

function restoreDraft() {
  const saved = safeStorage(() => JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"));
  if (!saved) return;
  // Settings are preferences and always come back. The written prompt is
  // content, so it is dropped once it is stale.
  const fresh = Number.isFinite(saved.savedAt) && Date.now() - saved.savedAt < DRAFT_TTL_MS;
  if (fresh && typeof saved.prompt === "string") el.prompt.value = saved.prompt;
  if (fresh && typeof saved.negativePrompt === "string") el.negativePrompt.value = saved.negativePrompt;
  if (MODE_KINDS[saved.mode]) state.mode = saved.mode;
  if (saved.modelByMode && typeof saved.modelByMode === "object") state.modelByMode = { ...state.modelByMode, ...saved.modelByMode };
  if (typeof saved.ratio === "string") state.ratio = saved.ratio;
  if (typeof saved.duration === "string") state.duration = saved.duration;
  if (typeof saved.resolution === "string") state.resolution = saved.resolution;
  if (typeof saved.upscaleFactor === "string") state.upscaleFactor = saved.upscaleFactor;
  state.audioPreference = saved.audio !== false;
  state.audio = state.audioPreference;
  for (const tab of el.modeTabs) tab.setAttribute("aria-selected", String(tab.dataset.mode === state.mode));
}

function requestSettings() {
  const model = currentModel();
  return {
    prompt: el.prompt.value.trim(),
    negativePrompt: el.negativePrompt.value.trim(),
    profile: model?.profileId || "fast",
    modelId: model?.profileId ? null : model?.id || null,
    duration: state.duration,
    aspectRatio: state.ratio,
    resolution: state.resolution,
    upscaleFactor: state.upscaleFactor,
    audio: state.audio,
    hasImage: currentInputKind() !== "text"
  };
}

function quoteSignature() {
  const { profile, modelId, duration, aspectRatio, resolution, upscaleFactor, audio, hasImage } = requestSettings();
  return JSON.stringify({ profile, modelId, duration, aspectRatio, resolution, upscaleFactor, audio, hasImage });
}

function invalidateQuote() {
  state.quote = null;
  state.quoteSignature = null;
  if (state.phase === "quoted") state.phase = "idle";
  renderDock();
}

/* ------------------------------------------------------------ readiness/dock */

function readiness() {
  if (!hasAccess()) return { ok: false, message: "Connect a Venice key or the shared studio to begin." };
  if (!currentModel()) return { ok: false, message: "No model available for this mode." };
  if (!el.prompt.value.trim()) return { ok: false, message: "Describe the video to begin." };
  const kind = currentInputKind();
  if (kind !== "text" && !state.file) {
    return { ok: false, message: kind === "video" ? "Add the source video." : "Add the starting image." };
  }
  if (state.uploading) return { ok: false, message: "Preparing your file…" };
  if (kind === "transition" && !state.extraFiles.length) return { ok: false, message: "Add the ending frame." };
  return { ok: true, message: "Ready to generate" };
}

function renderDock() {
  renderOptimizer();
  const busy = ["quoting", "submitting", "queued", "rendering", "saving"].includes(state.phase);
  const button = el.generateButton;
  button.classList.remove("is-confirm", "is-busy");
  el.statusLine.classList.remove("is-error", "is-good");

  if (busy) {
    button.disabled = true;
    button.classList.add("is-busy");
    setText(el.generateLabel, state.phase === "quoting" ? "PRICING…" : state.phase === "submitting" ? "SENDING…" : progressLabel());
    setText(el.statusLine, busyStatus());
    return;
  }

  const ready = readiness();
  if (state.phase === "quoted" && state.quote !== null) {
    button.disabled = false;
    button.classList.add("is-confirm");
    setText(el.generateLabel, `CONFIRM · ${currency(state.quote)}`);
    setText(el.statusLine, "Exact Venice price. Press again to start.");
    return;
  }
  if (state.phase === "failed") {
    button.disabled = !ready.ok;
    setText(el.generateLabel, "RETRY");
    setText(el.statusLine, state.errorText || "Generation failed.");
    el.statusLine.classList.add("is-error");
    return;
  }
  button.disabled = !ready.ok;
  setText(el.generateLabel, "GENERATE");
  if (state.phase === "done") {
    setText(el.statusLine, state.finishedIn ? `Completed in ${formatElapsed(state.finishedIn)}` : "Completed");
    el.statusLine.classList.add("is-good");
    return;
  }
  setText(el.statusLine, ready.message);
  if (!ready.ok && !hasAccess()) el.statusLine.classList.add("is-error");
}

function progressPercent() {
  const { averageExecutionTime, executionDuration } = state.jobStatus || {};
  if (averageExecutionTime && executionDuration) return Math.min(95, Math.round((executionDuration / averageExecutionTime) * 100));
  if (state.startedAt) return Math.min(90, Math.round(((Date.now() - state.startedAt) / 120_000) * 100));
  return 5;
}

function progressLabel() {
  if (state.phase === "saving") return "SAVING…";
  if (state.phase === "queued") return "QUEUED…";
  return `RENDERING ${progressPercent()}%`;
}

function busyStatus() {
  if (state.phase === "quoting") return "Asking Venice for the exact price…";
  if (state.phase === "submitting") return "Submitting to Venice…";
  const elapsed = state.startedAt ? formatElapsed(Date.now() - state.startedAt) : "0:00";
  const { averageExecutionTime } = state.jobStatus || {};
  const estimate = averageExecutionTime ? ` · usually ~${Math.max(1, Math.round(averageExecutionTime / 60_000))} min` : "";
  return `${state.phase === "queued" ? "Waiting for a Venice worker" : "Rendering"} · ${elapsed}${estimate}`;
}

/* ------------------------------------------------------------------- preview */

function showPreview(which) {
  el.previewPanel.dataset.state = which;
  el.previewEmpty.hidden = which !== "empty";
  el.previewLoading.hidden = which !== "loading";
  el.previewError.hidden = which !== "error";
  el.resultVideo.hidden = which !== "video";
  el.previewActions.hidden = which !== "video";
  el.previewFrame.classList.toggle("has-video", which === "video");
}

function tickClock() {
  clearTimeout(state.clockTimer);
  if (!state.startedAt) return;
  setText(el.loadingElapsed, formatElapsed(Date.now() - state.startedAt));
  el.progressFill.style.width = `${Math.max(6, progressPercent())}%`;
  renderDock();
  state.clockTimer = window.setTimeout(tickClock, 1000);
}

function setBusyPreview(phase, detail) {
  if (phase === "submitting") unlockPreviewRatio();
  state.phase = phase;
  showPreview("loading");
  setText(el.loadingPhase, { submitting: "SUBMITTING", queued: "IN THE QUEUE", rendering: "RENDERING FRAMES", saving: "SAVING VIDEO" }[phase] || "WORKING");
  setText(el.loadingDetail, detail);
  tickClock();
  renderDock();
}

function showError(message) {
  state.phase = "failed";
  state.errorText = message;
  clearTimeout(state.clockTimer);
  showPreview("error");
  setText(el.errorMessage, message);
  renderDock();
}

/* --------------------------------------------------------------- generation */

async function requestJson(url, body) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...accessHeaders() }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function getQuote() {
  state.phase = "quoting";
  renderDock();
  try {
    const { response, data } = await requestJson("/api/video/quote", requestSettings());
    if (!response.ok) throw new Error(data.error || "Could not get a price right now.");
    if (typeof data.quote !== "number") throw new Error("Venice did not return a price. Try again in a moment.");
    state.quote = data.quote;
    state.quoteSignature = quoteSignature();
    state.phase = "quoted";
    renderDock();
  } catch (error) {
    state.phase = "idle";
    showToast(error instanceof Error ? error.message : "Could not get a price right now.");
    renderDock();
  }
}

// The server drops an upload once a job accepts it, so a second generation from
// the same photo has to send it again.
async function ensureUploads() {
  const kind = currentInputKind();
  if (kind === "text") return;
  if (state.file && !state.mediaToken) state.mediaToken = (await uploadMedia(state.file)).mediaToken;
  if (kind === "transition" && state.extraFiles[0] && !state.endMediaToken) {
    state.endMediaToken = (await uploadMedia(state.extraFiles[0])).mediaToken;
  }
  if (kind !== "transition" && state.extraFiles.length && state.referenceMediaTokens.length !== state.extraFiles.length) {
    const uploaded = await Promise.all(state.extraFiles.map((file) => uploadMedia(file)));
    state.referenceMediaTokens = uploaded.map((body) => body.mediaToken);
  }
}

async function queueVideo() {
  state.startedAt = Date.now();
  state.jobStatus = null;
  state.statusFailureCount = 0;
  setBusyPreview("submitting", "Asking Venice to accept this generation.");
  try {
    await ensureUploads();
    const payload = { ...requestSettings(), mediaToken: state.mediaToken, endMediaToken: state.endMediaToken, referenceMediaTokens: state.referenceMediaTokens };
    const { response, data } = await requestJson("/api/video/queue", payload);
    if (!response.ok) throw new Error(data.error || "Could not start this video.");
    state.job = { queueId: data.queueId, accessToken: data.accessToken, startedAt: data.createdAt || Date.now(), prompt: el.prompt.value.trim(), model: currentModel()?.name || "Venice", ratio: state.ratio, duration: state.duration };
    state.startedAt = state.job.startedAt;
    safeStorage(() => localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify(state.job)));
    state.mediaToken = null;
    state.endMediaToken = null;
    state.referenceMediaTokens = [];
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => undefined);
    state.quote = null;
    state.quoteSignature = null;
    setBusyPreview("queued", "Venice accepted the job. The server keeps watching even if you close this screen.");
    pollJob();
  } catch (error) {
    showError(error instanceof Error ? error.message : "Could not start this video.");
  }
}

function onGenerate() {
  if (["quoting", "submitting", "queued", "rendering", "saving"].includes(state.phase)) return;
  // A job that is still tracked only needs picking back up, not paying for again.
  if (state.job) {
    setBusyPreview("queued", "Checking this generation again.");
    return void pollJob();
  }
  if (!requireAccess()) return;
  const ready = readiness();
  if (!ready.ok) { showToast(ready.message); return; }
  if (state.quote !== null && state.quoteSignature === quoteSignature()) return queueVideo();
  return getQuote();
}

async function pollJob() {
  // visibilitychange, online and the scheduled timer can all fire at once on a
  // phone. Without this guard two checks race to deliver the same finished job.
  if (!state.job || state.polling || state.delivering) return;
  clearTimeout(state.pollTimer);
  state.polling = true;
  const { queueId, accessToken } = state.job;
  try {
    const response = await fetch(`/api/video/jobs/${encodeURIComponent(queueId)}?token=${encodeURIComponent(accessToken)}`, { cache: "no-store" });
    const job = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(job.error || `Status check returned ${response.status}.`);
    state.statusFailureCount = 0;
    state.jobStatus = job;
    if (job.createdAt) state.startedAt = job.createdAt;

    if (job.status === "COMPLETED" && job.ready) return await deliverVideo();
    if (job.status === "FAILED") {
      safeStorage(() => localStorage.removeItem(ACTIVE_JOB_KEY));
      state.job = null;
      showError(job.error || "Venice could not complete this video. Try again or choose another model.");
      return;
    }
    setBusyPreview(job.status === "QUEUED" ? "queued" : "rendering", job.status === "QUEUED"
      ? "A Venice worker will pick this up shortly."
      : "Venice is making frames and any sound this model supports.");
    state.pollTimer = window.setTimeout(pollJob, document.hidden ? 12_000 : 5_000);
  } catch (error) {
    state.statusFailureCount += 1;
    if (state.statusFailureCount >= MAX_STATUS_FAILURES) {
      forgetActiveJob();
      showError("This generation could not be followed any longer. Any finished clip is in HISTORY. Start a new one when you are ready.");
      return;
    }
    setBusyPreview(state.phase === "saving" ? "saving" : state.phase === "rendering" ? "rendering" : "queued", "Reconnecting to live status. Venice keeps working while this device reconnects.");
    state.pollTimer = window.setTimeout(pollJob, 12_000);
  } finally {
    state.polling = false;
  }
}

async function deliverVideo() {
  if (state.delivering || !state.job) return;
  state.delivering = true;
  const { queueId, accessToken } = state.job;
  const fileUrl = `/api/video/jobs/${encodeURIComponent(queueId)}/file?token=${encodeURIComponent(accessToken)}`;
  setBusyPreview("saving", "Downloading the finished MP4 to this device.");
  try {
    const response = await fetch(fileUrl);
    if (!response.ok) throw new Error("The video is ready, but it could not be downloaded yet.");
    const blob = await response.blob();
    const entry = {
      id: queueId,
      prompt: state.job.prompt || el.prompt.value.trim(),
      model: state.job.model || "Venice",
      ratio: state.job.ratio || state.ratio,
      duration: state.job.duration || state.duration,
      createdAt: Date.now()
    };
    const saved = await saveVideoOnDevice(queueId, blob);
    if (saved) addHistory(entry);
    state.finishedIn = state.startedAt ? Date.now() - state.startedAt : null;
    safeStorage(() => localStorage.removeItem(ACTIVE_JOB_KEY));
    state.job = null;
    setResult(blob, `vivvideo-${queueId}.mp4`, fileUrl);
    showToast(saved ? "Video ready and saved on this device." : "Video ready. Download it now. This browser could not keep a copy.");
  } catch (error) {
    showError(error instanceof Error ? error.message : "The video is ready, but it could not be downloaded yet.");
  } finally {
    state.delivering = false;
  }
}

// Playback sources are tried in order. A streamed same-origin URL is the most
// widely supported on iOS Safari, and the object URL keeps working when the
// server copy has been pruned, so each covers the other's failure.
function playFrom(sources) {
  state.playbackSources = sources.filter(Boolean);
  el.playbackNote.hidden = true;
  nextPlaybackSource();
}

function nextPlaybackSource() {
  const source = state.playbackSources.shift();
  if (!source) return;
  el.resultVideo.src = source;
  el.resultVideo.load();
}

function onVideoError() {
  if (el.resultVideo.hidden || !el.resultVideo.getAttribute("src")) return;
  if (state.playbackSources.length) return nextPlaybackSource();
  const unsupported = el.resultVideo.error?.code === 4;
  setText(el.playbackNoteText, unsupported
    ? "This browser cannot decode this clip's video format."
    : "This clip could not be played here.");
  el.playbackOpen.href = el.downloadVideo.getAttribute("href") || "#";
  el.playbackNote.hidden = false;
}

function setResult(blob, name, streamUrl) {
  clearTimeout(state.clockTimer);
  if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
  state.resultUrl = blob ? URL.createObjectURL(blob) : null;
  el.downloadVideo.href = state.resultUrl || streamUrl;
  el.downloadVideo.download = name;
  playFrom([streamUrl, state.resultUrl]);
  state.phase = "done";
  showPreview("video");
  renderDock();
  if (window.matchMedia("(max-width: 999px)").matches) el.previewFrame.scrollIntoView({ behavior: "smooth", block: "center" });
}

function forgetActiveJob() {
  clearTimeout(state.pollTimer);
  clearTimeout(state.clockTimer);
  state.pollTimer = null;
  state.clockTimer = null;
  state.job = null;
  state.jobStatus = null;
  state.startedAt = null;
  state.statusFailureCount = 0;
  safeStorage(() => localStorage.removeItem(ACTIVE_JOB_KEY));
}

function clearResult() {
  if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
  state.resultUrl = null;
  state.playbackSources = [];
  state.finishedIn = null;
  el.resultVideo.removeAttribute("src");
  el.resultVideo.load();
  el.downloadVideo.removeAttribute("href");
  el.playbackNote.hidden = true;
}

// NEW starts from nothing: no prompt, no images, no leftover clip, no job being
// followed, no saved draft, and a freshly checked connection.
async function startNewVideo() {
  forgetActiveJob();
  clearResult();
  clearMedia();
  clearExtraFiles();
  el.prompt.value = "";
  el.negativePrompt.value = "";
  state.quote = null;
  state.quoteSignature = null;
  state.promptBeforeOptimize = null;
  state.sourceAspect = null;
  state.ratioTouched = false;
  state.phase = "idle";
  safeStorage(() => localStorage.removeItem(DRAFT_KEY));
  unlockPreviewRatio();
  showPreview("empty");
  updatePromptCount();
  autoGrowPrompt();
  setText(el.mediaError, "");
  setText(el.extraStatus, "");
  el.framingNote.hidden = true;
  renderModels();
  renderDock();
  el.prompt.focus({ preventScroll: true });
  await restoreAccess();
  await loadCatalog();
  renderDock();
}

/* -------------------------------------------------------------- device store */

function openVideoDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("roam-video-files", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("clips", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveVideoOnDevice(id, blob) {
  try {
    const database = await openVideoDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("clips", "readwrite");
      transaction.objectStore("clips").put({ id, blob, savedAt: Date.now() });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    safeStorage(() => localStorage.setItem(LATEST_VIDEO_KEY, id));
    return true;
  } catch {
    return false;
  }
}

async function readVideoOnDevice(id) {
  try {
    const database = await openVideoDatabase();
    const record = await new Promise((resolve, reject) => {
      const request = database.transaction("clips", "readonly").objectStore("clips").get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return record?.blob || null;
  } catch {
    return null;
  }
}

function deleteVideoDatabase() {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.deleteDatabase("roam-video-files");
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
      request.onblocked = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

function renderStorageSummary() {
  const items = readHistory();
  setText(el.storageSummary, items.length
    ? `${items.length} clip${items.length === 1 ? "" : "s"} saved, plus the current draft.`
    : "Nothing stored yet.");
  if (!state.purgeArmed) setText(el.clearStorage, "CLEAR EVERYTHING");
}

let purgeTimer;
async function clearStoredData() {
  if (!state.purgeArmed) {
    state.purgeArmed = true;
    setText(el.clearStorage, "TAP AGAIN TO DELETE");
    el.clearStorage.classList.add("is-danger");
    clearTimeout(purgeTimer);
    purgeTimer = window.setTimeout(() => {
      state.purgeArmed = false;
      el.clearStorage.classList.remove("is-danger");
      renderStorageSummary();
    }, 5000);
    return;
  }
  clearTimeout(purgeTimer);
  state.purgeArmed = false;
  el.clearStorage.classList.remove("is-danger");
  forgetActiveJob();
  clearResult();
  for (const key of [HISTORY_KEY, LATEST_VIDEO_KEY, DRAFT_KEY, ACTIVE_JOB_KEY]) {
    safeStorage(() => localStorage.removeItem(key));
  }
  const wiped = await deleteVideoDatabase();
  renderHistory();
  renderStorageSummary();
  showPreview("empty");
  renderDock();
  showToast(wiped ? "Everything stored on this device is gone." : "History cleared. Some saved clips are still in use and will clear on reload.");
}

async function deleteVideoOnDevice(id) {
  try {
    const database = await openVideoDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("clips", "readwrite");
      transaction.objectStore("clips").delete(id);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  } catch {
    // A clip that cannot be removed still disappears from the visible history list.
  }
}

const readHistory = () => safeStorage(() => JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]")) || [];
const writeHistory = (items) => safeStorage(() => localStorage.setItem(HISTORY_KEY, JSON.stringify(items)));

function addHistory(entry) {
  const items = [entry, ...readHistory().filter((item) => item.id !== entry.id)];
  for (const removed of items.slice(HISTORY_LIMIT)) void deleteVideoOnDevice(removed.id);
  writeHistory(items.slice(0, HISTORY_LIMIT));
  renderHistory();
  renderStorageSummary();
}

function renderHistory() {
  const items = readHistory();
  el.historyEmpty.hidden = items.length > 0;
  el.historyList.replaceChildren();
  for (const item of items) {
    const row = document.createElement("li");
    row.className = "history-item";

    const open = document.createElement("button");
    open.type = "button";
    open.className = "history-open";
    open.dataset.id = item.id;

    const thumb = document.createElement("span");
    thumb.className = "history-thumb";
    thumb.innerHTML = '<svg class="ico"><use href="#i-play"></use></svg>';

    const meta = document.createElement("span");
    meta.className = "history-meta";
    const title = document.createElement("strong");
    title.textContent = item.prompt || "Untitled clip";
    const detail = document.createElement("span");
    const when = new Date(item.createdAt || Date.now());
    detail.textContent = `${item.model || "Venice"} · ${item.duration || ""} ${item.ratio || ""} · ${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    meta.append(title, detail);
    open.append(thumb, meta);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-button";
    remove.dataset.remove = item.id;
    remove.setAttribute("aria-label", "Delete this clip");
    remove.innerHTML = '<svg class="ico"><use href="#i-trash"></use></svg>';

    row.append(open, remove);
    el.historyList.append(row);
  }
}

async function openHistoryItem(id) {
  const blob = await readVideoOnDevice(id);
  if (!blob) { showToast("That clip is no longer stored on this device."); return; }
  closeDrawer();
  setResult(blob, `vivvideo-${id}.mp4`);
  state.finishedIn = null;
}

async function removeHistoryItem(id) {
  writeHistory(readHistory().filter((item) => item.id !== id));
  await deleteVideoOnDevice(id);
  renderHistory();
  renderStorageSummary();
}

async function restoreLatestVideo() {
  const newest = readHistory()[0];
  const id = newest?.id || safeStorage(() => localStorage.getItem(LATEST_VIDEO_KEY));
  if (!id) return;
  // An old clip stays in HISTORY, one tap away, rather than filling the preview
  // of a session that is about to make something new.
  if (newest?.createdAt && Date.now() - newest.createdAt > RESULT_TTL_MS) return;
  const blob = await readVideoOnDevice(id);
  if (blob) { setResult(blob, `vivvideo-${id}.mp4`); state.finishedIn = null; renderDock(); }
}

/* ------------------------------------------------------------------ drawers */

function openDrawer(drawer) {
  closeDrawer();
  state.openDrawer = drawer;
  drawer.hidden = false;
  el.scrim.hidden = false;
  drawer.querySelector("button, input, a")?.focus({ preventScroll: true });
}

function closeDrawer() {
  if (state.openDrawer) state.openDrawer.hidden = true;
  state.openDrawer = null;
  el.scrim.hidden = true;
}

/* -------------------------------------------------------------------- wiring */

function wire() {
  for (const tab of el.modeTabs) tab.addEventListener("click", () => setMode(tab.dataset.mode));

  el.prompt.addEventListener("input", () => { state.promptBeforeOptimize = null; onPromptInput(); });
  el.optimizeButton.addEventListener("click", optimizePrompt);
  el.prompt.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); onGenerate(); }
  });
  el.negativePrompt.addEventListener("input", () => { saveDraft(); invalidateQuote(); });
  el.pastePrompt.addEventListener("click", pastePrompt);
  el.chipRow.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-preset]");
    if (!chip) return;
    const existing = el.prompt.value.trim();
    el.prompt.value = existing ? `${existing.replace(/[.,\s]+$/, "")}, ${chip.dataset.preset}` : chip.dataset.preset;
    state.promptBeforeOptimize = null;
    el.prompt.focus();
    onPromptInput();
  });

  el.photoInput.addEventListener("change", () => selectMedia(el.photoInput.files?.[0]));
  el.cameraInput.addEventListener("change", () => selectMedia(el.cameraInput.files?.[0]));
  el.extraFile.addEventListener("change", () => selectExtraFiles(el.extraFile.files));
  el.frameTray.addEventListener("click", (event) => {
    const drop = event.target.closest("[data-drop-index]");
    if (drop) removeExtraFile(Number(drop.dataset.dropIndex));
  });
  el.removeMedia.addEventListener("click", clearMedia);
  el.pasteMedia.addEventListener("click", async () => {
    try { await selectMedia(await readClipboardImage()); }
    catch (error) { showToast(error instanceof Error ? error.message : "Use your device's Paste menu."); }
  });
  for (const label of [el.chooseFileLabel, el.cameraLabel]) {
    label.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); label.click(); } });
  }
  el.dropzone.addEventListener("dragover", (event) => { event.preventDefault(); el.dropzone.classList.add("is-dragging"); });
  el.dropzone.addEventListener("dragleave", () => el.dropzone.classList.remove("is-dragging"));
  el.dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    el.dropzone.classList.remove("is-dragging");
    selectMedia(event.dataTransfer?.files?.[0]);
  });
  document.addEventListener("paste", (event) => {
    if (currentInputKind() === "text" || currentInputKind() === "video") return;
    const file = [...(event.clipboardData?.files || [])].find((item) => item.type.startsWith("image/"));
    if (file) { event.preventDefault(); selectMedia(file); }
  });

  el.modelSelect.addEventListener("change", () => {
    state.modelByMode[state.mode] = el.modelSelect.value;
    syncOptions();
    saveDraft();
    invalidateQuote();
  });
  el.ratioSelect.addEventListener("change", () => {
    state.ratio = el.ratioSelect.value;
    state.ratioTouched = true;
    unlockPreviewRatio();
    renderFramingNote();
    saveDraft();
    invalidateQuote();
  });
  el.durationSelect.addEventListener("change", () => { state.duration = el.durationSelect.value; saveDraft(); invalidateQuote(); });
  el.resolutionSelect.addEventListener("change", () => { state.resolution = el.resolutionSelect.value; saveDraft(); invalidateQuote(); });
  el.upscaleSelect.addEventListener("change", () => { state.upscaleFactor = el.upscaleSelect.value; saveDraft(); invalidateQuote(); });
  el.audio.addEventListener("change", () => { state.audioPreference = el.audio.checked; state.audio = el.audio.checked; saveDraft(); invalidateQuote(); });

  el.generateButton.addEventListener("click", onGenerate);
  el.retryButton.addEventListener("click", () => {
    if (!state.job) { state.phase = "idle"; showPreview("empty"); }
    onGenerate();
  });
  el.makeAnother.addEventListener("click", () => void startNewVideo());
  el.resultVideo.addEventListener("error", onVideoError);
  el.resultVideo.addEventListener("loadedmetadata", onVideoMetadata);

  el.historyButton.addEventListener("click", () => { renderHistory(); openDrawer(el.historyDrawer); });
  el.closeHistory.addEventListener("click", closeDrawer);
  el.settingsButton.addEventListener("click", () => { renderStorageSummary(); openDrawer(el.settingsDrawer); });
  el.closeSettings.addEventListener("click", closeDrawer);
  el.scrim.addEventListener("click", closeDrawer);
  el.historyList.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove]");
    if (remove) return void removeHistoryItem(remove.dataset.remove);
    const open = event.target.closest("[data-id]");
    if (open) void openHistoryItem(open.dataset.id);
  });

  el.useApiKey.addEventListener("click", usePersonalApiKey);
  el.unlockShared.addEventListener("click", unlockSharedStudio);
  el.clearAccess.addEventListener("click", clearAccess);
  el.clearStorage.addEventListener("click", () => void clearStoredData());
  el.apiKey.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); usePersonalApiKey(); } });
  el.sharedPassword.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); unlockSharedStudio(); } });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.openDrawer) { event.preventDefault(); closeDrawer(); }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && document.activeElement !== el.prompt) { event.preventDefault(); onGenerate(); }
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && state.job) pollJob(); });
  window.addEventListener("online", () => { if (state.job) pollJob(); });
}

/* --------------------------------------------------------------------- start */

async function initialize() {
  restoreDraft();
  wire();
  renderModels();
  updatePromptCount();
  autoGrowPrompt();
  renderHistory();
  renderStorageSummary();
  showPreview("empty");
  await restoreAccess();
  void loadCatalog();

  const remembered = safeStorage(() => JSON.parse(localStorage.getItem(ACTIVE_JOB_KEY) || "null"));
  const jobIsStale = remembered?.startedAt && Date.now() - remembered.startedAt > JOB_TTL_MS;
  if (jobIsStale) safeStorage(() => localStorage.removeItem(ACTIVE_JOB_KEY));
  if (!jobIsStale && remembered?.queueId && remembered?.accessToken) {
    state.job = remembered;
    state.startedAt = remembered.startedAt || Date.now();
    setBusyPreview("queued", "Picking up the generation that was already running.");
    pollJob();
  } else {
    void restoreLatestVideo();
  }
  renderDock();
  if (!hasAccess()) openDrawer(el.settingsDrawer);
}

initialize();
