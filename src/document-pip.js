// playkit-js-document-pip
// A Kaltura Player V7 (Playkit) plugin that replaces the native Picture-in-Picture
// action with a Document Picture-in-Picture window. Because Document PiP hosts a real
// HTML document, the entire player DOM — video PLUS overlay plugins such as the dynamic
// watermark — is moved into the floating window and keeps rendering. Native PiP only
// carries the video's pixel buffer, which is why the watermark is lost there.
//
// Registered globally on a uiConf, this applies to every embed of that player.

const { core } = KalturaPlayer;
const { BasePlugin } = core;

/**
 * Default configuration. Override per-player via the plugin config in the uiConf
 * (or at setup time under plugins.documentPip).
 */
const DEFAULT_CONFIG = {
  // Replace the player's native PiP button so the existing icon triggers Document PiP.
  replaceNativePipButton: true,
  // Initial PiP window size. Height defaults to a 16:9 ratio of width when omitted.
  width: 400,
  height: 0,
  // Keep the player at native/original size while in PiP (recommended for watermark fidelity).
  disableResizeInPip: false
};

class DocumentPip extends BasePlugin {
  static get defaultConfig() {
    return DEFAULT_CONFIG;
  }

  /**
   * The plugin only makes sense where the browser supports the Document PiP API.
   * If unsupported, isValid() returns false and the player leaves native PiP untouched.
   */
  static isValid() {
    return typeof window !== 'undefined' && 'documentPictureInPicture' in window;
  }

  constructor(name, player, config) {
    super(name, player, config);
    this._pipWindow = null;
    this._placeholder = null;
    this._playerRoot = null;
    this._onWindowUnload = this._onWindowUnload.bind(this);
    this._toggle = this._toggle.bind(this);
  }

  loadMedia() {
    // Resolve the player's root view element once media is ready.
    this._playerRoot = this._resolvePlayerRoot();

    if (this.config.replaceNativePipButton) {
      this._suppressNativePip();
    }
    this._installControl();
  }

  /**
   * The DOM node we move into the PiP window. We want the outermost player view so the
   * video, control bar, and every overlay/plugin (watermark included) travel together.
   */
  _resolvePlayerRoot() {
    // player.getView() returns the player's root element in V7.
    if (typeof this.player.getView === 'function') {
      const view = this.player.getView();
      if (view) return view;
    }
    // Fallback: climb from the video element to the player container.
    const video = this.player.getVideoElement && this.player.getVideoElement();
    if (video) {
      return video.closest('[id^="player-"], .playkit-player') || video.parentElement;
    }
    return null;
  }

  /**
   * Hide the built-in PiP control so users see a single PiP affordance — ours.
   * We do not disable the underlying capability; we simply remove the default button
   * and route the intent through Document PiP.
   */
  _suppressNativePip() {
    try {
      // Turn off the default PiP UI if the player exposes the setting.
      if (this.player.ui && typeof this.player.ui.setConfig === 'function') {
        this.player.ui.setConfig({ pictureInPicture: false }, 'pictureInPicture');
      }
    } catch (e) {
      this.logger.warn('Could not disable native PiP via ui config; hiding button via CSS.', e);
    }
    // Belt-and-suspenders: hide the native button in the DOM if it renders anyway.
    const view = this._playerRoot;
    if (view) {
      const btn = view.querySelector('.playkit-pip, [aria-label="Picture in picture"], .playkit-picture-in-picture');
      if (btn) btn.style.display = 'none';
    }
  }

  /**
   * Add our control. We reuse the player UI manager to inject a button into the
   * bottom-right control group so it lands where the native PiP button used to be.
   */
  _installControl() {
    const uiManager = this.player.ui;
    if (uiManager && typeof uiManager.addComponent === 'function') {
      try {
        uiManager.addComponent({
          label: 'documentPip',
          area: 'BottomBarRightControls',
          get: this._buildButtonComponent()
        });
        return;
      } catch (e) {
        this.logger.warn('UI addComponent failed; falling back to manual button injection.', e);
      }
    }
    this._injectManualButton();
  }

  /**
   * Preact/React-free control factory. Returns a function the UI manager renders.
   * Uses the player's preact runtime exposed on KalturaPlayer.ui.
   */
  _buildButtonComponent() {
    const ui = KalturaPlayer.ui;
    const h = ui && ui.preact && ui.preact.h;
    const toggle = this._toggle;
    if (!h) {
      // No preact runtime available; signal manual fallback.
      return null;
    }
    return function DocumentPipButton() {
      return h(
        'button',
        {
          className: 'playkit-control-button playkit-document-pip',
          'aria-label': 'Picture in picture',
          tabIndex: 0,
          onClick: toggle
        },
        // Simple PiP glyph (SVG) so we match the control bar's monochrome icon style.
        h(
          'svg',
          { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'currentColor', 'aria-hidden': 'true' },
          h('path', { d: 'M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16.01H3V4.98h18v14.03z' })
        )
      );
    };
  }

