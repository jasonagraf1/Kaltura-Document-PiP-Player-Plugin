# playkit-js-document-pip

A Kaltura Player **V7 (Playkit)** plugin that replaces the player's native
Picture-in-Picture action with **Document Picture-in-Picture**. Native PiP hands only the
video's pixel buffer to the OS mini-player, so HTML overlay plugins — including a **dynamic
watermark** — are dropped. Document PiP opens a real, always-on-top browser window that
hosts an HTML document, so this plugin moves the **entire player view** (video + control bar
+ every overlay plugin) into it. The watermark rides along and keeps updating, and the window
stays on top when the user switches tabs or apps.

This is written to be enabled at the **uiConf / studio level** so every embed of the player
gets it automatically, with the native PiP button replaced in place.

---

## What's in here

- `src/document-pip.js` — the plugin source (registers as `documentPip`).
- `webpack.config.js` — builds a single UMD bundle; `KalturaPlayer` is external.
- `package.json` — build scripts and dev dependencies.

---

## 1. Build the bundle

```bash
cd playkit-js-document-pip
npm install
npm run build
```

Output: `dist/playkit-document-pip.js`. This is the file you host.

> The bundle deliberately does **not** include the player core — it references the global
> `KalturaPlayer` that the player provides at runtime.

## 2. Host the bundle

Upload `dist/playkit-document-pip.js` to any HTTPS location the player pages can reach
(your CDN, the customer's static host, etc.). Note the full URL, e.g.
`https://your-cdn.example.com/playkit/playkit-document-pip.js`.

## 3. Register it on player (uiConf-level, applies to all embeds)

There are two ways to make the plugin globally active on the player. Both live in the player
studio (Rich Media CMS / KMC → Studio → your player).

### Option A — Studio UI (if your studio build exposes a custom-plugin field)

In the player's advanced/plugin settings, add:

- **Plugin bundle URL:** the hosted `playkit-document-pip.js` from step 2.
- **Plugin config** (JSON), enabling `documentPip`:

```json
{
  "plugins": {
    "documentPip": {
      "replaceNativePipButton": true,
      "width": 400
    }
  }
}
```

Save and publish the player. Every embed of `51878742` now loads the plugin.

### Option B — uiConf JSON (via the uiConf/admin API)

If you edit the player's uiConf config directly, merge the plugin into the player's config
object. The player loads external plugin bundles listed under `productVersions` /
`plugins`, then applies the `plugins` config:

```jsonc
{
  // ...existing player config...
  "plugins": {
    "documentPip": {
      "replaceNativePipButton": true,
      "width": 400
    }
  },
  // Tell the player where to fetch the plugin bundle from:
  "productVersions": {
    "documentPip": {
      "url": "https://your-cdn.example.com/playkit/playkit-document-pip.js"
    }
  }
}
```

Exact key names for the external-bundle loader can vary by player build. If your build
loads bundles by script tag on the page instead, use Option C.

### Option C — page-level script tag (fastest to verify on real embeds)

If you can edit the embedding pages, load the bundle right after the player bundle and
before `KalturaPlayer.setup`, then enable it in setup config:

```html
<script src="https://cdnapisec.kaltura.com/p/4716502/embedPlaykitJs/uiconf_id/51878742"></script>
<script src="https://your-cdn.example.com/playkit/playkit-document-pip.js"></script>
<script>
  const kp = KalturaPlayer.setup({
    targetId: 'player-container',
    provider: { partnerId: 4716502, uiConfId: 51878742, ks: '<YOUR_KS>' },
    plugins: { documentPip: { replaceNativePipButton: true, width: 400 } }
  });
  kp.loadMedia({ entryId: '1_o02vc114' });
</script>
```

This isn't "baked into the uiConf," but it proves the exact plugin end-to-end on a real
embed before you commit it to studio. Recommended as your first test.

---

## Configuration options

| Option                  | Default | Meaning                                                                 |
|-------------------------|---------|-------------------------------------------------------------------------|
| `replaceNativePipButton`| `true`  | Hide the built-in PiP control and route the PiP intent through Document PiP. |
| `width`                 | `400`   | Initial PiP window width (px). Height defaults to 16:9 of width.        |
| `height`                | `0`     | Initial PiP window height (px). `0` = derive from width.                |
| `disableResizeInPip`    | `false` | Skip the relayout nudge after moving (set true if your layout misbehaves). |

---

## How it works (for review)

1. `isValid()` returns false where `documentPictureInPicture` is absent, so on non-Chromium
   browsers the plugin stays inert and native PiP is untouched.
2. On `loadMedia`, it disables the native PiP UI and injects its own control in the
   bottom-right of the control bar (same spot as the old button).
3. On click it calls `documentPictureInPicture.requestWindow()`, copies the page's
   stylesheets into the new document, leaves a placeholder, and `appendChild`s the player's
   root view (`player.getView()`) into the PiP window.
4. On the window's `pagehide`, it moves the player back to the placeholder and relayouts.

---

## Notes for your watermark scenario

- **Nothing about the watermark plugin changes.** Because the same player DOM is reparented
  (not re-instantiated), the watermark plugin keeps its state, session context, and refresh
  timer. Confirm on your player that the watermark still shows the correct per-user value
  after entering PiP — that's the acceptance test that matters.
- **KS lifetime:** the session used to load media expires normally; the PiP move doesn't
  extend or affect it. Long PiP sessions are bounded by your KS/DRM license as usual.
- **Chromium only:** Document PiP is Chrome/Edge. You confirmed the customer only needs
  Chrome. On other browsers users simply get native PiP (or no PiP) — no errors.
- **One window, user gesture:** Document PiP allows a single window and requires a click,
  both satisfied by the control-bar button.

## Browser support

Chromium (Chrome/Edge) 116+. Not supported in Safari or Firefox as of this writing —
verify current support before rollout if that ever changes.
