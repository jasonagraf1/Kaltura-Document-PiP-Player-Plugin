/*!
 * playkit-document-pip v1.2.0
 * Kaltura Player V7 (Playkit) plugin: routes the player's Picture-in-Picture action to
 * Document Picture-in-Picture so overlay plugins (e.g. a dynamic watermark) are preserved
 * in the floating window.
 *
 * v1.1 change: instead of adding/removing control-bar buttons (brittle across player builds),
 * this version intercepts requestPictureInPicture() on the video element. The player's
 * existing PiP button then opens a Document PiP window automatically. Verbose console logging
 * under the "[documentPip]" prefix lets you confirm each step.
 *
 * PREBUILT — no build step. Host over HTTPS with permissive CORS; references global KalturaPlayer.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  var LOG = '[documentPip]';
  function clog() {
    try {
      var args = Array.prototype.slice.call(arguments);
      args.unshift(LOG);
      console.log.apply(console, args);
    } catch (e) { /* no-op */ }
  }

  function register() {
    if (!window.KalturaPlayer || !KalturaPlayer.core || !KalturaPlayer.core.BasePlugin) {
      return false;
    }
    var BasePlugin = KalturaPlayer.core.BasePlugin;

    var DEFAULT_CONFIG = {
      width: 400,
      height: 0,
      disableResizeInPip: false
    };

    function DocumentPip(name, player, config) {
      BasePlugin.call(this, name, player, config);
      this._pipWindow = null;
      this._placeholder = null;
      this._playerRoot = null;
      this._hijacked = false;
      this._onWindowUnload = this._onWindowUnload.bind(this);
      clog('plugin instance created');
    }

    DocumentPip.prototype = Object.create(BasePlugin.prototype);
    DocumentPip.prototype.constructor = DocumentPip;

    Object.defineProperty(DocumentPip, 'defaultConfig', {
      get: function () { return DEFAULT_CONFIG; }
    });

    DocumentPip.isValid = function () {
      var ok = typeof window !== 'undefined' && 'documentPictureInPicture' in window;
      if (!ok) clog('Document PiP NOT supported in this browser — plugin inert.');
      return ok;
    };

    // loadMedia is a Playkit plugin lifecycle hook, called when media is loaded.
    DocumentPip.prototype.loadMedia = function () {
      clog('loadMedia fired');
      this._playerRoot = this._resolvePlayerRoot();
      clog('resolved player root:', this._playerRoot);
      this._hijackNativePip();
      // Video element can be (re)created; re-hijack on first play as a safety net.
      var self = this;
      try {
        this.player.addEventListener(this.player.Event.FIRST_PLAY, function () {
          clog('first play — re-checking hijack');
          self._playerRoot = self._resolvePlayerRoot();
          self._hijackNativePip();
        });
      } catch (e) { /* Event name may differ; ignore */ }
    };

    DocumentPip.prototype._resolvePlayerRoot = function () {
      if (typeof this.player.getView === 'function') {
        var view = this.player.getView();
        if (view) return view;
      }
      var video = this._getVideo();
      if (video) {
        return video.closest('[id^="player-"], .playkit-player') || video.parentElement;
      }
      return null;
    };

    DocumentPip.prototype._getVideo = function () {
      // Try the documented accessor first, then fall back to DOM.
      var v = null;
      try { v = this.player.getVideoElement && this.player.getVideoElement(); } catch (e) {}
      if (v) return v;
      var root = this._playerRoot || document;
      return root.querySelector ? root.querySelector('video') : null;
    };

    // Core of v1.1: replace requestPictureInPicture on the actual video element so the
    // player's native PiP button opens a Document PiP window instead.
    DocumentPip.prototype._hijackNativePip = function () {
      var self = this;
      var video = this._getVideo();
      if (!video) { clog('no <video> element found yet to hijack'); return; }
      if (video.__docPipHijacked) { clog('video already hijacked'); return; }
      video.__docPipHijacked = true;
      this._hijacked = true;
      clog('hijacking video.requestPictureInPicture on', video);
      video.requestPictureInPicture = function () {
        clog('intercepted requestPictureInPicture -> Document PiP');
        self._toggle();
        // Resolve so the player UI does not log an unhandled rejection.
        return Promise.resolve();
      };
    };

    DocumentPip.prototype._toggle = function () {
      if (this._pipWindow) { clog('toggle: closing existing PiP window'); this._pipWindow.close(); return; }
      this._enterDocumentPip();
    };

    DocumentPip.prototype._enterDocumentPip = function () {
      var self = this;
      if (!DocumentPip.isValid()) return;
      var root = this._playerRoot || this._resolvePlayerRoot();
      if (!root) { clog('ERROR: could not resolve player root to move into PiP'); return; }

      var rect = root.getBoundingClientRect();
      var width = this.config.width || Math.round(rect.width) || 400;
      var height = this.config.height || Math.round(width * 9 / 16);
      clog('requesting PiP window', width + 'x' + height);

      window.documentPictureInPicture.requestWindow({ width: width, height: height })
        .then(function (pipWindow) {
          self._pipWindow = pipWindow;
          self._copyStyles(pipWindow.document);

          // Neutral layout reset only — NO player-specific class names. Mirrors the
          // validated test page: the PiP body fills the window, and the moved element is
          // sized to fill the body so the player lays itself out for that size.
          var reset = pipWindow.document.createElement('style');
          reset.textContent = 'html,body{margin:0;padding:0;height:100%;background:#000;overflow:hidden;}';
          pipWindow.document.head.appendChild(reset);

          self._placeholder = document.createElement('div');
          self._placeholder.style.display = 'none';
          root.parentNode.insertBefore(self._placeholder, root);

          // Preserve the element's own inline size, then make it fill the PiP window.
          // This is the key step the working test page did (#player-shell{height:100%}).
          self._savedInlineCssText = root.style.cssText;
          root.style.width = '100%';
          root.style.height = '100%';

          pipWindow.document.body.appendChild(root);
          clog('moved player root into PiP window (100% x 100%) — watermark rides along');

          pipWindow.addEventListener('pagehide', self._onWindowUnload);
        })
        .catch(function (e) {
          clog('requestWindow failed (needs user gesture / one window at a time):', e);
        });
    };

    DocumentPip.prototype._onWindowUnload = function () {
      var root = this._playerRoot;
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
    };

    DocumentPip.prototype._copyStyles = function (targetDoc) {
      document.querySelectorAll('style, link[rel="stylesheet"]').forEach(function (node) {
        targetDoc.head.appendChild(node.cloneNode(true));
      });
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
      if (this._pipWindow) { try { this._pipWindow.close(); } catch (e) {} }
      this._pipWindow = null;
      this._placeholder = null;
    };

    DocumentPip.prototype.destroy = function () { this.reset(); };

    KalturaPlayer.core.registerPlugin('documentPip', DocumentPip);
    clog('registered plugin "documentPip" (v1.2.0)');
    return true;
  }

  if (!register()) {
    clog('KalturaPlayer not ready yet — will retry registration');
    var attempts = 0;
    var timer = setInterval(function () {
      attempts++;
      if (register() || attempts > 100) clearInterval(timer);
    }, 100);
  }
})();
