// playkit-js-document-pip (v1.3.0)
// Routes the Kaltura Player V7 (Playkit) Picture-in-Picture action to Document PiP so overlay
// plugins (e.g. the dynamic watermark) are preserved in the floating window.
//
// v1.1 approach: rather than adding/removing control-bar buttons (which varies across player
// builds), intercept requestPictureInPicture() on the video element. The player's existing PiP
// button then opens a Document PiP window automatically.

const { core } = KalturaPlayer;
const { BasePlugin } = core;

const LOG = '[documentPip]';
const clog = (...args) => { try { console.log(LOG, ...args); } catch (e) {} };

const DEFAULT_CONFIG = {
  width: 400,
  height: 0,
  disableResizeInPip: false
};

class DocumentPip extends BasePlugin {
  static get defaultConfig() { return DEFAULT_CONFIG; }

  static isValid() {
    const ok = typeof window !== 'undefined' && 'documentPictureInPicture' in window;
    if (!ok) clog('Document PiP NOT supported in this browser — plugin inert.');
    return ok;
  }

  constructor(name, player, config) {
    super(name, player, config);
    this._pipWindow = null;
    this._placeholder = null;
    this._playerRoot = null;
    this._onWindowUnload = this._onWindowUnload.bind(this);
    clog('plugin instance created');
  }

  loadMedia() {
    clog('loadMedia fired');
    this._playerRoot = this._resolvePlayerRoot();
    clog('resolved player root:', this._playerRoot);
    this._hijackNativePip();
    try {
      this.player.addEventListener(this.player.Event.FIRST_PLAY, () => {
        clog('first play — re-checking hijack');
        this._playerRoot = this._resolvePlayerRoot();
        this._hijackNativePip();
      });
    } catch (e) { /* Event name may differ; ignore */ }
  }

  // Resolve the FULL player wrapper (.playkit-player), not the inner video-only container.
  // In Kaltura Player V7, getView() returns .playkit-container, which holds only the <video>
  // engine — the control bar AND overlay plugins (e.g. the watermark) render in the
  // .playkit-player wrapper one level up. We must move that wrapper so the controls and
  // watermark travel into the PiP window with the video.
  _resolvePlayerRoot() {
    // 1) From the video, climb to the outermost .playkit-player wrapper (most reliable).
    const video = this._getVideo();
    if (video && video.closest) {
      const wrapper = video.closest('.playkit-player');
      if (wrapper) {
        let outer = wrapper;
        let p = wrapper.parentElement;
        while (p) {
          if (p.classList && p.classList.contains('playkit-player')) outer = p;
          p = p.parentElement;
        }
        return outer;
      }
    }
    // 2) Fall back to getView(), climbing out of the inner container if needed.
    if (typeof this.player.getView === 'function') {
      const view = this.player.getView();
      if (view) {
        if (view.closest) {
          const w2 = view.closest('.playkit-player');
          if (w2) return w2;
        }
        if (view.classList && view.classList.contains('playkit-container') && view.parentElement) {
          return view.parentElement;
        }
        return view;
      }
    }
    // 3) Last resort: the video's parent.
    if (video) return video.parentElement;
    return null;
  }

  _getVideo() {
    let v = null;
    try { v = this.player.getVideoElement && this.player.getVideoElement(); } catch (e) {}
    if (v) return v;
    const root = this._playerRoot || document;
    return root.querySelector ? root.querySelector('video') : null;
  }

  // Replace requestPictureInPicture on the video element so the native PiP button
  // opens a Document PiP window instead.
  _hijackNativePip() {
    const video = this._getVideo();
    if (!video) { clog('no <video> element found yet to hijack'); return; }
    if (video.__docPipHijacked) { clog('video already hijacked'); return; }
    video.__docPipHijacked = true;
    clog('hijacking video.requestPictureInPicture on', video);
    video.requestPictureInPicture = () => {
      clog('intercepted requestPictureInPicture -> Document PiP');
      this._toggle();
      return Promise.resolve();
    };
  }

  _toggle() {
    if (this._pipWindow) { clog('toggle: closing existing PiP window'); this._pipWindow.close(); return; }
    this._enterDocumentPip();
  }

  async _enterDocumentPip() {
    if (!DocumentPip.isValid()) return;
    const root = this._playerRoot || this._resolvePlayerRoot();
    if (!root) { clog('ERROR: could not resolve player root to move into PiP'); return; }

    const rect = root.getBoundingClientRect();
    const width = this.config.width || Math.round(rect.width) || 400;
    const height = this.config.height || Math.round(width * 9 / 16);
    clog('requesting PiP window', width + 'x' + height);

    let pipWindow;
    try {
      pipWindow = await window.documentPictureInPicture.requestWindow({ width, height });
    } catch (e) {
      clog('requestWindow failed (needs user gesture / one window at a time):', e);
      return;
    }
    this._pipWindow = pipWindow;
    this._copyStyles(pipWindow.document);

    // Neutral layout reset only — NO player-specific class names. Mirrors the validated
    // test page: the PiP body fills the window, and the moved element is sized to fill the
    // body so the player lays itself out for that size using its own responsive logic.
    const reset = pipWindow.document.createElement('style');
    reset.textContent = 'html,body{margin:0;padding:0;height:100%;background:#000;overflow:hidden;}';
    pipWindow.document.head.appendChild(reset);

    this._placeholder = document.createElement('div');
    this._placeholder.style.display = 'none';
    root.parentNode.insertBefore(this._placeholder, root);

    // Preserve the element's own inline size, then make it fill the PiP window.
    // This is the key step the working test page did (#player-shell{height:100%}).
    this._savedInlineCssText = root.style.cssText;
    root.style.width = '100%';
    root.style.height = '100%';

    pipWindow.document.body.appendChild(root);
    clog('moved player root into PiP window (100% x 100%) — watermark rides along');

    pipWindow.addEventListener('pagehide', this._onWindowUnload);
  }

  _onWindowUnload() {
    const root = this._playerRoot;
    if (this._placeholder && this._placeholder.parentNode && root) {
      this._placeholder.parentNode.insertBefore(root, this._placeholder);
      this._placeholder.remove();
      // Restore the element's original inline styles.
      if (typeof this._savedInlineCssText === 'string') {
        root.style.cssText = this._savedInlineCssText;
        this._savedInlineCssText = null;
      }
      clog('PiP closed — player restored to page');
    }
    this._placeholder = null;
    this._pipWindow = null;
  }

  _copyStyles(targetDoc) {
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach(node =>
      targetDoc.head.appendChild(node.cloneNode(true)));
    for (let i = 0; i < document.styleSheets.length; i++) {
      const sheet = document.styleSheets[i];
      try {
        const cssText = Array.prototype.map.call(sheet.cssRules, r => r.cssText).join('\n');
        const styleEl = targetDoc.createElement('style');
        styleEl.textContent = cssText;
        targetDoc.head.appendChild(styleEl);
      } catch (e) { /* cross-origin sheet — skip */ }
    }
  }

  reset() {
    if (this._pipWindow) { try { this._pipWindow.close(); } catch (e) {} }
    this._pipWindow = null;
    this._placeholder = null;
  }

  destroy() { this.reset(); }
}

KalturaPlayer.core.registerPlugin('documentPip', DocumentPip);
clog('registered plugin "documentPip" (v1.3.0)');

export default DocumentPip;
