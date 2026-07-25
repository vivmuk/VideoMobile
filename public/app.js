const $ = (selector) => document.querySelector(selector);

const elements = {
  form: $("#video-form"),
  accessCard: $("#access-card"),
  accessState: $("#access-state"),
  accessError: $("#access-error"),
  apiKey: $("#venice-api-key"),
  useApiKey: $("#use-api-key"),
  sharedPassword: $("#shared-password"),
  unlockShared: $("#unlock-shared"),
  clearAccess: $("#clear-access"),
  prompt: $("#prompt"),
  promptCount: $("#prompt-count"),
  pastePrompt: $("#paste-prompt"),
  copyPrompt: $("#copy-prompt"),
  pasteMedia: $("#paste-media"),
  photoInput: $("#photo-file"),
  cameraInput: $("#camera-file"),
  sourceLabel: $("#source-label"),
  uploadTitle: $("#upload-title"),
  uploadDescription: $("#upload-description"),
  chooseFileLabel: $("#choose-file-label"),
  cameraLabel: $("#camera-label"),
  uploadArea: $("#upload-area"),
  uploadEmpty: $("#upload-empty"),
  mediaPreview: $("#media-preview"),
  previewImage: $("#preview-image"),
  previewVideo: $("#preview-video"),
  mediaName: $("#media-name"),
  mediaDetail: $("#media-detail"),
  removeMedia: $("#remove-media"),
  mediaError: $("#media-error"),
  endMedia: $("#end-media"),
  endPhotoInput: $("#end-photo-file"),
  endMediaStatus: $("#end-media-status"),
  modelPicker: $("#model-picker"),
  modelNote: $("#model-note"),
  advancedModels: $("#advanced-models"),
  advancedModel: $("#advanced-model"),
  advancedModelNote: $("#advanced-model-note"),
  durationSetting: $("#duration-setting"),
  durationSelect: $("#duration-select"),
  ratioSetting: $("#ratio-setting"),
  ratioSelect: $("#ratio-select"),
  resolutionSetting: $("#resolution-setting"),
  resolutionSelect: $("#resolution-select"),
  upscaleSetting: $("#upscale-setting"),
  upscaleSelect: $("#upscale-select"),
  quoteButton: $("#quote-button"),
  queueButton: $("#queue-button"),
  formError: $("#form-error"),
  draftStatus: $("#draft-status"),
  reviewEmpty: $("#review-empty"),
  reviewQuote: $("#review-quote"),
  reviewProcessing: $("#review-processing"),
  reviewComplete: $("#review-complete"),
  reviewRatio: $("#review-ratio"),
  reviewDuration: $("#review-duration"),
  reviewSource: $("#review-source"),
  reviewModel: $("#review-model"),
  quotePrice: $("#quote-price"),
  processingTitle: $("#processing-title"),
  processingDetail: $("#processing-detail"),
  processingTime: $("#processing-time"),
  resultVideo: $("#result-video"),
  downloadVideo: $("#download-video"),
  makeAnother: $("#make-another"),
  helpButton: $("#help-button"),
  closeHelp: $("#close-help"),
  helpPanel: $("#help-panel"),
  toast: $("#toast")
};

const fallbackProfiles = [
  { id: "fast", name: "Fast draft", provider: "LTX Video 2.3 Fast", description: "Quick tests and simple scenes.", privacy: "Anonymized", supportsText: true, supportsPhoto: true, textOptions: { durations: ["10s"], aspectRatios: ["9:16", "16:9", "1:1"], audioConfigurable: true }, photoOptions: { durations: ["10s"], aspectRatios: ["9:16", "16:9", "1:1"], audioConfigurable: true } },
  { id: "movement", name: "Natural movement", provider: "HappyHorse 1.1", description: "People, animals, and lively movement.", privacy: "Anonymized", supportsText: true, supportsPhoto: true },
  { id: "seedance", name: "Cinematic precision", provider: "Seedance 2.0", description: "Detailed shots, lighting, camera direction, and native audio.", privacy: "Anonymized", supportsText: true, supportsPhoto: true },
  { id: "grok-private", name: "Mood and emotion", provider: "Grok Imagine Private", description: "Private, conversational storytelling with human emotion and atmosphere.", privacy: "Private", supportsText: true, supportsPhoto: true },
  { id: "grok-15-private", name: "Grok Imagine 1.5 Private", provider: "Grok Imagine 1.5 Private", description: "Private photo animation with a strong starting image.", privacy: "Private · Photo required", supportsText: false, supportsPhoto: true },
  { id: "kling", name: "Polished production", provider: "Kling O3 Standard", description: "Balanced quality and speed for refined camera work.", privacy: "Anonymized", supportsText: true, supportsPhoto: true },
  { id: "wan-unrestricted", name: "Uncensored creative", provider: "Wan 2.7 Uncensored", description: "Venice's uncensored option for explicit, detailed creative direction.", privacy: "Anonymized · Uncensored", supportsText: true, supportsPhoto: true },
  { id: "wan-private", name: "Private photo motion", provider: "Wan 2.1 Pro", description: "Private image-to-video when you want to animate a supplied frame.", privacy: "Private · Photo required", supportsText: false, supportsPhoto: true }
];

