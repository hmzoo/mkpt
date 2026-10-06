const entityKinds = ["characters", "locations", "actions"];
const formKeys = {
  characters: "character",
  locations: "location",
  actions: "action",
  templates: "template",
};
const slotKinds = [
  { key: "characters", singular: "character", label: "Personnage", plural: "Personnages", countId: "template-character-slots" },
  { key: "locations", singular: "location", label: "Lieu", plural: "Lieux", countId: "template-location-slots" },
  { key: "actions", singular: "action", label: "Action", plural: "Actions", countId: "template-action-slots" },
];
const variableFields = [
  { label: "Nom", property: "name" },
  { label: "Caractéristiques", property: "characteristics" },
  { label: "URL de l’image", property: "images[0].url" },
];
const labels = {
  builder: "Générateur",
  characters: "Personnages",
  locations: "Lieux",
  actions: "Actions",
  templates: "Templates",
};
const state = { characters: [], locations: [], actions: [], templates: [] };
let toastTimer;

async function api(path, options = {}) {
  const response = await fetch(`/api/${path}`, options);
  if (!response.ok) {
    let message = "Une erreur est survenue.";
    try {
      const body = await response.json();
      message = body.detail || message;
    } catch {
      // Use the generic message when the server did not return JSON.
    }
    throw new Error(message);
  }
  return response.status === 204 ? null : response.json();
}

function notify(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 3200);
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function showView(name) {
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  document.querySelector(`#view-${name}`).classList.add("active");
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.toggle("active", link.dataset.view === name);
  });
  document.querySelector("#crumb-current").textContent = labels[name];
  history.replaceState(null, "", `#${name}`);
}

function renderSelects() {
  const select = document.querySelector("#build-template");
  const previous = select.value;
  select.innerHTML = `<option value="">Choisissez un template</option>${state.templates.map((item) =>
    `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("")}`;
  if (state.templates.some((item) => String(item.id) === previous)) select.value = previous;
  renderBuilderSlots();
}

function getSlotCount(kind) {
  const input = document.querySelector(`#${kind.countId}`);
  return Math.min(20, Math.max(0, Number.parseInt(input.value, 10) || 0));
}

function renderTemplateVariablePicker() {
  const picker = document.querySelector("#template-variable-picker");
  picker.innerHTML = slotKinds.map((kind) => {
    const slots = Array.from({ length: getSlotCount(kind) }, (_, index) => {
      const slotName = `${kind.singular}_${index + 1}`;
      const buttons = variableFields.map((field) => {
        const path = `${slotName}.${field.property}`;
        return `<button type="button" class="variable-button" data-variable="${escapeHtml(path)}">${escapeHtml(field.label)}</button>`;
      }).join("");
      return `<div class="variable-slot"><span>${kind.label} ${index + 1}</span>${buttons}</div>`;
    }).join("");
    return slots ? `<section class="variable-group"><strong>${kind.plural}</strong>${slots}</section>` : "";
  }).join("") || `<p class="slot-empty">Ajoutez au moins un emplacement pour afficher les variables à insérer.</p>`;
}

function renderBuilderSlots() {
  const container = document.querySelector("#builder-slots");
  const empty = document.querySelector("#builder-slots-empty");
  const previous = new Map(
    [...container.querySelectorAll("select[data-kind]")].map((select) => [select.id, select.value]),
  );
  const template = state.templates.find(
    (item) => String(item.id) === document.querySelector("#build-template").value,
  );
  container.replaceChildren();
  if (!template) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  for (const kind of slotKinds) {
    const count = template[`${kind.singular}_slots`];
    for (let index = 1; index <= count; index += 1) {
      const id = `build-${kind.singular}-${index}`;
      const row = document.createElement("div");
      row.className = "builder-slot";
      row.innerHTML = `
        <div class="selector-row">
          <label class="field-label" for="${id}">${kind.label.toUpperCase()} ${index}</label>
          <button type="button" class="text-action" data-go="${kind.key}">+ Ajouter</button>
        </div>
        <select id="${id}" data-kind="${kind.key}" required>
          <option value="">Choisissez ${kind.label === "Lieu" ? "un lieu" : `un${kind.label === "Action" ? "e action" : " personnage"}`}</option>
          ${state[kind.key].map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("")}
        </select>`;
      container.append(row);
      const select = row.querySelector("select");
      if (state[kind.key].some((item) => String(item.id) === previous.get(id))) {
        select.value = previous.get(id);
      }
    }
  }
}

function insertTemplateVariable(variable) {
  const editor = document.querySelector("#template-content");
  const token = `{{ ${variable} }}`;
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  editor.setRangeText(token, start, end, "end");
  editor.focus();
}

