// Tag Description Generator
// Keeps a Danbooru-tag description of the user's character, split into categories,
// and merges the enabled categories into an image generation prompt.

import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

// Settings key. Independent of the folder name the extension is installed into.
const extensionName = "tag-description-generator";

// Resolve files relative to this script so the folder name doesn't matter.
const settingsHtmlUrl = new URL("settings.html", import.meta.url).toString();

// Maximum emphasis allowed, both for {{tag}} brace depth and for N::tag:: weights.
const MAX_EMPHASIS = 4;

const DEFAULT_CATEGORIES = [
  { id: "head", name: "Head", description: "Face shape, facial features and anything on the head that isn't hair or eyes (e.g. round face, freckles, pointy ears, horns, scar on face)." },
  { id: "eyes", name: "Eyes", description: "Eye color, eye shape and eye details (e.g. blue eyes, tsurime, heterochromia, long eyelashes)." },
  { id: "hair", name: "Hair", description: "Hair color, length, style and bangs (e.g. black hair, short hair, ponytail, ahoge, swept bangs). Facial hair also goes here." },
  { id: "expression", name: "Expression", description: "Current facial expression and visible mood (e.g. smile, smirk, blush, frown, open mouth)." },
  { id: "chest", name: "Chest", description: "Chest build and size (e.g. pectorals, broad chest, flat chest, large breasts)." },
  { id: "abs", name: "Abs", description: "Stomach and abdominal definition (e.g. abs, toned stomach, navel, plump)." },
  { id: "arms", name: "Arms", description: "Arm build and features (e.g. muscular arms, slender arms, arm tattoo, bandaged arm)." },
  { id: "muscles", name: "Muscles", description: "Overall build and musculature (e.g. muscular, muscular male, toned, skinny, broad shoulders)." },
  { id: "legs", name: "Legs", description: "Leg and thigh build and features (e.g. long legs, thick thighs, slender legs)." },
  { id: "height", name: "Height", description: "Height and body size (e.g. tall, very tall, short, petite)." },
  { id: "skin", name: "Skin color", description: "Skin tone and skin features (e.g. pale skin, tan, dark skin, colored skin, scales)." },
  { id: "clothes", name: "Clothes", description: "What the character is currently wearing, including accessories and footwear (e.g. white shirt, black jacket, jeans, boots, necklace)." },
];

const defaultSettings = {
  prefix: "solo",
  suffix: "",
  replaceUnderscores: true,
  confirmBeforeGenerate: false,
  reviewAutofill: true,
  categories: [],
};

function makeDefaultCategories() {
  return DEFAULT_CATEGORIES.map((c) => ({ ...c, tags: "", enabled: true, builtin: true }));
}

function settings() {
  return extension_settings[extensionName];
}

function loadSettings() {
  extension_settings[extensionName] = extension_settings[extensionName] || {};
  const s = extension_settings[extensionName];
  for (const [key, value] of Object.entries(defaultSettings)) {
    if (s[key] === undefined) s[key] = structuredClone(value);
  }
  if (!Array.isArray(s.categories) || s.categories.length === 0) {
    s.categories = makeDefaultCategories();
  }

  $("#tagdesc_prefix").val(s.prefix);
  $("#tagdesc_suffix").val(s.suffix);
  $("#tagdesc_underscores").prop("checked", s.replaceUnderscores);
  $("#tagdesc_confirm").prop("checked", s.confirmBeforeGenerate);
  $("#tagdesc_review").prop("checked", s.reviewAutofill);
}

// ---------------------------------------------------------------------------
// Tag text handling
// ---------------------------------------------------------------------------

// Cleans a tag string: one line, comma separated, emphasis capped at MAX_EMPHASIS.
export function normalizeTags(text) {
  let out = String(text ?? "")
    .replace(/[\r\n]+/g, ", ")
    // Cap N::tag:: weights.
    .replace(/(\d+(?:\.\d+)?)::/g, (match, num) => {
      const value = Number(num);
      return value > MAX_EMPHASIS ? `${MAX_EMPHASIS}::` : match;
    })
    // Cap {{{{tag}}}} brace depth.
    .replace(/\{{5,}/g, "{".repeat(MAX_EMPHASIS))
    .replace(/\}{5,}/g, "}".repeat(MAX_EMPHASIS));

  return out
    .split(",")
    .map((t) => t.trim().replace(/\s+/g, " "))
    .filter((t) => t.length > 0)
    .join(", ");
}