const state = {
  ratio: "9:16",
  duration: "5s",
  resolution: "720p",
  upscaleFactor: "2",
  audio: true,
  profile: "fast",
  profiles: fallbackProfiles,
  advancedModels: [],
  modelId: null,
  personalApiKey: "",
  sharedAccess: false,
  file: null,
  mediaToken: null,
  mediaKind: null,
  endMediaToken: null,
  endPreviewUrl: null,
  previewUrl: null,
  quoteSignature: null,
  quote: null,
  job: null,
  resultUrl: null,
  pollTimer: null
};

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const DRAFT_KEY = "roam-video-draft";
const ACTIVE_JOB_KEY = "roam-active-video-job";
const LATEST_VIDEO_KEY = "roam-latest-video";
const PERSONAL_KEY_SESSION = "roam-personal-venice-key";

function getSettings() {
  return {
    prompt: elements.prompt.value.trim(), profile: state.profile, modelId: state.modelId,
    duration: state.duration, aspectRatio: state.ratio, resolution: state.resolution,
    upscaleFactor: state.upscaleFactor, audio: state.audio, hasImage: Boolean(state.mediaToken)
  };
}

function quoteSignature() {
  const { profile, modelId, duration, aspectRatio, resolution, upscaleFactor, audio, hasImage } = getSettings();
  return JSON.stringify({ profile, modelId, duration, aspectRatio, resolution, upscaleFactor, audio, hasImage });
}

function safeStorage(action) {
  try { return action(); } catch { return null; }
}

function accessHeaders() {
  return state.personalApiKey ? { "X-Venice-API-Key": state.personalApiKey } : {};
}

function hasAccess() {
  return Boolean(state.personalApiKey || state.sharedAccess);
}

function updateAccessPresentation() {
  const usingPersonalKey = Boolean(state.personalApiKey);
  const message = usingPersonalKey ? "Using your Venice key for this session" : state.sharedAccess ? "Shared studio unlocked on this device" : "Not connected";
  setText(elements.accessState, message);
  elements.clearAccess.hidden = !hasAccess();
  elements.accessCard.classList.toggle("is-connected", hasAccess());
}

function requireAccess() {
  if (hasAccess()) return true;
  setText(elements.accessError, "Enter your Venice API key or unlock the shared studio before continuing.");
  elements.accessCard.scrollIntoView({ behavior: "smooth", block: "center" });
  elements.apiKey.focus({ preventScroll: true });
  return false;
}

async function usePersonalApiKey() {
  const key = elements.apiKey.value.trim();
  if (!key) {
    setText(elements.accessError, "Paste your Venice API key first.");
    elements.apiKey.focus();
    return;
  }
  state.personalApiKey = key;
  safeStorage(() => sessionStorage.setItem(PERSONAL_KEY_SESSION, key));
  elements.apiKey.value = "";
  setText(elements.accessError, "");
  updateAccessPresentation();
  await loadProfiles();
}

async function unlockSharedStudio() {
  const password = elements.sharedPassword.value;
  if (!password) {
    setText(elements.accessError, "Enter the shared studio password first.");
    elements.sharedPassword.focus();
    return;
  }
  elements.unlockShared.disabled = true;
  try {
    const response = await fetch("/api/access/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not unlock the shared studio.");
    state.sharedAccess = true;
    elements.sharedPassword.value = "";
    setText(elements.accessError, "");
    updateAccessPresentation();
    await loadProfiles();
  } catch (error) {
    setText(elements.accessError, error instanceof Error ? error.message : "Could not unlock the shared studio.");
  } finally {
    elements.unlockShared.disabled = false;
  }
}

