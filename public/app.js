const $ = (selector) => document.querySelector(selector);

const elements = {
  form: $("#video-form"),
  prompt: $("#prompt"),
  promptCount: $("#prompt-count"),
  pastePrompt: $("#paste-prompt"),
  copyPrompt: $("#copy-prompt"),
  pasteMedia: $("#paste-media"),
  photoInput: $("#photo-file"),
  cameraInput: $("#camera-file"),
  uploadArea: $("#upload-area"),
  uploadEmpty: $("#upload-empty"),
  mediaPreview: $("#media-preview"),
  previewImage: $("#preview-image"),
  mediaName: $("#media-name"),
  mediaDetail: $("#media-detail"),
  removeMedia: $("#remove-media"),
  mediaError: $("#media-error"),
  modelPicker: $("#model-picker"),
  modelNote: $("#model-note"),
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
  { id: "fast", name: "Fast draft", provider: "LTX Video 2.3 Fast", description: "Quick tests and simple scenes.", supportsText: true, supportsPhoto: true },
  { id: "movement", name: "Natural movement", provider: "HappyHorse 1.1", description: "People, animals, and lively movement.", supportsText: true, supportsPhoto: true },
  { id: "cinematic", name: "Cinematic", provider: "Kling O3 Standard", description: "Polished camera work and visual detail.", supportsText: true, supportsPhoto: true },
  { id: "creative", name: "Creative detail", provider: "Wan 2.7", description: "Expressive scenes led by a detailed prompt.", supportsText: true, supportsPhoto: true }
];

const state = {
  ratio: "9:16",
  duration: "5s",
  audio: true,
  profile: "fast",
  profiles: fallbackProfiles,
  file: null,
  mediaToken: null,
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

function getSettings() {
  return { prompt: elements.prompt.value.trim(), profile: state.profile, duration: state.duration, aspectRatio: state.ratio, audio: state.audio, hasImage: Boolean(state.mediaToken) };
}

function quoteSignature() {
  const { profile, duration, aspectRatio, audio, hasImage } = getSettings();
  return JSON.stringify({ profile, duration, aspectRatio, audio, hasImage });
}

function safeStorage(action) {
  try { return action(); } catch { return null; }
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
  const draft = { prompt: elements.prompt.value, profile: state.profile, ratio: state.ratio, duration: state.duration, audio: state.audio };
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
  if (["9:16", "16:9", "1:1"].includes(saved.ratio)) state.ratio = saved.ratio;
  if (["5s", "10s"].includes(saved.duration)) state.duration = saved.duration;
  state.audio = saved.audio !== false;
  $("#audio").checked = state.audio;
  syncSettingButtons();
  updatePromptCount();
}

function selectedProfile() {
  return state.profiles.find((profile) => profile.id === state.profile) || state.profiles[0];
}

function profileSupportsCurrentSource(profile) {
  return state.file ? profile.supportsPhoto !== false : profile.supportsText !== false;
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
    button.setAttribute("aria-pressed", String(profile.id === state.profile));
    const name = document.createElement("strong");
    name.textContent = profile.name;
    const provider = document.createElement("span");
    provider.className = "model-provider";
    provider.textContent = profile.provider;
    const description = document.createElement("span");
    description.className = "model-description";
    description.textContent = supported ? profile.description : "This option needs a different starting point.";
    button.append(name, provider, description);
    elements.modelPicker.append(button);
  }
  elements.modelNote.textContent = `${current.name} uses ${current.provider}. ${current.description}`;
}

async function loadProfiles() {
  try {
    const response = await fetch("/api/video/models", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(data.profiles) || data.profiles.length === 0) return;
    state.profiles = data.profiles;
    if (!state.profiles.some((profile) => profile.id === state.profile)) state.profile = state.profiles[0].id;
    renderProfiles();
  } catch {
    // The safe local choices remain visible while the server reconnects.
  }
}

function updatePromptCount() {
  elements.promptCount.textContent = `${elements.prompt.value.length.toLocaleString()} / 2,500`;
}

function syncSettingButtons() {
  document.querySelectorAll("[data-setting]").forEach((button) => {
    const selected = button.dataset.setting === "ratio" ? state.ratio : state.duration;
    button.setAttribute("aria-pressed", String(button.dataset.value === selected));
  });
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
  state.previewUrl = null;
  elements.previewImage.removeAttribute("src");
  elements.mediaPreview.hidden = true;
  elements.uploadEmpty.hidden = false;
  elements.photoInput.value = "";
  elements.cameraInput.value = "";
  setText(elements.mediaError, "");
  renderProfiles();
  invalidateQuote();
}

