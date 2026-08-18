// dsh-course-logic-extractor — host half
//
// The dsh agent-presets roster has no runtime API for plugins to register
// preset roots, and the launcher's final overlay pins the `agent-presets`
// row's roots to the shipped set — so a preset-shipping plugin cannot inject
// its own root through config. The supported seam is the user root:
// `$DSH_HOME/.agent-presets/<id>/`, which the roster always scans.
//
// This plugin therefore materializes its bundled preset directory into the
// user root at startup:
//   - missing          → copy from the bundle (fresh install / new machine)
//   - present, owned   → overwrite when the plugin version changed (update)
//   - present, unowned → leave untouched (the user authored their own copy)
// Ownership is a `.dsh-plugin` marker file carrying the installing version.
//
// Discovery is unmemoized, so the preset appears in the roster on the next
// read — no restart beyond the one that loaded this plugin.
import { cp, mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const VERSION = require("../package.json").version;

export const name = "dsh-course-logic-extractor";

const PRESET_ID = "course-logic-extractor";
const OWNER_MARKER = "dsh-course-logic-extractor";

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

function resolveHome(ctx) {
  if (process.env.DSH_HOME) return process.env.DSH_HOME;
  try {
    const fn = ctx.get("dshHomePath");
    if (typeof fn === "function") {
      const home = fn();
      if (home) return home;
    }
  } catch { /* fall through */ }
  return join(homedir(), ".dsh");
}

async function installPreset(bundled, target) {
  await mkdir(dirname(target), { recursive: true });
  const markerPath = join(target, ".dsh-plugin");
  let owned = false;
  let current = "";
  if (await exists(markerPath)) {
    try {
      const text = (await readFile(markerPath, "utf8")).trim();
      if (text.startsWith(OWNER_MARKER + "@")) {
        owned = true;
        current = text.slice(OWNER_MARKER.length + 1);
      }
    } catch { /* unreadable marker → treat as unowned */ }
  }

  const targetExists = await exists(target);
  if (!targetExists) {
    await cp(bundled, target, { recursive: true });
    await writeFile(markerPath, `${OWNER_MARKER}@${VERSION}`, "utf8");
    return;
  }
  if (owned && current !== VERSION) {
    await cp(bundled, target, { recursive: true, force: true });
    await writeFile(markerPath, `${OWNER_MARKER}@${VERSION}`, "utf8");
  }
  // unowned (user-authored) copies are never touched.
}

export function apply(ctx) {
  const here = dirname(fileURLToPath(import.meta.url));
  const bundled = join(here, "..", "preset", PRESET_ID);

  ctx.effect(async () => {
    try {
      const target = join(resolveHome(ctx), ".agent-presets", PRESET_ID);
      await installPreset(bundled, target);
      ctx.logger?.info?.("[dsh-course-logic-extractor] preset ready: %s", PRESET_ID);
    } catch (error) {
      ctx.logger?.warn?.("[dsh-course-logic-extractor] preset install failed: " + String(error?.message ?? error));
    }
  }, "dsh-course-logic-extractor: install preset");
}