async function clearAccess() {
  state.personalApiKey = "";
  state.sharedAccess = false;
  safeStorage(() => sessionStorage.removeItem(PERSONAL_KEY_SESSION));
  await fetch("/api/access/logout", { method: "POST" }).catch(() => undefined);
  updateAccessPresentation();
  setText(elements.accessError, "");
  state.profiles = fallbackProfiles;
  state.advancedModels = [];
  state.modelId = null;
  renderAdvancedModels();
  renderProfiles();
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
  updateAccessPresentation();
}

function setText(element, message) {
  element.textContent = message || "";
}

let toastTimer;
function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.hidden = false;
  elements.toast.textContent = message;
  toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 4200);
}

function showReview(name) {
  [elements.reviewEmpty, elements.reviewQuote, elements.reviewProcessing, elements.reviewComplete].forEach((panel) => { panel.hidden = panel !== name; });
}

function saveDraft() {
  const draft = { prompt: elements.prompt.value, profile: state.profile, modelId: state.modelId, ratio: state.ratio, duration: state.duration, resolution: state.resolution, upscaleFactor: state.upscaleFactor, audio: state.audio };
  if (safeStorage(() => localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))) !== null) {
    setText(elements.draftStatus, "Saved on this device");
    window.setTimeout(() => setText(elements.draftStatus, ""), 1600);
  }
}