function isSupportedPhoto(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".heic") || name.endsWith(".heif") || file.type === "image/heic" || file.type === "image/heif") return "This is a HEIC photo. Export or share it as JPG, PNG, or WebP, then try again.";
  if (file.size > MAX_FILE_BYTES) return "This photo is larger than 25 MB. Choose a smaller photo, then try again.";
  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type) && !/\.(jpe?g|png|webp|gif)$/.test(name)) return "Use a JPG, PNG, WebP, or GIF photo.";
  return "";
}

function mediaSize(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

async function selectPhoto(file) {
  if (!file) return;
  const error = isSupportedPhoto(file);
  if (error) { setText(elements.mediaError, error); return; }
  cleanMedia();
  state.file = file;
  renderProfiles();
  state.previewUrl = URL.createObjectURL(file);
  elements.previewImage.src = state.previewUrl;
  elements.mediaName.textContent = file.name || "Photo from clipboard";
  elements.mediaDetail.textContent = `Preparing ${mediaSize(file.size)} for this video`;
  elements.uploadEmpty.hidden = true;
  elements.mediaPreview.hidden = false;
  elements.quoteButton.disabled = true;
  try {
    const form = new FormData();
    form.append("file", file, file.name || "pasted-image.png");
    const response = await fetch("/api/media", { method: "POST", body: form });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Could not prepare that photo.");
    state.mediaToken = body.mediaToken;
    elements.mediaDetail.textContent = `${mediaSize(file.size)} ready to animate`;
  } catch (uploadError) {
    state.mediaToken = null;
    setText(elements.mediaError, uploadError instanceof Error ? uploadError.message : "Could not prepare that photo.");
    elements.mediaDetail.textContent = "Choose another photo to continue";
  } finally {
    elements.quoteButton.disabled = false;
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
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function showQuote() {
  elements.reviewRatio.textContent = state.ratio === "9:16" ? "Vertical" : state.ratio === "16:9" ? "Wide" : "Square";
  elements.reviewDuration.textContent = state.duration.replace("s", " seconds");
  elements.reviewSource.textContent = state.mediaToken ? "Your photo" : "Your description";
  elements.reviewModel.textContent = selectedProfile().name;
  elements.quotePrice.textContent = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(state.quote);
  showReview(elements.reviewQuote);
}

async function getQuote(event) {
  event?.preventDefault();
  setText(elements.formError, "");
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
  return { ...getSettings(), mediaToken: state.mediaToken };
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
  elements.prompt.addEventListener("input", () => { updatePromptCount(); saveDraft(); invalidateQuote(); });
  elements.pastePrompt.addEventListener("click", pastePrompt);
  elements.copyPrompt.addEventListener("click", copyPrompt);
  elements.pasteMedia.addEventListener("click", async () => {
    try { await selectPhoto(await readClipboardImage()); }
    catch (error) { showToast(error instanceof Error ? error.message : "Use the normal Paste menu or choose a photo."); }
  });
  [elements.photoInput, elements.cameraInput].forEach((input) => input.addEventListener("change", () => selectPhoto(input.files?.[0])));
  elements.removeMedia.addEventListener("click", cleanMedia);
  elements.uploadArea.addEventListener("dragover", (event) => { event.preventDefault(); elements.uploadArea.classList.add("is-dragging"); });
  elements.uploadArea.addEventListener("dragleave", () => elements.uploadArea.classList.remove("is-dragging"));
  elements.uploadArea.addEventListener("drop", (event) => {
    event.preventDefault();
    elements.uploadArea.classList.remove("is-dragging");
    selectPhoto(event.dataTransfer?.files?.[0]);
  });
  document.addEventListener("paste", (event) => {
    const file = [...(event.clipboardData?.files || [])].find((item) => item.type.startsWith("image/"));
    if (file) { event.preventDefault(); selectPhoto(file); }
  });
  document.querySelectorAll("[data-setting]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.setting === "ratio") state.ratio = button.dataset.value;
    else state.duration = button.dataset.value;
    syncSettingButtons(); saveDraft(); invalidateQuote();
  }));
  elements.modelPicker.addEventListener("click", (event) => {
    const button = event.target.closest("[data-profile]");
    if (!button || button.disabled) return;
    state.profile = button.dataset.profile;
    renderProfiles(); saveDraft(); invalidateQuote();
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
  renderProfiles();
  wireEvents();
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