function renderEntity(kind) {
  const list = document.querySelector(`#${kind}-list`);
  const items = state[kind];
  document.querySelector(`#${kind}-count`).textContent = items.length;
  if (!items.length) {
    list.innerHTML = `<div class="empty-list"><span>✧</span><strong>Votre bibliothèque est encore vide</strong><p>Créez votre premier élément avec le formulaire.</p></div>`;
    return;
  }
  list.innerHTML = items.map((item) => {
    const images = item.images.map((image) => `
      <div class="reference-image">
        <img src="${escapeHtml(image.url)}" alt="Image de référence de ${escapeHtml(item.name)}">
        <button type="button" data-remove-image="${escapeHtml(image.filename)}" data-item-id="${item.id}" aria-label="Supprimer cette image">×</button>
      </div>`).join("");
    return `<article class="library-card">
      <div class="card-top"><div class="avatar">${escapeHtml(item.name.slice(0, 1).toUpperCase())}</div><div class="card-title"><h3>${escapeHtml(item.name)}</h3><span>${item.images.length} image${item.images.length === 1 ? "" : "s"} de référence</span></div><div class="card-actions"><button type="button" data-edit="${item.id}" aria-label="Modifier ${escapeHtml(item.name)}">Modifier</button><button type="button" class="delete-action" data-delete="${item.id}" aria-label="Supprimer ${escapeHtml(item.name)}">Supprimer</button></div></div>
      ${item.characteristics ? `<p class="card-description">${escapeHtml(item.characteristics)}</p>` : ""}
      ${images ? `<div class="image-strip">${images}</div>` : ""}
      <label class="upload-link">＋ Ajouter une image de référence<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-upload="${item.id}" hidden></label>
    </article>`;
  }).join("");
}

function renderTemplates() {
  const list = document.querySelector("#templates-list");
  document.querySelector("#templates-count").textContent = state.templates.length;
  if (!state.templates.length) {
    list.innerHTML = `<div class="empty-list"><span>✧</span><strong>Aucun template pour le moment</strong><p>Créez une structure de prompt réutilisable.</p></div>`;
    return;
  }
  list.innerHTML = state.templates.map((template) => `
    <article class="library-card template-card">
      <div class="card-top"><div class="avatar template-avatar">▤</div><div class="card-title"><h3>${escapeHtml(template.name)}</h3><span>${template.character_slots} personnage(s) · ${template.location_slots} lieu(x) · ${template.action_slots} action(s)</span></div><div class="card-actions"><button type="button" data-edit="${template.id}">Modifier</button><button type="button" class="delete-action" data-delete="${template.id}">Supprimer</button></div></div>
      <pre>${escapeHtml(template.content)}</pre>
    </article>`).join("");
}

async function refresh() {
  const results = await Promise.all([
    ...entityKinds.map((kind) => api(kind)),
    api("templates"),
  ]);
  entityKinds.forEach((kind, index) => {
    state[kind] = results[index];
    renderEntity(kind);
  });
  state.templates = results[3];
  renderTemplates();
  renderSelects();
}

function resetForm(kind) {
  const formKey = formKeys[kind];
  const form = document.querySelector(`#${formKey}-form`);
  form.reset();
  document.querySelector(`#${formKey}-id`).value = "";
  document.querySelector(`[data-cancel="${kind}"]`).classList.add("hidden");
  if (kind === "templates") {
    document.querySelector("#template-form-title").textContent = "Nouveau template";
    renderTemplateVariablePicker();
  } else {
    const singular = { characters: "personnage", locations: "lieu", actions: "action" }[kind];
    document.querySelector(`#${formKey}-form-title`).textContent = `Nouveau ${singular}`;
  }
}

function editItem(kind, id) {
  const item = state[kind].find((entry) => entry.id === Number(id));
  if (!item) return;
  const formKey = formKeys[kind];
  document.querySelector(`#${formKey}-id`).value = item.id;
  document.querySelector(`#${formKey}-name`).value = item.name;
  if (kind === "templates") {
    document.querySelector("#template-content").value = item.content;
    document.querySelector("#template-character-slots").value = item.character_slots;
    document.querySelector("#template-location-slots").value = item.location_slots;
    document.querySelector("#template-action-slots").value = item.action_slots;
    renderTemplateVariablePicker();
    document.querySelector("#template-form-title").textContent = "Modifier le template";
  } else {
    document.querySelector(`#${formKey}-characteristics`).value = item.characteristics;
    const singular = { characters: "personnage", locations: "lieu", actions: "action" }[kind];
    document.querySelector(`#${formKey}-form-title`).textContent = `Modifier le ${singular}`;
  }
  document.querySelector(`[data-cancel="${kind}"]`).classList.remove("hidden");
  document.querySelector(`#view-${kind} .form-panel`).scrollIntoView({ behavior: "smooth", block: "start" });
}