function restoreDraft() {
  const saved = safeStorage(() => JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"));
  if (!saved) return;
  elements.prompt.value = typeof saved.prompt === "string" ? saved.prompt : "";
  if (fallbackProfiles.some((profile) => profile.id === saved.profile)) state.profile = saved.profile;
  if (typeof saved.modelId === "string") state.modelId = saved.modelId;
  if (typeof saved.ratio === "string") state.ratio = saved.ratio;
  if (typeof saved.duration === "string") state.duration = saved.duration;
  if (typeof saved.resolution === "string") state.resolution = saved.resolution;
  if (typeof saved.upscaleFactor === "string") state.upscaleFactor = saved.upscaleFactor;
  state.audio = saved.audio !== false;
  $("#audio").checked = state.audio;
  updatePromptCount();
}

function selectedProfile() {
  if (state.modelId) {
    const advanced = state.advancedModels.find((model) => model.id === state.modelId);
    if (advanced) return advanced;
  }
  return state.profiles.find((profile) => profile.id === state.profile) || state.profiles[0];
}

function profileSupportsCurrentSource(profile) {
  return state.file ? profile.supportsPhoto !== false : profile.supportsText !== false;
}

function selectedModelOptions() {
  const profile = selectedProfile();
  if (!profile) return null;
  if (state.modelId) return profile.options || null;
  return state.file ? profile.photoOptions || null : profile.textOptions || null;
}

function selectedInputKind() {
  return state.modelId ? selectedProfile()?.inputKind || "text" : state.file ? "image" : "text";
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

function updateSourcePresentation() {
  const inputKind = selectedInputKind();
  const needsVideo = inputKind === "video";
  const needsTransitionEnd = inputKind === "transition";
  const sourceCopy = needsVideo
    ? { label: "Start with a video", title: "Improve or restyle a video", description: "MP4, MOV, or WebM, up to 25 MB.", choose: "Choose video" }
    : inputKind === "reference"
      ? { label: "Add a reference image", title: "Give the model a visual reference", description: "JPG, PNG, WebP, or GIF, up to 25 MB.", choose: "Choose image" }
      : inputKind === "transition"
        ? { label: "Choose the first transition image", title: "Create a transition between two images", description: "Add this image, then choose the ending image below.", choose: "Choose first image" }
        : { label: "Start with a photo", title: "Bring a photo to life", description: "JPG, PNG, WebP, or GIF, up to 25 MB.", choose: "Choose photo" };
  elements.sourceLabel.innerHTML = `${sourceCopy.label}${inputKind === "text" ? ' <span class="optional">optional</span>' : ""}`;
  elements.uploadTitle.textContent = sourceCopy.title;
  elements.uploadDescription.textContent = sourceCopy.description;
  elements.chooseFileLabel.textContent = sourceCopy.choose;
  elements.pasteMedia.hidden = needsVideo;
  elements.cameraLabel.hidden = needsVideo || inputKind === "reference" || inputKind === "transition";
  elements.endMedia.hidden = !needsTransitionEnd;
  if (!needsTransitionEnd) {
    state.endMediaToken = null;
    if (state.endPreviewUrl) URL.revokeObjectURL(state.endPreviewUrl);
    state.endPreviewUrl = null;
    elements.endPhotoInput.value = "";
    elements.endMediaStatus.textContent = "Choose the last frame.";
  }
}

function applyModelOptions() {
  const options = selectedModelOptions();
  const durations = options?.durations?.length ? options.durations : ["5s", "10s"];
  const aspectRatios = options?.aspectRatios || ["9:16", "16:9", "1:1"];
  const resolutions = options?.resolutions || ["720p"];
  const upscaleFactors = options?.upscaleFactors || [];
  let changed = false;
  if (!durations.includes(state.duration)) { state.duration = durations[0]; changed = true; }
  if (aspectRatios.length && !aspectRatios.includes(state.ratio)) { state.ratio = aspectRatios[0]; changed = true; }
  if (resolutions.length && !resolutions.includes(state.resolution)) { state.resolution = resolutions[0]; changed = true; }
  if (upscaleFactors.length && !upscaleFactors.includes(state.upscaleFactor)) { state.upscaleFactor = upscaleFactors[0]; changed = true; }
  const audioConfigurable = options?.audioConfigurable === true;
  const audioAvailable = options?.audioAvailable === true;
  if (!audioConfigurable && state.audio !== audioAvailable) { state.audio = audioAvailable; changed = true; }
  const promptLimit = options?.promptCharacterLimit || 2500;
  elements.prompt.maxLength = String(promptLimit);
  fillSelect(elements.durationSelect, durations, state.duration, (value) => value.replace("s", " sec"));
  fillSelect(elements.ratioSelect, aspectRatios, state.ratio, (value) => value);
  fillSelect(elements.resolutionSelect, resolutions, state.resolution, (value) => value);
  fillSelect(elements.upscaleSelect, upscaleFactors, state.upscaleFactor, (value) => `${value}×`);
  elements.ratioSetting.hidden = !(options?.aspectRatioConfigurable !== false && aspectRatios.length);
  elements.resolutionSetting.hidden = !(options?.resolutionConfigurable !== false && resolutions.length);
  elements.upscaleSetting.hidden = !upscaleFactors.length;
  $("#audio").checked = state.audio;
  $("#audio").disabled = !audioConfigurable;
  $("#audio").closest(".toggle-line")?.classList.toggle("is-unavailable", !audioConfigurable);
  updateSourcePresentation();
  updatePromptCount();
  return changed;
}

function renderProfiles() {
  const current = selectedProfile();
  if (!current) return;
  elements.modelPicker.replaceChildren();
  for (const profile of state.profiles) {
    const button = document.createElement("button");
    const supported = profileSupportsCurrentSource(profile);
    button.type = "button";
    button.dataset.profile = profile.id;
    button.className = "model-card";
    button.disabled = !supported;
    button.setAttribute("aria-pressed", String(!state.modelId && profile.id === state.profile));
    const name = document.createElement("strong");
    name.textContent = profile.name;
    const provider = document.createElement("span");
    provider.className = "model-provider";
    provider.textContent = profile.provider;
    const privacy = document.createElement("span");
    privacy.className = "model-privacy";
    privacy.textContent = profile.privacy || "Check Venice settings";
    const description = document.createElement("span");
    description.className = "model-description";
    description.textContent = supported ? profile.description : "This option needs a different starting point.";
    button.append(name, provider, privacy, description);
    elements.modelPicker.append(button);
  }
  const options = selectedModelOptions();
  const durationNote = options?.durations?.length ? ` Available here: ${options.durations.join(" or ")}.` : "";
  elements.modelNote.textContent = `${current.name} uses ${current.provider || "the Venice API"}. ${current.description}${durationNote}`;
}

function renderAdvancedModels() {
  elements.advancedModel.replaceChildren();
  const recommended = document.createElement("option");
  recommended.value = "";
  recommended.textContent = "Use a recommended model above";
  elements.advancedModel.append(recommended);
  if (!state.advancedModels.length) {
    elements.advancedModelNote.textContent = "Connect with a Venice key or the shared studio password to load the current catalog.";
    return;
  }
  for (const model of state.advancedModels) {
    const option = document.createElement("option");
    option.value = model.id;
    const input = model.inputKind === "video" ? "video" : model.inputKind === "transition" ? "two images" : model.inputKind === "reference" ? "references" : model.inputKind === "image" ? "image" : "text";
    option.textContent = `${model.name}${model.beta ? " (beta)" : ""} / ${input} / ${model.privacy}`;
    elements.advancedModel.append(option);
  }
  const selected = state.advancedModels.find((model) => model.id === state.modelId);
  if (selected) {
    elements.advancedModel.value = selected.id;
    const sourceHint = selected.inputKind === "video" ? "Upload an MP4, MOV, or WebM." : selected.inputKind === "transition" ? "Upload a start and ending image." : selected.inputKind === "reference" ? "Upload a reference image." : selected.inputKind === "image" ? "Upload a starting image." : "Start from your description.";
    elements.advancedModelNote.textContent = `Great for: ${selected.bestFor || selected.description} ${sourceHint} ${selected.privacy === "private" ? "Private generation." : "Anonymized generation."}${selected.beta ? " Beta availability depends on the Venice key's access level." : ""}`;
  } else {
    state.modelId = null;
    elements.advancedModel.value = "";
    elements.advancedModelNote.textContent = "Every current Venice video model is listed. Choose one and we will show only the settings it accepts.";
  }
}

async function loadProfiles() {
  if (!hasAccess()) return;
  try {
    const response = await fetch("/api/video/models", { cache: "no-store", headers: accessHeaders() });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(data.profiles) || data.profiles.length === 0) return;
    state.profiles = data.profiles;
    state.advancedModels = Array.isArray(data.advancedModels) ? data.advancedModels : [];
    if (!state.profiles.some((profile) => profile.id === state.profile)) state.profile = state.profiles[0].id;
    renderAdvancedModels();
    applyModelOptions();
    renderProfiles();
  } catch {
    // The safe local choices remain visible while the server reconnects.
  }
}

function updatePromptCount() {
  elements.promptCount.textContent = `${elements.prompt.value.length.toLocaleString()} / ${Number(elements.prompt.maxLength || 2500).toLocaleString()}`;
}

function invalidateQuote() {
  state.quote = null;
  state.quoteSignature = null;
  if (!state.job && !elements.reviewComplete.hidden) return;
  if (!state.job) showReview(elements.reviewEmpty);
}

function cleanMedia() {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.file = null;
  state.mediaToken = null;
  state.mediaKind = null;
  state.previewUrl = null;
  elements.previewImage.removeAttribute("src");
  elements.previewVideo.removeAttribute("src");
  elements.previewImage.hidden = true;
  elements.previewVideo.hidden = true;
  elements.mediaPreview.hidden = true;
  elements.uploadEmpty.hidden = false;
  elements.photoInput.value = "";
  elements.cameraInput.value = "";
  setText(elements.mediaError, "");
  applyModelOptions();
  renderProfiles();
  invalidateQuote();
}

function mediaKindFor(file) {
  if (file.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name)) return "image";
  if (file.type.startsWith("video/") || /\.(mp4|mov|webm)$/i.test(file.name)) return "video";
  return null;
}