function categoryTags(category) {
  return normalizeTags(category.tags);
}

export function buildPrompt() {
  const s = settings();
  const parts = [s.prefix, ...s.categories.filter((c) => c.enabled).map(categoryTags), s.suffix]
    .map((p) => normalizeTags(p))
    .filter((p) => p.length > 0);
  let prompt = parts.join(", ");
  if (s.replaceUnderscores) {
    prompt = prompt.replace(/_/g, " ");
  }
  return prompt;
}

// Pulls the first JSON object out of an LLM reply.
function parseJsonReply(reply) {
  const text = String(reply ?? "").replace(/```(?:json)?/gi, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function userName() {
  return getContext().name1 || "the user";
}

// ---------------------------------------------------------------------------
// Image generation
// ---------------------------------------------------------------------------

async function onGenerateImage() {
  const { Popup, POPUP_TYPE, SlashCommandParser } = getContext();
  let prompt = buildPrompt();

  if (!prompt) {
    toastr.warning("All enabled tag categories are empty. Fill them in or use auto-fill first.", "Tag Description Generator");
    return;
  }

  if (settings().confirmBeforeGenerate) {
    const edited = await new Popup("<h3>Image prompt</h3>", POPUP_TYPE.INPUT, prompt, {
      rows: 6,
      wide: true,
      okButton: "Generate",
      cancelButton: "Cancel",
    }).show();
    if (typeof edited !== "string" || !edited.trim()) return;
    prompt = edited.trim();
  }

  // Call the Image Generation extension's command directly rather than through
  // the slash command parser, so {{tag}} emphasis and "::" aren't parsed as script.
  const imagine = SlashCommandParser?.commands?.["imagine"];
  if (!imagine) {
    await copyToClipboard(prompt);
    toastr.warning("The Image Generation extension isn't available. The prompt was copied to your clipboard instead.", "Tag Description Generator");
    return;
  }

  try {
    await imagine.callback({}, prompt);
  } catch (error) {
    console.error("[Tag Description Generator] Image generation failed", error);
    toastr.error("Image generation failed. See the browser console for details.", "Tag Description Generator");
  }
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    console.warn("[Tag Description Generator] Could not copy to clipboard", error);
  }
}

// ---------------------------------------------------------------------------
// AI auto-fill from the story
// ---------------------------------------------------------------------------

const TAG_RULES = `Rules for tags:
- Output ONLY Danbooru tags: lowercase, comma-separated. No sentences, no explanations, no names.
- To emphasize an important trait, wrap the tag in double braces like {{tag}}, or use the weight format N::tag:: where N is a number from 1 to ${MAX_EMPHASIS}. Never exceed ${MAX_EMPHASIS}. Only emphasize defining traits.`;

function buildAutofillPrompt(categories) {
  const lines = categories.map((c) => {
    const current = categoryTags(c);
    return `- "${c.id}" (${c.name}): ${c.description}\n  Current tags: ${current || "(none)"}`;
  });
  const example = Object.fromEntries(categories.slice(0, 2).map((c) => [c.id, "tag, tag, tag"]));

  return `[OOC: Pause the roleplay. You are now a Danbooru tagging assistant.
Based on everything known so far in the story, describe the physical appearance of {{user}} (the player character) using Danbooru tags, split into the categories below.
Reflect the CURRENT state of {{user}} in the story (current clothes, current expression, etc.). If the story says nothing new about a category, keep its current tags. If nothing is known and there are no current tags, use an empty string.

${TAG_RULES}

Categories:
${lines.join("\n")}

Respond with ONLY a JSON object that maps each category key to a string of tags, for example:
${JSON.stringify(example)}]`;
}

async function onAutofill() {
  const s = settings();
  const categories = s.categories.filter((c) => c.enabled);
  if (categories.length === 0) {
    toastr.warning("No tag categories are enabled.", "Tag Description Generator");
    return;
  }

  const { generateQuietPrompt } = getContext();
  const toast = toastr.info("Reading the story and generating tags...", "Tag Description Generator", { timeOut: 0, extendedTimeOut: 0 });

  let reply;
  try {
    reply = await generateQuietPrompt({ quietPrompt: buildAutofillPrompt(categories) });
  } catch (error) {
    console.error("[Tag Description Generator] Auto-fill failed", error);
    toastr.error("Tag generation failed. See the browser console for details.", "Tag Description Generator");
    return;
  } finally {
    toastr.clear(toast);
  }

  if (!String(reply ?? "").trim()) {
    toastr.error("The AI returned an empty reply. Check that you're connected to an API.", "Tag Description Generator");
    return;
  }

  const parsed = parseJsonReply(reply);
  if (!parsed || typeof parsed !== "object") {
    console.warn("[Tag Description Generator] Unparseable auto-fill reply:", reply);
    toastr.error("The AI reply wasn't valid JSON. Try again, or use a stronger model.", "Tag Description Generator");
    return;
  }

  // Only accept keys for enabled categories, and never blank out existing tags.
  const changes = [];
  for (const category of categories) {
    const raw = parsed[category.id] ?? parsed[category.name];
    if (raw === undefined || raw === null) continue;
    const value = normalizeTags(Array.isArray(raw) ? raw.join(", ") : raw);
    if (!value || value === categoryTags(category)) continue;
    changes.push({ category, value });
  }

  if (changes.length === 0) {
    toastr.info("The AI didn't suggest any changes.", "Tag Description Generator");
    return;
  }

  const accepted = s.reviewAutofill ? await reviewChanges(changes) : changes;
  if (!accepted || accepted.length === 0) return;

  for (const { category, value } of accepted) {
    category.tags = value;
  }
  saveSettingsDebounced();
  refreshLists();
  toastr.success(`Updated ${accepted.length} tag categor${accepted.length === 1 ? "y" : "ies"}.`, "Tag Description Generator");
}

// Lets the user pick which suggested changes to apply.
async function reviewChanges(changes) {
  const { Popup, POPUP_TYPE, POPUP_RESULT } = getContext();
  const $content = $('<div class="tagdesc-review"></div>');
  $content.append("<h3>Review suggested tags</h3>");

  const rows = changes.map((change) => {
    const $row = $('<div class="tagdesc-review-row"></div>');
    const $label = $('<label class="checkbox_label"></label>');
    const $check = $('<input type="checkbox" checked />');
    $label.append($check, $("<b></b>").text(change.category.name));
    const $old = $('<div class="tagdesc-review-old"></div>').text(categoryTags(change.category) || "(empty)");
    const $new = $('<textarea class="text_pole textarea_compact" rows="2"></textarea>').val(change.value);
    $row.append($label, $old, $new);
    $content.append($row);
    return { change, $check, $new };
  });

  const result = await new Popup($content, POPUP_TYPE.CONFIRM, "", {
    okButton: "Apply",
    cancelButton: "Cancel",
    wide: true,
    allowVerticalScrolling: true,
  }).show();
  if (result !== POPUP_RESULT.AFFIRMATIVE) return null;

  return rows
    .filter((r) => r.$check.prop("checked"))
    .map((r) => ({ category: r.change.category, value: normalizeTags(r.$new.val()) }));
}

// ---------------------------------------------------------------------------
// Category list (used by both the settings panel and the tag manager popup)
// ---------------------------------------------------------------------------

// Each mounted list: { $container, mode: "compact" | "full" }.
const mountedLists = [];

function mountList($container, mode) {
  mountedLists.push({ $container, mode });
  renderList($container, mode);
}

function refreshLists() {
  for (let i = mountedLists.length - 1; i >= 0; i--) {
    const { $container, mode } = mountedLists[i];
    if (!document.body.contains($container.get(0))) {
      mountedLists.splice(i, 1);
      continue;
    }
    renderList($container, mode);
  }
  $(".tagdesc-prompt-preview").text(buildPrompt() || "(empty)");
}

function renderList($container, mode) {
  const s = settings();
  $container.empty();

  s.categories.forEach((category, index) => {
    const $row = $('<div class="tagdesc-row"></div>').toggleClass("tagdesc-disabled", !category.enabled);
    const $header = $('<div class="tagdesc-row-header"></div>');

    const $toggle = $('<input type="checkbox" title="Enable or disable this category" />')
      .prop("checked", category.enabled)
      .on("input", () => {
        category.enabled = $toggle.prop("checked");
        saveSettingsDebounced();
        refreshLists();
      });

    const $name = $('<span class="tagdesc-row-name"></span>').text(category.name);

    const $actions = $('<div class="tagdesc-row-actions"></div>');
    const $up = $('<i class="fa-solid fa-arrow-up menu_button" title="Move up"></i>')
      .toggleClass("disabled", index === 0)
      .on("click", () => moveCategory(index, -1));
    const $down = $('<i class="fa-solid fa-arrow-down menu_button" title="Move down"></i>')
      .toggleClass("disabled", index === s.categories.length - 1)
      .on("click", () => moveCategory(index, 1));
    const $edit = $('<i class="fa-solid fa-pencil menu_button" title="Edit category"></i>')
      .on("click", () => editCategory(category));
    const $delete = $('<i class="fa-solid fa-trash-can menu_button redWarningBG" title="Delete category"></i>')
      .on("click", () => deleteCategory(category));
    $actions.append($up, $down, $edit, $delete);

    $header.append($toggle, $name, $actions);
    $row.append($header);

    if (mode === "full") {
      const $tags = $('<textarea class="text_pole textarea_compact tagdesc-tags" rows="2" placeholder="No tags yet"></textarea>')
        .val(category.tags)
        .on("input", () => {
          category.tags = $tags.val();
          saveSettingsDebounced();
          $(".tagdesc-prompt-preview").text(buildPrompt() || "(empty)");
        })
        .on("change", () => {
          category.tags = normalizeTags($tags.val());
          $tags.val(category.tags);
          saveSettingsDebounced();
          refreshLists();
        });
      $row.append($tags);
    } else {
      const preview = categoryTags(category);
      $row.append($('<small class="tagdesc-row-preview"></small>').text(preview || "No tags yet"));
    }

    $container.append($row);
  });
}

function moveCategory(index, delta) {
  const list = settings().categories;
  const target = index + delta;
  if (target < 0 || target >= list.length) return;
  [list[index], list[target]] = [list[target], list[index]];
  saveSettingsDebounced();
  refreshLists();
}

async function deleteCategory(category) {
  const { Popup, POPUP_TYPE, POPUP_RESULT } = getContext();
  const $msg = $("<div></div>").append($("<h3></h3>").text(`Delete "${category.name}"?`));
  if (category.builtin) {
    $msg.append("<p>This is a default category. You can also just disable it. Reset to defaults brings it back.</p>");
  }
  const result = await new Popup($msg, POPUP_TYPE.CONFIRM, "", { okButton: "Delete", cancelButton: "Cancel" }).show();
  if (result !== POPUP_RESULT.AFFIRMATIVE) return;

  const list = settings().categories;
  const index = list.indexOf(category);
  if (index !== -1) list.splice(index, 1);
  saveSettingsDebounced();
  refreshLists();
}

async function resetCategories() {
  const { Popup, POPUP_TYPE, POPUP_RESULT } = getContext();
  const result = await new Popup(
    "<h3>Reset tag categories?</h3><p>This removes custom categories and clears all tags.</p>",
    POPUP_TYPE.CONFIRM, "", { okButton: "Reset", cancelButton: "Cancel" },
  ).show();
  if (result !== POPUP_RESULT.AFFIRMATIVE) return;

  settings().categories = makeDefaultCategories();
  saveSettingsDebounced();
  refreshLists();
}

// ---------------------------------------------------------------------------
// Category editor (edit existing / add new, manually or with AI help)
// ---------------------------------------------------------------------------

function uniqueCategoryId(name) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "category";
  const ids = new Set(settings().categories.map((c) => c.id));
  let id = base;
  for (let n = 2; ids.has(id); n++) id = `${base}_${n}`;
  return id;
}

// Asks the AI to turn a short idea into a category name + description.
async function generateCategoryDefinition(idea) {
  const { generateRaw } = getContext();
  const reply = await generateRaw({
    systemPrompt: "You design categories for describing a character's appearance with Danbooru tags. Reply with JSON only.",
    prompt: `Create one tag category from this idea: "${idea}"

Respond with ONLY a JSON object like:
{"name": "Short Title", "description": "One or two sentences saying which Danbooru tags belong in this category, with a few example tags in parentheses."}`,
  });
  const parsed = parseJsonReply(reply);
  if (!parsed?.name) throw new Error(`Unparseable reply: ${reply}`);
  return { name: String(parsed.name).trim(), description: String(parsed.description ?? "").trim() };
}

// Asks the AI for tags for a single category, based on the story.
async function generateCategoryTags(name, description) {
  const { generateQuietPrompt } = getContext();
  const reply = await generateQuietPrompt({
    quietPrompt: `[OOC: Pause the roleplay. You are now a Danbooru tagging assistant.
Based on the story so far, list Danbooru tags describing {{user}} (the player character) for this category:
${name}: ${description}

${TAG_RULES}

Respond with ONLY the tags on a single line. If nothing is known, respond with nothing.]`,
  });
  // Drop anything after the first line in case the model added commentary.
  return normalizeTags(String(reply ?? "").split(/\r?\n/).find((l) => l.trim()) ?? "");
}

// Opens the editor. Pass a category to edit it, or nothing to create a new one.
async function editCategory(category = null) {
  const { Popup, POPUP_TYPE, POPUP_RESULT } = getContext();
  const isNew = !category;

  const $content = $('<div class="tagdesc-editor"></div>');
  $content.append($("<h3></h3>").text(isNew ? "Add tag category" : `Edit "${category.name}"`));

  if (isNew) {
    const $ai = $('<div class="tagdesc-editor-ai"></div>');
    $ai.append("<label>Describe the category for the AI (optional)</label>");
    const $idea = $('<textarea class="text_pole textarea_compact" rows="2" placeholder="e.g. tattoos and piercings, and where they are on the body"></textarea>');
    const $fillTags = $('<label class="checkbox_label"><input type="checkbox" checked /><span>Also fill in tags from the story</span></label>');
    const $aiButton = $('<div class="menu_button menu_button_icon"><i class="fa-solid fa-wand-magic-sparkles"></i><span>Generate with AI</span></div>');
    $ai.append($idea, $fillTags, $aiButton);
    $content.append($ai, '<hr class="sysHR" />');

    $aiButton.on("click", async () => {
      const idea = String($idea.val()).trim();
      if (!idea) {
        toastr.warning("Describe the category first.", "Tag Description Generator");
        return;
      }
      $aiButton.addClass("disabled");
      try {
        const def = await generateCategoryDefinition(idea);
        $nameInput.val(def.name);
        $descInput.val(def.description);
        if ($fillTags.find("input").prop("checked")) {
          $tagsInput.val(await generateCategoryTags(def.name, def.description));
        }
      } catch (error) {
        console.error("[Tag Description Generator] Category generation failed", error);
        toastr.error("Couldn't generate the category. See the browser console for details.", "Tag Description Generator");
      } finally {
        $aiButton.removeClass("disabled");
      }
    });
  }

  const $nameInput = $('<input class="text_pole" type="text" />').val(category?.name ?? "");
  const $descInput = $('<textarea class="text_pole textarea_compact" rows="3"></textarea>').val(category?.description ?? "");
  const $tagsInput = $('<textarea class="text_pole textarea_compact" rows="3" placeholder="tag, {{important tag}}, 2::weighted tag::"></textarea>').val(category?.tags ?? "");

  $content.append(
    "<label>Name</label>", $nameInput,
    "<label>Description</label>", $descInput,
    "<label>Tags</label>", $tagsInput,
    $(`<small>Emphasis: {{tag}} or N::tag:: with N up to ${MAX_EMPHASIS}.</small>`),
  );

  const result = await new Popup($content, POPUP_TYPE.CONFIRM, "", {
    okButton: isNew ? "Add" : "Save",
    cancelButton: "Cancel",
    wide: true,
    allowVerticalScrolling: true,
  }).show();
  if (result !== POPUP_RESULT.AFFIRMATIVE) return;

  const name = String($nameInput.val()).trim();
  if (!name) {
    toastr.warning("A category needs a name.", "Tag Description Generator");
    return;
  }

  const values = {
    name,
    description: String($descInput.val()).trim(),
    tags: normalizeTags($tagsInput.val()),
  };

  if (isNew) {
    settings().categories.push({ id: uniqueCategoryId(name), enabled: true, builtin: false, ...values });
  } else {
    Object.assign(category, values);
  }
  saveSettingsDebounced();
  refreshLists();
}

// ---------------------------------------------------------------------------
// Tag manager popup
// ---------------------------------------------------------------------------

async function openTagManager() {
  const { Popup, POPUP_TYPE } = getContext();
  const $content = $('<div class="tagdesc-manager"></div>');
  $content.append($("<h3></h3>").text(`Tags for ${userName()}`));

  const $list = $('<div class="tagdesc-list"></div>');
  const $buttons = $('<div class="flex-container"></div>');
  const $add = $('<div class="menu_button menu_button_icon"><i class="fa-solid fa-plus"></i><span>Add category</span></div>')
    .on("click", () => editCategory());
  const $autofill = $('<div class="menu_button menu_button_icon"><i class="fa-solid fa-wand-magic-sparkles"></i><span>Auto-fill from story</span></div>')
    .on("click", () => onAutofill());
  $buttons.append($add, $autofill);

  const $preview = $('<div class="tagdesc-prompt-preview"></div>').text(buildPrompt() || "(empty)");

  $content.append($list, $buttons, "<label>Final prompt</label>", $preview);

  const popup = new Popup($content, POPUP_TYPE.TEXT, "", {
    okButton: "Close",
    wide: true,
    large: true,
    allowVerticalScrolling: true,
  });
  const shown = popup.show();
  mountList($list, "full");
  await shown;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function addWandButtons() {
  const $container = $('<div id="tagdesc_wand_container" class="extension_container"></div>');
  const item = (id, icon, label) => $(`
    <div id="${id}" class="list-group-item flex-container flexGap5">
      <div class="fa-solid ${icon} extensionsMenuExtensionButton"></div>
      <span>${label}</span>
    </div>`);

  const $generate = item("tagdesc_wand_generate", "fa-user-pen", "Generate Character Image");
  const $autofill = item("tagdesc_wand_autofill", "fa-wand-magic-sparkles", "Auto-fill Character Tags");
  const $manager = item("tagdesc_wand_manager", "fa-tags", "Character Tag Manager");

  $generate.on("click", () => onGenerateImage());
  $autofill.on("click", () => onAutofill());
  $manager.on("click", () => openTagManager());

  $container.append($generate, $autofill, $manager);
  $("#extensionsMenu").append($container);
}

jQuery(async () => {
  const settingsHtml = await $.get(settingsHtmlUrl);
  $("#extensions_settings").append(settingsHtml);

  loadSettings();

  $("#tagdesc_prefix").on("input", function () {
    settings().prefix = String($(this).val());
    saveSettingsDebounced();
    refreshLists();
  });
  $("#tagdesc_suffix").on("input", function () {
    settings().suffix = String($(this).val());
    saveSettingsDebounced();
    refreshLists();
  });
  $("#tagdesc_underscores").on("input", function () {
    settings().replaceUnderscores = $(this).prop("checked");
    saveSettingsDebounced();
    refreshLists();
  });
  $("#tagdesc_confirm").on("input", function () {
    settings().confirmBeforeGenerate = $(this).prop("checked");
    saveSettingsDebounced();
  });
  $("#tagdesc_review").on("input", function () {
    settings().reviewAutofill = $(this).prop("checked");
    saveSettingsDebounced();
  });

  $("#tagdesc_add_category").on("click", () => editCategory());
  $("#tagdesc_open_manager").on("click", () => openTagManager());
  $("#tagdesc_reset").on("click", () => resetCategories());

  mountList($("#tagdesc_settings_list"), "compact");
  addWandButtons();
});
