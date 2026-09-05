const note = document.querySelector("#live-note");
const grid = document.querySelector("#live-models");

const MODE_LABEL = {
  text: "TEXT → VIDEO",
  image: "IMAGE → VIDEO",
  transition: "TWO IMAGES",
  reference: "REFERENCE → VIDEO",
  video: "VIDEO → VIDEO"
};
const CATEGORY_LABEL = { image: "IMAGE → VIDEO", text: "TEXT → VIDEO", reference: "REFERENCE → VIDEO", video: "VIDEO → VIDEO" };
const CATEGORY_ORDER = ["image", "text", "reference", "video"];

const safeStorage = (action) => { try { return action(); } catch { return null; } };

function card(model) {
  const article = document.createElement("article");
  article.className = "model-card";

  const title = document.createElement("h3");
  title.textContent = model.name || model.id;

  const body = document.createElement("p");
  body.textContent = model.bestFor || model.description || "";

  const badges = document.createElement("div");
  badges.className = "badges";
  const entries = [[MODE_LABEL[model.inputKind] || "VIDEO", model.recommended ? "badge badge-accent" : "badge"]];
  if (model.recommended) entries.push(["RECOMMENDED", "badge badge-accent"]);
  if (model.beta) entries.push(["BETA", "badge badge-warn"]);
  if (String(model.privacy).toLowerCase() === "private") entries.push(["PRIVATE", "badge badge-warn"]);
  const lengths = model.options?.durations?.join(", ");
  entries.push([lengths || "LENGTH SET BY MODEL", "badge"]);
  if (model.imageSlots > 1) entries.push([`${model.imageSlots} IMAGES`, "badge"]);
  for (const [label, className] of entries) {
    const badge = document.createElement("span");
    badge.className = className;
    badge.textContent = label;
    badges.append(badge);
  }

  const id = document.createElement("p");
  id.className = "mini-note";
  id.textContent = model.id;

  article.append(title, body, badges, id);
  return article;
}

async function loadLiveModels() {
  const personalKey = safeStorage(() => sessionStorage.getItem("roam-personal-venice-key")) || "";
  try {
    const response = await fetch("/api/video/models", {
      cache: "no-store",
      headers: personalKey ? { "X-Venice-API-Key": personalKey } : {}
    });
    if (!response.ok) return;
    const data = await response.json().catch(() => ({}));
    const models = Array.isArray(data.advancedModels) ? data.advancedModels : [];
    if (!models.length) return;
    note.textContent = `${models.length} Venice video models are available to this account right now, grouped the way the console groups them: the shortlist first, then everything else newest first.`;
    // The server already ranks each category, so this only adds the headings.
    const sections = [];
    for (const category of CATEGORY_ORDER) {
      const inCategory = models.filter((model) => (model.category || model.inputKind) === category);
      if (!inCategory.length) continue;
      const heading = document.createElement("h3");
      heading.className = "live-group";
      heading.textContent = CATEGORY_LABEL[category];
      sections.push(heading, ...inCategory.map(card));
    }
    grid.replaceChildren(...sections);
  } catch {
    // The written guide above stays useful even when the live list cannot load.
  }
}

loadLiveModels();
