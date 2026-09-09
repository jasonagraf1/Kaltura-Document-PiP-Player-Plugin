/*!
 * playkit-document-pip v1.0.0
 * Kaltura Player V7 (Playkit) plugin: replaces native Picture-in-Picture with
 * Document Picture-in-Picture so overlay plugins (e.g. a dynamic watermark) are
 * preserved in the floating window.
 *
 * PREBUILT — no build step required. Host this file over HTTPS with permissive CORS
 * and register it on your player (uiConf). It references the global `KalturaPlayer`
 * that the player provides at runtime.
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  function register() {
    if (!window.KalturaPlayer || !KalturaPlayer.core || !KalturaPlayer.core.BasePlugin) {
      return false;
    }
    var BasePlugin = KalturaPlayer.core.BasePlugin;

    var DEFAULT_CONFIG = {
      replaceNativePipButton: true,
      width: 400,
      height: 0,
      disableResizeInPip: false
    };

    function DocumentPip(name, player, config) {
      BasePlugin.call(this, name, player, config);
      this._pipWindow = null;
      this._placeholder = null;
      this._playerRoot = null;
      this._onWindowUnload = this._onWindowUnload.bind(this);
      this._toggle = this._toggle.bind(this);
    }

    // Extend BasePlugin.
    DocumentPip.prototype = Object.create(BasePlugin.prototype);
    DocumentPip.prototype.constructor = DocumentPip;

    DocumentPip.defaultConfig = DEFAULT_CONFIG;
    Object.defineProperty(DocumentPip, 'defaultConfig', {
      get: function () { return DEFAULT_CONFIG; }
    });

    DocumentPip.isValid = function () {
      return typeof window !== 'undefined' && 'documentPictureInPicture' in window;
    };

    DocumentPip.prototype.loadMedia = function () {
      this._playerRoot = this._resolvePlayerRoot();
      if (this.config.replaceNativePipButton) {
        this._suppressNativePip();
      }
      this._installControl();
    };

    DocumentPip.prototype._resolvePlayerRoot = function () {
      if (typeof this.player.getView === 'function') {
        var view = this.player.getView();
        if (view) return view;
      }
      var video = this.player.getVideoElement && this.player.getVideoElement();
      if (video) {
        return video.closest('[id^="player-"], .playkit-player') || video.parentElement;
      }
      return null;
    };

    DocumentPip.prototype._suppressNativePip = function () {
      try {
        if (this.player.ui && typeof this.player.ui.setConfig === 'function') {
          this.player.ui.setConfig({ pictureInPicture: false }, 'pictureInPicture');
        }
      } catch (e) {
        this.logger.warn('Could not disable native PiP via ui config; hiding button via CSS.', e);
      }
      var view = this._playerRoot;
      if (view) {
        var btn = view.querySelector('.playkit-pip, [aria-label="Picture in picture"], .playkit-picture-in-picture');
        if (btn) btn.style.display = 'none';
      }
    };

    DocumentPip.prototype._installControl = function () {
      var uiManager = this.player.ui;
      if (uiManager && typeof uiManager.addComponent === 'function') {
        try {
          var comp = this._buildButtonComponent();
          if (comp) {
            uiManager.addComponent({
              label: 'documentPip',
              area: 'BottomBarRightControls',
              get: comp
            });
            return;
          }
        } catch (e) {
          this.logger.warn('UI addComponent failed; falling back to manual button injection.', e);
        }
      }
      this._injectManualButton();
    };

    DocumentPip.prototype._buildButtonComponent = function () {
      var ui = KalturaPlayer.ui;
      var h = ui && ui.preact && ui.preact.h;
      var toggle = this._toggle;
      if (!h) return null;
      return function DocumentPipButton() {
        return h(
          'button',
          {
            className: 'playkit-control-button playkit-document-pip',
            'aria-label': 'Picture in picture',
            tabIndex: 0,
            onClick: toggle
          },
          h(
            'svg',
            { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'currentColor', 'aria-hidden': 'true' },
            h('path', { d: 'M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16.01H3V4.98h18v14.03z' })
          )
        );
      };
    };

    DocumentPip.prototype._injectManualButton = function () {
      var view = this._playerRoot;
      if (!view) return;
      var bar = view.querySelector('.playkit-bottom-bar .playkit-right-controls, .playkit-right-controls');
      if (!bar || bar.querySelector('.playkit-document-pip')) return;
      var btn = document.createElement('button');
      btn.className = 'playkit-control-button playkit-document-pip';
      btn.setAttribute('aria-label', 'Picture in picture');
      btn.innerHTML =
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">' +
        '<path d="M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16.01H3V4.98h18v14.03z"/>' +
        '</svg>';
      btn.addEventListener('click', this._toggle);
      bar.appendChild(btn);
    };

    DocumentPip.prototype._toggle = function () {
      if (this._pipWindow) {
        this._pipWindow.close();
        return;
      }
      this._enterDocumentPip();
    };

    DocumentPip.prototype._enterDocumentPip = function () {
      var self = this;
      if (!DocumentPip.isValid()) {
        this.logger.warn('Document PiP not supported in this browser.');
        return;
      }
      var root = this._playerRoot || this._resolvePlayerRoot();
      if (!root) {
        this.logger.error('Could not resolve the player root element to move into PiP.');
        return;
      }
      var rect = root.getBoundingClientRect();
      var width = this.config.width || Math.round(rect.width) || 400;
      var height = this.config.height || Math.round(width * 9 / 16);

      window.documentPictureInPicture.requestWindow({ width: width, height: height })
        .then(function (pipWindow) {
          self._pipWindow = pipWindow;

          self._copyStyles(pipWindow.document);

          var reset = pipWindow.document.createElement('style');
          reset.textContent =
            'html,body{margin:0;padding:0;height:100%;background:#000;overflow:hidden;}' +
            '.playkit-player{width:100%!important;height:100%!important;}';
          pipWindow.document.head.appendChild(reset);

          self._placeholder = document.createElement('div');
          self._placeholder.style.display = 'none';
          root.parentNode.insertBefore(self._placeholder, root);
          pipWindow.document.body.appendChild(root);

          if (!self.config.disableResizeInPip) self._safeResize();

          pipWindow.addEventListener('pagehide', self._onWindowUnload);
          self.logger.info('Entered Document PiP; player + overlays moved into floating window.');
        })
        .catch(function (e) {
          self.logger.error('requestWindow failed (needs a user gesture / one PiP window at a time).', e);
        });
    };

    DocumentPip.prototype._onWindowUnload = function () {
      var root = this._playerRoot;
      if (this._placeholder && this._placeholder.parentNode && root) {
        this._placeholder.parentNode.insertBefore(root, this._placeholder);
        this._placeholder.remove();
      }
      this._placeholder = null;
      this._pipWindow = null;
      if (!this.config.disableResizeInPip) this._safeResize();
      this.logger.info('Document PiP closed; player restored to page.');
    };

    DocumentPip.prototype._safeResize = function () {
      try {
        if (typeof this.player.updateStyles === 'function') this.player.updateStyles();
      } catch (e) { /* no-op */ }
      try {
        (this._pipWindow || window).dispatchEvent(new Event('resize'));
      } catch (e) { /* no-op */ }
    };

    DocumentPip.prototype._copyStyles = function (targetDoc) {
      document
        .querySelectorAll('style, link[rel="stylesheet"]')
        .forEach(function (node) { targetDoc.head.appendChild(node.cloneNode(true)); });
      for (var i = 0; i < document.styleSheets.length; i++) {
        var sheet = document.styleSheets[i];
        try {
          var cssText = Array.prototype.map.call(sheet.cssRules, function (r) { return r.cssText; }).join('\n');
          var styleEl = targetDoc.createElement('style');
          styleEl.textContent = cssText;
          targetDoc.head.appendChild(styleEl);
        } catch (e) { /* cross-origin sheet — skip */ }
      }
    };

    DocumentPip.prototype.reset = function () {
      if (this._pipWindow) {
        try { this._pipWindow.close(); } catch (e) { /* no-op */ }
      }
      this._pipWindow = null;
      this._placeholder = null;
    };

    DocumentPip.prototype.destroy = function () {
      this.reset();
    };

    KalturaPlayer.core.registerPlugin('documentPip', DocumentPip);
    return true;
  }

  // The player bundle may load after this file. Retry registration briefly until the
  // global KalturaPlayer is available.
  if (!register()) {
    var attempts = 0;
    var timer = setInterval(function () {
      attempts++;
      if (register() || attempts > 100) clearInterval(timer);
    }, 100);
  }
})();