function isSupportedMedia(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".heic") || name.endsWith(".heif") || file.type === "image/heic" || file.type === "image/heif") return "This is a HEIC photo. Export or share it as JPG, PNG, or WebP, then try again.";
  if (file.size > MAX_FILE_BYTES) return "This file is larger than 25 MB. Choose a smaller one, then try again.";
  if (!mediaKindFor(file) || (!["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/quicktime", "video/webm"].includes(file.type) && !/\.(jpe?g|png|webp|gif|mp4|mov|webm)$/.test(name))) return "Use a JPG, PNG, WebP, GIF, MP4, MOV, or WebM file.";
  return "";
}

function mediaSize(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

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
  const error = isSupportedMedia(file);
  if (error) { setText(elements.mediaError, error); return; }
  const kind = mediaKindFor(file);
  const inputKind = selectedInputKind();
  if (inputKind === "video" && kind !== "video") { setText(elements.mediaError, "This model needs an MP4, MOV, or WebM video."); return; }
  if (inputKind !== "video" && kind !== "image") { setText(elements.mediaError, "This model needs a JPG, PNG, WebP, or GIF image."); return; }
  cleanMedia();
  state.file = file;
  state.mediaKind = kind;
  applyModelOptions();
  renderProfiles();
  state.previewUrl = URL.createObjectURL(file);
  elements.previewImage.hidden = kind !== "image";
  elements.previewVideo.hidden = kind !== "video";
  if (kind === "image") elements.previewImage.src = state.previewUrl;
  else elements.previewVideo.src = state.previewUrl;
  elements.mediaName.textContent = file.name || "File from clipboard";
  elements.mediaDetail.textContent = `Preparing ${mediaSize(file.size)} for this video`;
  elements.uploadEmpty.hidden = true;
  elements.mediaPreview.hidden = false;
  elements.quoteButton.disabled = true;
  try {
    const body = await uploadMedia(file);
    state.mediaToken = body.mediaToken;
    state.mediaKind = body.kind;
    elements.mediaDetail.textContent = `${mediaSize(file.size)} ready for this model`;
  } catch (uploadError) {
    state.mediaToken = null;
    setText(elements.mediaError, uploadError instanceof Error ? uploadError.message : "Could not prepare that file.");
    elements.mediaDetail.textContent = "Choose another file to continue";
  } finally {
    elements.quoteButton.disabled = false;
  }
}