async function submitEntity(kind, event) {
  event.preventDefault();
  const formKey = formKeys[kind];
  if (!formKey) throw new Error("Type de formulaire inconnu.");
  const id = document.querySelector(`#${formKey}-id`).value;
  const payload = { name: document.querySelector(`#${formKey}-name`).value };
  if (kind === "templates") {
    payload.content = document.querySelector("#template-content").value;
    for (const slot of slotKinds) {
      payload[`${slot.singular}_slots`] = getSlotCount(slot);
    }
  } else {
    payload.characteristics = document.querySelector(`#${formKey}-characteristics`).value;
  }
  await api(id ? `${kind}/${id}` : kind, {
    method: id ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  resetForm(kind);
  await refresh();
  notify(id ? "Modifications enregistrées." : "Élément ajouté à votre bibliothèque.");
}

async function removeItem(kind, id) {
  const item = state[kind].find((entry) => entry.id === Number(id));
  if (!item || !confirm(`Supprimer « ${item.name} » ?`)) return;
  await api(`${kind}/${id}`, { method: "DELETE" });
  await refresh();
  notify("Élément supprimé.");
}

document.querySelectorAll(".nav-link").forEach((link) => {
  link.addEventListener("click", () => showView(link.dataset.view));
});
document.querySelectorAll("[data-go]").forEach((link) => {
  link.addEventListener("click", () => showView(link.dataset.go));
});
document.querySelector("#builder-slots").addEventListener("click", (event) => {
  const addButton = event.target.closest("[data-go]");
  if (addButton) showView(addButton.dataset.go);
});
document.querySelector("#build-template").addEventListener("change", renderBuilderSlots);
slotKinds.forEach((kind) => {
  document.querySelector(`#${kind.countId}`).addEventListener("input", renderTemplateVariablePicker);
});
document.querySelector("#template-variable-picker").addEventListener("click", (event) => {
  const button = event.target.closest("[data-variable]");
  if (button) insertTemplateVariable(button.dataset.variable);
});
document.querySelectorAll(".entity-form").forEach((form) => {
  form.addEventListener("submit", (event) => submitEntity(form.dataset.kind, event).catch((error) => notify(error.message)));
});
document.querySelectorAll("[data-cancel]").forEach((button) => {
  button.addEventListener("click", () => resetForm(button.dataset.cancel));
});

document.querySelectorAll(".card-list").forEach((list) => {
  list.addEventListener("click", async (event) => {
    const kind = list.id.replace("-list", "");
    const edit = event.target.closest("[data-edit]");
    const remove = event.target.closest("[data-delete]");
    const removeImage = event.target.closest("[data-remove-image]");
    if (edit) editItem(kind, edit.dataset.edit);
    if (remove) {
      try { await removeItem(kind, remove.dataset.delete); } catch (error) { notify(error.message); }
    }
    if (removeImage) {
      try {
        await api(`${kind}/${removeImage.dataset.itemId}/images/${encodeURIComponent(removeImage.dataset.removeImage)}`, { method: "DELETE" });
        await refresh();
      } catch (error) { notify(error.message); }
    }
  });
  list.addEventListener("change", async (event) => {
    const input = event.target.closest("[data-upload]");
    if (!input?.files?.[0]) return;
    const form = new FormData();
    form.append("file", input.files[0]);
    try {
      await api(`${list.id.replace("-list", "")}/${input.dataset.upload}/images`, { method: "POST", body: form });
      await refresh();
      notify("Image de référence ajoutée.");
    } catch (error) { notify(error.message); }
  });
});

document.querySelector("#builder-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const templateId = document.querySelector("#build-template").value;
  const payload = {
    template_id: Number(templateId),
    character_ids: [],
    location_ids: [],
    action_ids: [],
  };
  for (const select of document.querySelectorAll("#builder-slots select[data-kind]")) {
    const payloadKey = `${select.dataset.kind.slice(0, -1)}_ids`;
    payload[payloadKey].push(Number(select.value));
  }
  try {
    const result = await api("build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    document.querySelector("#prompt-output").textContent = result.prompt;
    document.querySelector("#result-empty").classList.add("hidden");
    document.querySelector("#result-content").classList.remove("hidden");
  } catch (error) { notify(error.message); }
});

document.querySelector("#copy-button").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(document.querySelector("#prompt-output").textContent);
    notify("Prompt copié dans le presse-papiers.");
  } catch {
    notify("Impossible d'accéder au presse-papiers depuis ce navigateur.");
  }
});

window.addEventListener("hashchange", () => {
  const view = location.hash.slice(1);
  if (labels[view]) showView(view);
});

refresh().catch((error) => notify(error.message));
renderTemplateVariablePicker();
const initialView = location.hash.slice(1);
if (labels[initialView]) showView(initialView);
