# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Better xCloud is a Tampermonkey/Greasemonkey userscript that enhances Xbox Cloud Gaming (xCloud) on xbox.com/play. It also enables Remote Play on the xCloud website. The output is a single `.user.js` file.

## Build Commands

```bash
# Install dependencies (uses Bun, not npm/yarn)
bun install

# Build (version is required)
bun build.ts --version <VERSION> --variant full --pretty

# Build for production (minified)
bun build.ts --version <VERSION> --variant full

# Build meta file (for userscript update checking)
bun build.ts --version <VERSION> --variant full --meta

# Continuous rebuild loop (prompts to rebuild on Enter)
./build.sh <VERSION>
```

Build outputs go to `dist/`. There are no test or lint commands to run separately — ESLint (browser compatibility checks via `eslint-plugin-compat`) runs automatically as part of the build.

## Architecture

### Build System

Bun is both the runtime and bundler. The custom `build.ts` handles:
1. **Patch compilation** — TypeScript files in `src/modules/patcher/patches/src/` are individually bundled to JS
2. **Main bundle** — `src/index.ts` is bundled with build-time defines (`BUILD_TARGET`, `BUILD_VARIANT`, `SCRIPT_VERSION`)
3. **Post-processing** — SVG minification, code import minification, comment removal, unicode unescaping, object syntax simplification
4. **Header injection** — Tampermonkey metadata from `src/assets/header_script.txt` is prepended

Build-time macros in `src/macros/build.ts` (imported with `{ type: "macro" }`) run at compile time, notably `compressCss()` which compiles Stylus to minified CSS, and `isFullVersion()` which enables tree-shaking between `full` and `lite` variants.

### Path Aliases

Defined in `tsconfig.json`, used throughout the codebase:
- `@/*` → `src/*`
- `@assets/*`, `@enums/*`, `@macros/*`, `@modules/*`, `@utils/*` → respective `src/` subdirectories

### Core Patterns

**Singletons** — Most managers/handlers use `getInstance()` (e.g., `SettingsManager`, `GameBar`, `MouseCursorHider`).

**Event Bus** — Two typed event buses decouple modules:
- `BxEventBus.Script` — UI lifecycle events (`ui.header.rendered`, `titleInfo.ready`)
- `BxEventBus.Stream` — Stream state events (`state.loading`, `state.playing`, `state.stopped`)

**Preferences** — Type-safe getters `getGlobalPref(GlobalPref.*)` and `getStreamPref(StreamPref.*)`. Preference keys are in `src/enums/pref-keys.ts`, values in `src/enums/pref-values.ts`.

**Patcher** — The core mechanism for modifying xCloud's website JavaScript. `src/modules/patcher/patcher.ts` defines 50+ patches that target specific strings/functions in the site's minified code. Patches in `src/modules/patcher/patches/src/` are compiled separately and injected as string templates.

**Player Hierarchy** — Video rendering uses a class hierarchy:
- `BaseStreamPlayer` → `VideoPlayer` (HTML5 video)
- `BaseStreamPlayer` → `BaseCanvasPlayer` → `WebGL2Player` / `WebGPUPlayer`

**Input Handlers** — `BaseMkbHandler` → `EmulatedMkbHandler` (touch emulation) / `NativeMkbHandler` (desktop).

### Initialization Flow

`src/index.ts` → SettingsManager init → page URL validation (`/play` path required) → monkey patches (WebRTC, Canvas, Audio, Video APIs) → CSS injection → Patcher init → event listener registration → feature modules activate based on preferences and stream state events.

### Web Components

Custom elements in `src/web-components/` (`BxSelect`, `BxNumberStepper`, etc.) are used in the settings UI.

## Key Conventions

- TypeScript strict mode is enabled
- Target is Chrome 80+ (checked by `eslint-plugin-compat` during build)
- No test framework — testing is manual
- Translations use `t('key')` from `@utils/translation`
- DOM creation uses `CE()` helper from `@utils/html`
- `STATES` global (from `@utils/global`) holds runtime state like `currentStream`, `isPlaying`
- `BX_FLAGS` holds feature flags
- `AppInterface` is non-null when running inside the Android companion app