async function selectEndPhoto(file) {
  if (!file) return;
  const error = isSupportedMedia(file);
  if (error || mediaKindFor(file) !== "image") { setText(elements.mediaError, error || "The ending frame needs to be an image."); return; }
  elements.endMediaStatus.textContent = "Preparing ending image…";
  try {
    const body = await uploadMedia(file);
    state.endMediaToken = body.mediaToken;
    if (state.endPreviewUrl) URL.revokeObjectURL(state.endPreviewUrl);
    state.endPreviewUrl = URL.createObjectURL(file);
    elements.endMediaStatus.textContent = `${file.name || "Ending image"} is ready.`;
    invalidateQuote();
  } catch (error) {
    state.endMediaToken = null;
    elements.endMediaStatus.textContent = "Choose the last frame.";
    setText(elements.mediaError, error instanceof Error ? error.message : "Could not prepare that ending image.");
  }
}

async function readClipboardImage() {
  if (!navigator.clipboard?.read) throw new Error("Use the normal Paste menu on your phone. Your browser does not offer image paste here.");
  const items = await navigator.clipboard.read();
  for (const item of items) {
    const type = item.types.find((candidate) => candidate.startsWith("image/"));
    if (type) {
      const blob = await item.getType(type);
      return new File([blob], `pasted-image.${type.split("/")[1] || "png"}`, { type });
    }
  }
  throw new Error("Your clipboard does not have an image. Choose a photo instead.");
}

async function pastePrompt() {
  try {
    if (!navigator.clipboard?.readText) throw new Error("Use the normal Paste menu inside the description box.");
    const text = await navigator.clipboard.readText();
    if (!text) throw new Error("Your clipboard does not have text to paste.");
    elements.prompt.setRangeText(text, elements.prompt.selectionStart, elements.prompt.selectionEnd, "end");
    elements.prompt.focus();
    updatePromptCount();
    saveDraft();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Use the normal Paste menu inside the description box.");
  }
}

async function copyPrompt() {
  const text = elements.prompt.value.trim();
  if (!text) return showToast("Write your idea first, then you can copy it.");
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard writing is not available.");
    await navigator.clipboard.writeText(text);
    showToast("Idea copied.");
  } catch {
    elements.prompt.focus();
    elements.prompt.select();
    showToast("Your idea is selected. Use your phone's Copy menu.");
  }
}

async function requestJson(url, body) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...accessHeaders() }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function showQuote() {
  elements.reviewRatio.textContent = state.ratio === "9:16" ? "Vertical" : state.ratio === "16:9" ? "Wide" : "Square";
  elements.reviewDuration.textContent = state.duration.replace("s", " seconds");
  const inputKind = selectedInputKind();
  elements.reviewSource.textContent = inputKind === "video" ? "Your video" : inputKind === "transition" ? "Two images" : inputKind === "reference" ? "Your reference image" : state.mediaToken ? "Your photo" : "Your description";
  elements.reviewModel.textContent = selectedProfile().name;
  elements.quotePrice.textContent = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(state.quote);
  showReview(elements.reviewQuote);
}

async function getQuote(event) {
  event?.preventDefault();
  setText(elements.formError, "");
  if (!requireAccess()) return;
  applyModelOptions();
  if (!elements.prompt.value.trim()) {
    setText(elements.formError, "Describe the video first.");
    elements.prompt.focus();
    return;
  }
  if (state.file && !state.mediaToken) {
    setText(elements.formError, "Wait for the photo to finish preparing, or remove it and try again.");
    return;
  }
  elements.quoteButton.disabled = true;
  elements.quoteButton.textContent = "Checking price";
  try {
    const { response, data } = await requestJson("/api/video/quote", getSettings());
    if (!response.ok) throw new Error(data.error || "Could not get a price right now.");
    if (typeof data.quote !== "number") throw new Error("Venice did not return a price. Try again in a moment.");
    state.quote = data.quote;
    state.quoteSignature = quoteSignature();
    showQuote();
  } catch (error) {
    setText(elements.formError, error instanceof Error ? error.message : "Could not get a price right now.");
  } finally {
    elements.quoteButton.disabled = false;
    elements.quoteButton.textContent = "Check price";
  }
}