  /**
   * Fallback when the UI manager can't render a component: inject a plain button
   * into the control bar DOM.
   */
  _injectManualButton() {
    const view = this._playerRoot;
    if (!view) return;
    const bar = view.querySelector('.playkit-bottom-bar .playkit-right-controls, .playkit-right-controls');
    if (!bar || bar.querySelector('.playkit-document-pip')) return;
    const btn = document.createElement('button');
    btn.className = 'playkit-control-button playkit-document-pip';
    btn.setAttribute('aria-label', 'Picture in picture');
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">' +
      '<path d="M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16.01H3V4.98h18v14.03z"/>' +
      '</svg>';
    btn.addEventListener('click', this._toggle);
    bar.appendChild(btn);
  }

  _toggle() {
    if (this._pipWindow) {
      this._pipWindow.close();
      return;
    }
    this._enterDocumentPip();
  }

  async _enterDocumentPip() {
    if (!DocumentPip.isValid()) {
      this.logger.warn('Document PiP not supported in this browser.');
      return;
    }
    const root = this._playerRoot || this._resolvePlayerRoot();
    if (!root) {
      this.logger.error('Could not resolve the player root element to move into PiP.');
      return;
    }

    const rect = root.getBoundingClientRect();
    const width = this.config.width || Math.round(rect.width) || 400;
    const height = this.config.height || Math.round(width * 9 / 16);

    let pipWindow;
    try {
      pipWindow = await window.documentPictureInPicture.requestWindow({ width, height });
    } catch (e) {
      this.logger.error('requestWindow failed (needs a user gesture / one PiP window at a time).', e);
      return;
    }
    this._pipWindow = pipWindow;

    // 1) Carry stylesheets across — styles do not transfer with the moved node.
    this._copyStyles(pipWindow.document);

    // 2) Normalize the PiP document so the player fills it edge to edge.
    const reset = pipWindow.document.createElement('style');
    reset.textContent =
      'html,body{margin:0;padding:0;height:100%;background:#000;overflow:hidden;}' +
      '.playkit-player{width:100%!important;height:100%!important;}';
    pipWindow.document.head.appendChild(reset);

    // 3) Leave a placeholder, then move the whole player view into the PiP window.
    this._placeholder = pipWindow.document.createComment('player-moved-to-pip');
    // Use a real element as the placeholder in the ORIGINAL document.
    this._placeholder = document.createElement('div');
    this._placeholder.style.display = 'none';
    root.parentNode.insertBefore(this._placeholder, root);
    pipWindow.document.body.appendChild(root);

    // 4) Nudge the player to relayout at the new size.
    if (!this.config.disableResizeInPip) {
      this._safeResize();
    }

    // 5) Restore on close.
    pipWindow.addEventListener('pagehide', this._onWindowUnload);

    this.logger.info('Entered Document PiP; player + overlays moved into floating window.');
  }

  _onWindowUnload() {
    const root = this._playerRoot;
    if (this._placeholder && this._placeholder.parentNode && root) {
      this._placeholder.parentNode.insertBefore(root, this._placeholder);
      this._placeholder.remove();
    }
    this._placeholder = null;
    this._pipWindow = null;
    if (!this.config.disableResizeInPip) {
      this._safeResize();
    }
    this.logger.info('Document PiP closed; player restored to page.');
  }

  _safeResize() {
    // Ask the player to recompute layout; ignore if the method isn't present.
    try {
      if (typeof this.player.updateStyles === 'function') this.player.updateStyles();
    } catch (e) { /* no-op */ }
    // Dispatch a resize so responsive UI recalculates.
    try {
      (this._pipWindow || window).dispatchEvent(new Event('resize'));
    } catch (e) { /* no-op */ }
  }

  _copyStyles(targetDoc) {
    // Clone <style> and <link rel=stylesheet> nodes.
    document
      .querySelectorAll('style, link[rel="stylesheet"]')
      .forEach(node => targetDoc.head.appendChild(node.cloneNode(true)));
    // Serialize same-origin CSSOM sheets (covers injected/constructed styles).
    for (let i = 0; i < document.styleSheets.length; i++) {
      const sheet = document.styleSheets[i];
      try {
        const cssText = Array.prototype.map.call(sheet.cssRules, r => r.cssText).join('\n');
        const styleEl = targetDoc.createElement('style');
        styleEl.textContent = cssText;
        targetDoc.head.appendChild(styleEl);
      } catch (e) {
        // Cross-origin stylesheet — cannot read rules; skip.
      }
    }
  }

  reset() {
    // Called between media; make sure we exit PiP cleanly.
    if (this._pipWindow) {
      try { this._pipWindow.close(); } catch (e) { /* no-op */ }
    }
    this._pipWindow = null;
    this._placeholder = null;
  }

  destroy() {
    this.reset();
  }
}

// Register the plugin under the name "documentPip" so it can be enabled from the uiConf.
KalturaPlayer.core.registerPlugin('documentPip', DocumentPip);

export default DocumentPip;
