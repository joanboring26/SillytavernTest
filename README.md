# Tag Description Generator

A SillyTavern extension that keeps a Danbooru-tag description of your character (the user / persona), split into body-part categories, and turns it into an image generation prompt.

## Features

- **Tag categories**: Head, Eyes, Hair, Expression, Chest, Abs, Arms, Muscles, Legs, Height, Skin color and Clothes. Each has a short description that is shown when you edit the category.
- **Enable / disable** any category. Only enabled categories go into the final prompt and get auto-filled.
- **Custom categories**: add your own, either by typing the name, description and tags yourself, or by giving the AI a short idea and letting it write the name and description (and optionally fill in tags from the story).
- **Emphasis**: `{{tag}}` or `N::tag::`, with emphasis capped at 4 (`{{{{tag}}}}` / `4::tag::`). Higher values are clamped automatically.
- **Wand menu buttons**:
  - **Generate Character Image**: merges the enabled categories (plus your prefix and suffix) into one prompt and sends it to SillyTavern's Image Generation extension.
  - **Auto-fill Character Tags**: asks your connected LLM to read the story and output tags (only tags) for every enabled category. By default you review the suggestions before they are applied.
  - **Character Tag Manager**: opens the tag manager, where you edit tags, toggle and reorder categories, and see the final prompt.
- **Settings panel** (Extensions → Tag Description Generator): prompt prefix and suffix, underscore replacement, confirm-before-generate, review-before-apply, and the category list.

## Installation and Usage

### Installation

In SillyTavern, open **Extensions → Install extension** and paste this repository's URL.

### Usage

1. Open the wand menu (the magic wand next to the chat input) and click **Character Tag Manager**, or use the settings panel.
2. Fill in tags yourself, or click **Auto-fill Character Tags** to have the AI do it from the current story.
3. Click **Generate Character Image**.

The final prompt is: `prefix, <enabled categories in order>, suffix`.

## Prerequisites

- A recent SillyTavern release (uses `getContext()`'s `Popup`, `generateQuietPrompt` and `generateRaw`).
- The built-in **Image Generation** extension, configured with a working source, for the generate button. Without it, the prompt is copied to your clipboard instead.
- `{{tag}}` emphasis is NovelAI-style syntax and `N::tag::` is NovelAI V4 weighting. Other backends may treat them differently.

## Notes

- Tags are stored globally in the extension settings, not per chat or per persona.
- Avoid tags whose name matches a SillyTavern macro (e.g. `{{user}}`, `{{random}}`) inside double braces, since the Image Generation extension runs macro substitution on the prompt.

## License

MIT