function queuePayload() {
  return { ...getSettings(), mediaToken: state.mediaToken, endMediaToken: state.endMediaToken };
}

function persistActiveJob() {
  safeStorage(() => localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify(state.job)));
}

function clearActiveJob() {
  safeStorage(() => localStorage.removeItem(ACTIVE_JOB_KEY));
}

function setProcessing(message, detail) {
  showReview(elements.reviewProcessing);
  elements.processingTitle.textContent = message;
  elements.processingDetail.textContent = detail;
}

async function queueVideo() {
  if (!state.quote || state.quoteSignature !== quoteSignature()) return getQuote();
  elements.queueButton.disabled = true;
  elements.queueButton.textContent = "Starting video";
  setProcessing("Sending it to Venice.", "Once it is queued, the server keeps watching even if you leave this screen.");
  try {
    const { response, data } = await requestJson("/api/video/queue", queuePayload());
    if (!response.ok) throw new Error(data.error || "Could not start this video.");
    state.job = { queueId: data.queueId, accessToken: data.accessToken };
    persistActiveJob();
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => undefined);
    setProcessing("Your video is being made.", "You can leave this screen. We will check again as soon as you come back.");
    pollJob();
  } catch (error) {
    showQuote();
    setText(elements.formError, error instanceof Error ? error.message : "Could not start this video.");
  } finally {
    elements.queueButton.disabled = false;
    elements.queueButton.textContent = "Create video";
  }
}

function averageTimeText(milliseconds) {
  if (!milliseconds) return "Venice is preparing your clip.";
  const minutes = Math.max(1, Math.round(milliseconds / 60_000));
  return `Venice estimates about ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

async function pollJob() {
  clearTimeout(state.pollTimer);
  if (!state.job) return;
  try {
    const { queueId, accessToken } = state.job;
    const response = await fetch(`/api/video/jobs/${encodeURIComponent(queueId)}?token=${encodeURIComponent(accessToken)}`, { cache: "no-store" });
    const job = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(job.error || "Could not check this video.");
    if (job.status === "COMPLETED" && job.ready) {
      await showCompletedVideo();
      return;
    }
    if (job.status === "FAILED") {
      clearActiveJob();
      setProcessing("This video could not be completed.", job.error || "Your idea is still here. You can change it and try again.");
      state.job = null;
      return;
    }
    setProcessing(job.status === "QUEUED" ? "Your clip is in line." : "Your video is being made.", "The server is watching the job. You can close this screen and come back.");
    elements.processingTime.textContent = averageTimeText(job.averageExecutionTime);
    state.pollTimer = window.setTimeout(pollJob, document.hidden ? 12_000 : 5_000);
  } catch (error) {
    setProcessing("Your video is still safe in the queue.", "We could not reach the server from this device. We will try again when your connection returns.");
    elements.processingTime.textContent = error instanceof Error ? error.message : "Waiting to reconnect.";
    state.pollTimer = window.setTimeout(pollJob, 12_000);
  }
}

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

function setResult(blob, name) {
  if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
  state.resultUrl = URL.createObjectURL(blob);
  elements.resultVideo.src = state.resultUrl;
  elements.downloadVideo.href = state.resultUrl;
  elements.downloadVideo.download = name;
  showReview(elements.reviewComplete);
}

async function showCompletedVideo() {
  const { queueId, accessToken } = state.job;
  setProcessing("Saving your video on this device.", "This may take a moment on mobile data.");
  const response = await fetch(`/api/video/jobs/${encodeURIComponent(queueId)}/file?token=${encodeURIComponent(accessToken)}`);
  if (!response.ok) throw new Error("The video is ready, but it could not be downloaded to this device yet.");
  const blob = await response.blob();
  const saved = await saveVideoOnDevice(queueId, blob);
  setResult(blob, `roam-${queueId}.mp4`);
  clearActiveJob();
  state.job = null;
  if (!saved) showToast("Your video is ready. Download it now because this browser could not keep a local copy.");
  else showToast("Your video is ready and saved on this device.");
}

async function restoreLatestVideo() {
  const id = safeStorage(() => localStorage.getItem(LATEST_VIDEO_KEY));
  if (!id || state.job) return;
  const blob = await readVideoOnDevice(id);
  if (blob) setResult(blob, `roam-${id}.mp4`);
}

function resetForAnother() {
  if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
  state.resultUrl = null;
  elements.resultVideo.removeAttribute("src");
  elements.downloadVideo.removeAttribute("href");
  showReview(elements.reviewEmpty);
  elements.prompt.focus({ preventScroll: true });
}

function wireEvents() {
  elements.useApiKey.addEventListener("click", usePersonalApiKey);
  elements.unlockShared.addEventListener("click", unlockSharedStudio);
  elements.clearAccess.addEventListener("click", clearAccess);
  elements.apiKey.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); usePersonalApiKey(); } });
  elements.sharedPassword.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); unlockSharedStudio(); } });
  elements.prompt.addEventListener("input", () => { updatePromptCount(); saveDraft(); invalidateQuote(); });
  elements.pastePrompt.addEventListener("click", pastePrompt);
  elements.copyPrompt.addEventListener("click", copyPrompt);
  elements.pasteMedia.addEventListener("click", async () => {
    try { await selectMedia(await readClipboardImage()); }
    catch (error) { showToast(error instanceof Error ? error.message : "Use the normal Paste menu or choose a photo."); }
  });
  [elements.photoInput, elements.cameraInput].forEach((input) => input.addEventListener("change", () => selectMedia(input.files?.[0])));
  elements.endPhotoInput.addEventListener("change", () => selectEndPhoto(elements.endPhotoInput.files?.[0]));
  elements.removeMedia.addEventListener("click", cleanMedia);
  elements.uploadArea.addEventListener("dragover", (event) => { event.preventDefault(); elements.uploadArea.classList.add("is-dragging"); });
  elements.uploadArea.addEventListener("dragleave", () => elements.uploadArea.classList.remove("is-dragging"));
  elements.uploadArea.addEventListener("drop", (event) => {
    event.preventDefault();
    elements.uploadArea.classList.remove("is-dragging");
    selectMedia(event.dataTransfer?.files?.[0]);
  });
  document.addEventListener("paste", (event) => {
    const file = [...(event.clipboardData?.files || [])].find((item) => item.type.startsWith("image/"));
    if (file) { event.preventDefault(); selectMedia(file); }
  });
  elements.durationSelect.addEventListener("change", () => { state.duration = elements.durationSelect.value; saveDraft(); invalidateQuote(); });
  elements.ratioSelect.addEventListener("change", () => { state.ratio = elements.ratioSelect.value; saveDraft(); invalidateQuote(); });
  elements.resolutionSelect.addEventListener("change", () => { state.resolution = elements.resolutionSelect.value; saveDraft(); invalidateQuote(); });
  elements.upscaleSelect.addEventListener("change", () => { state.upscaleFactor = elements.upscaleSelect.value; saveDraft(); invalidateQuote(); });
  elements.modelPicker.addEventListener("click", (event) => {
    const button = event.target.closest("[data-profile]");
    if (!button || button.disabled) return;
    state.profile = button.dataset.profile;
    state.modelId = null;
    renderAdvancedModels(); applyModelOptions(); renderProfiles(); saveDraft(); invalidateQuote();
  });
  elements.advancedModel.addEventListener("change", () => {
    state.modelId = elements.advancedModel.value || null;
    applyModelOptions(); renderProfiles(); renderAdvancedModels(); saveDraft(); invalidateQuote();
  });
  $("#audio").addEventListener("change", (event) => { state.audio = event.target.checked; saveDraft(); invalidateQuote(); });
  elements.form.addEventListener("submit", getQuote);
  elements.queueButton.addEventListener("click", () => queueVideo());
  elements.helpButton.addEventListener("click", () => {
    const open = elements.helpPanel.hidden;
    elements.helpPanel.hidden = !open;
    elements.helpButton.setAttribute("aria-expanded", String(open));
  });
  elements.closeHelp.addEventListener("click", () => { elements.helpPanel.hidden = true; elements.helpButton.setAttribute("aria-expanded", "false"); });
  elements.makeAnother.addEventListener("click", resetForAnother);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && state.job) pollJob(); });
  window.addEventListener("online", () => { if (state.job) pollJob(); });
}

async function initialize() {
  restoreDraft();
  applyModelOptions();
  renderProfiles();
  renderAdvancedModels();
  wireEvents();
  await restoreAccess();
  void loadProfiles();
  const rememberedJob = safeStorage(() => JSON.parse(localStorage.getItem(ACTIVE_JOB_KEY) || "null"));
  if (rememberedJob?.queueId && rememberedJob?.accessToken) {
    state.job = rememberedJob;
    setProcessing("Picking up your video.", "We found an active generation on this device.");
    pollJob();
  } else {
    restoreLatestVideo();
  }
}

initialize();
