// Page content helper script
(function () {
  const existingRoot = document.getElementById('__pr_root__');
  if (existingRoot) {
    existingRoot.remove();
  }

  // ── Obfuscated message types (must match background.js) ────────
  const T = {
    SIGN_IN: '_r1',
    SIGN_OUT: '_r2',
    GET_AUTH_STATE: '_r3',
    GET_API_KEYS: '_r4',
    SAVE_API_KEYS: '_r5',
    LLM_REQUEST: '_r6',
    CAPTURE_SCREENSHOT: '_r7',
    OPEN_SIDEPANEL: '_r8',
    GET_SIDEPANEL_STATE: '_r9',
    PULL_PAGE_CONTENT: '_ra',
    SIDEPANEL_STATE: '_rb',
    OPEN_FLOATING: '_rc',
    TOGGLE_STEALTH: '_rd',
    START_GENERATION: 'START_GENERATION',
    STOP_GENERATION: 'STOP_GENERATION',
  };

  // ── Obfuscated storage keys (must match background.js) ─────────
  const K = {
    CHAT_HISTORY: '_c1',
    PREFERRED_MODE: '_c2',
  };

  // ── Port name (must match background.js) ───────────────────────
  const PORT_NAME = '_p0rt_sp';

  // ── Session-unique random suffix for element IDs ───────────────
  const R = Math.random().toString(36).slice(2, 8);
  const id = (name) => `${name}_${R}`;

  // ── Pull Shared Logic ──────────────────────────────────────────
  const { PROVIDERS, MAX_CONTEXT_MESSAGES, formatMessage } = window.NagaSaiShared;

  // ── State ──────────────────────────────────────────────────────
  let panelOpen = false;
  let currentView = 'chat';
  let authState = { signedIn: false, user: null, token: null };
  let apiKeys = { google: '', groq: '', openai: '', anthropic: '', openrouter: '', customKey: '', customUrl: '', customModel: '' };
  let chatHistory = [];
  let selectedProvider = 'pollinations';
  let selectedModel = 'openai';
  let isLoading = false;
  let isDragging = false;
  let dragOffsetX = 0, dragOffsetY = 0;
  let attachedScreenshotUrl = null;
  let currentPort = null;
  let toggleDragOffsetX = 0, toggleDragOffsetY = 0;
  let lastMouseX = 0, lastMouseY = 0;
  let isToggleDragging = false;
  let toggleHasMoved = false;

  // Stealth mode: hides all extension UI during screen sharing
  let isStealth = false;

  // FOUC Fix: Hide UI until styles are loaded
  let uiRevealed = false;
  function revealUI() {
    if (uiRevealed) return;
    uiRevealed = true;
    shadowHost.style.setProperty('opacity', '1', 'important');
    if (!isStealth) {
      toggleBtn.style.setProperty('opacity', panelOpen ? '1' : '0.4', 'important');
      toggleBtn.style.setProperty('pointer-events', 'auto', 'important');
    }
  }
  // Fallback reveal
  setTimeout(revealUI, 1000);

  // ── Shadow DOM Host (generic anonymous element) ─────────────────
  // Fix: Use a full-screen position:fixed overlay as the shadow host so the
  // panel is NEVER trapped inside a page stacking context created by CSS
  // properties like transform, filter, will-change, or isolation on page elements.
  // This is the same technique used by Blackbox AI — a transparent full-screen
  // overlay at maximum z-index. pointer-events:none on the host means it doesn't
  // block any page interaction; pointer-events:all is set on the panel itself.
  const shadowHost = document.createElement('div');
  shadowHost.id = '__pr_root__'; // generic, no branding
  shadowHost.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'width:100%',
    'height:100%',
    'z-index:2147483647',
    'pointer-events:none',
    'opacity:0',
    'transition:opacity 0.4s ease',
  ].join('!important;') + '!important;';
  document.body.appendChild(shadowHost);

  const shadowRoot = shadowHost.attachShadow({ mode: 'closed' });

  // ── Stealth Mode Functions ────────────────────────────────────
  // enterStealth(): makes S button INVISIBLE (opacity:0) but keeps it CLICKABLE.
  // The user knows exactly where the S button is (bottom-right corner).
  // Clients can't see a transparent element. Clicking the invisible S exits stealth.
  function enterStealth() {
    isStealth = true;
    // opacity:0 = invisible to camera/screen share but still physically clickable
    // We do NOT use display:none because that would make it unclickable
    toggleBtn.style.setProperty('opacity', '0', 'important');
    toggleBtn.style.setProperty('pointer-events', 'all', 'important');
    // Close floating panel if open
    if (panelOpen) {
      panelOpen = false;
      if (panel) panel.classList.remove('nagasai-panel--open');
      chrome.storage.local.remove(K.PREFERRED_MODE);
    }
  }

  // exitStealth(): makes S button fully visible again.
  function exitStealth() {
    isStealth = false;
    toggleBtn.style.removeProperty('opacity');
    toggleBtn.style.setProperty('pointer-events', 'auto', 'important');
    applyToggleStyle(toggleBtn, panelOpen);
  }

  // ── Auto-detect screen sharing via getDisplayMedia intercept ──────
  // This fires when the user starts a screen share FROM THIS TAB.
  // (e.g. sharing a browser tab via Google Meet opened in the same window)
  try {
    const _origGDM = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getDisplayMedia = async function (constraints) {
      const stream = await _origGDM(constraints);
      // Screen sharing just started — enter stealth immediately
      enterStealth();
      // Exit stealth when ALL video tracks end (sharing stopped)
      stream.getVideoTracks().forEach(track => {
        track.addEventListener('ended', () => {
          if (stream.getVideoTracks().every(t => t.readyState === 'ended')) {
            exitStealth();
          }
        });
      });
      return stream;
    };
  } catch (_) { /* navigator.mediaDevices may not exist on some pages */ }

  // ── Toggle button lives in main DOM with random ID + inline style
  const toggleBtn = document.createElement('div');
  // Adaptive color: dim dark letter on light pages, dim white letter on dark pages
  toggleBtn.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;"><span id="__pr_s_letter__" style="font-family:Georgia,'Times New Roman',serif;font-size:17px;font-weight:700;font-style:italic;line-height:1;transition:opacity 0.2s ease;">S</span></div>`;
  toggleBtn.id = id('_tb');

  function applyToggleStyle(el, active) {
    el.style.cssText = [
      'position:fixed !important',
      'bottom:07px !important',
      'right:05px !important',
      'width:34px !important',
      'height:34px !important',
      'border-radius:50% !important',
      'border:none !important',
      'box-shadow:none !important',
      'z-index:2147483646 !important',
      'display:flex !important',
      'align-items:center !important',
      'justify-content:center !important',
      'transition:none !important',
      'user-select:none !important',
      'box-sizing:border-box !important',
      'cursor:pointer !important',
      'opacity:' + (uiRevealed ? (active ? '1' : '0.6') : '0') + ' !important',
      'pointer-events:' + (uiRevealed ? 'auto' : 'none') + ' !important',
      'transition:opacity 0.4s ease, transform 0.2s ease !important',
    ].join(';');

    const letter = el.querySelector('#__pr_s_letter__');
    if (letter) {
      letter.style.color = '#ffffff';
      if (active) letter.style.textShadow = '0 0 8px rgba(0,0,0,0.9), 0 0 2px rgba(255,255,255,0.5)';
      else letter.style.textShadow = '0 1px 4px rgba(0,0,0,0.8), 0 0 2px rgba(0,0,0,0.6)';
    }
  }

  applyToggleStyle(toggleBtn, false);
  document.body.appendChild(toggleBtn);

  // ── Build panel HTML inside shadow root ────────────────────────
  const panelRoot = document.createElement('div');
  // Fix: Give panelRoot a stable id so CSS selectors like #nagasai-root.ns-dark-theme
  // directly target it inside the shadow DOM — same approach as sidepanel.js.
  // Shadow DOM scopes CSS so #nagasai-root only matches this element, not the main DOM.
  panelRoot.id = 'nagasai-root';

  // Apply saved theme to panelRoot (which #nagasai-root.ns-dark/light-theme targets)
  const storedTheme = localStorage.getItem('_xt') || 'dark'; // Default dark theme like desktop
  if (storedTheme === 'light') panelRoot.classList.add('ns-light-theme');
  else panelRoot.classList.add('ns-dark-theme');

  // Apply saved opacity
  const storedOpacity = localStorage.getItem('_xo') || '1';
  panelRoot.style.opacity = storedOpacity;

  panelRoot.innerHTML = window.NagaSaiShared.buildPanelHTML(false);
  shadowRoot.appendChild(panelRoot);

  const panel = panelRoot.querySelector('[data-ns="panel"]');

  // ── Inject CSS into shadow root via adoptedStyleSheets ─────────
  (async () => {
    try {


      const cssUrl = chrome.runtime.getURL('ui.css');
      const res = await fetch(cssUrl);
      let cssText = await res.text();
      // Strip ALL @import lines — illegal in adoptedStyleSheets
      cssText = cssText.replace(/@import\s+[^;]+;/g, '');
      // NO longer remap #nagasai-root → :host.
      // panelRoot now has id='nagasai-root' inside the shadow DOM,
      // so CSS selectors like #nagasai-root.ns-dark-theme directly target it.
      // This is the exact same pattern used by sidepanel.js and is why the
      // side panel theme works but the floating panel did not.
      const sheet = new CSSStyleSheet();
      await sheet.replace(cssText);
      shadowRoot.adoptedStyleSheets = [sheet];
      // CSS is now applied to the Shadow DOM — reveal the UI!
      revealUI();
    } catch (_) {
      revealUI(); // reveal anyway on error
    }
  })();

  // ── Init ───────────────────────────────────────────────────────
  // Bug #1 Fix: Do NOT auto-open the panel on page load.
  // PREFERRED_MODE is only used to remember WHICH mode to use when the
  // user clicks the 'S' button — NOT to auto-open it on navigation.
  chrome.storage.local.get([K.CHAT_HISTORY, K.PREFERRED_MODE], (data) => {
    if (data[K.CHAT_HISTORY]) {
      chatHistory = data[K.CHAT_HISTORY];
      if (currentView === 'chat') renderMessages();
    }
    // Panel always starts closed on page load — user must click to open.
  });

  renderView();

  (async () => {
    await refreshAuthState();
    setupEventListeners();
    const st = await sendMsg({ type: T.GET_SIDEPANEL_STATE });
    if (st && st.isOpen) {
      toggleBtn.style.display = 'none';
      panelOpen = false;
      panel.classList.remove('nagasai-panel--open');
    }
  })();

  // ── Message listener ───────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === T.PULL_PAGE_CONTENT) {
      const text = extractPageContent() || 'No content found on page.';
      sendResponse({ content: text, title: document.title, url: window.location.href });
    }
    if (msg.type === T.SIDEPANEL_STATE) {
      const tb = document.getElementById(id('_tb'));
      if (tb) {
        tb.style.display = msg.isOpen ? 'none' : 'flex';
        if (msg.isOpen && panelOpen) {
          panelOpen = false;
          panel.classList.remove('nagasai-panel--open');
          applyToggleStyle(tb, false);
        }
      }
    }
    if (msg.type === T.OPEN_FLOATING) {
      // Only open floating panel if NOT in stealth mode
      if (!isStealth) {
        panelOpen = true;
        panel.classList.add('nagasai-panel--open');
        applyToggleStyle(toggleBtn, true);
      }
    }
    // Stealth toggle — triggered by Alt+Shift+H keyboard shortcut via background.js
    // background.js sends msg.entering=true (hide) or false (show) explicitly
    // so content script and background are always in sync.
    if (msg.type === T.TOGGLE_STEALTH) {
      if (msg.entering === true) enterStealth();
      else if (msg.entering === false) exitStealth();
      else {
        // Fallback: toggle if no explicit direction given
        if (isStealth) exitStealth(); else enterStealth();
      }
      sendResponse({ stealth: isStealth });
    }
    return true;
  });

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes[K.CHAT_HISTORY]) {
      if (!isLoading) {
        chatHistory = changes[K.CHAT_HISTORY].newValue || [];
        if (currentView === 'chat' && panelOpen) renderMessages();
      }
    }
    if (namespace === 'sync' && changes._s4) {
      apiKeys = changes._s4.newValue || apiKeys;
      renderView();
    }
  });

  // ── Toggle drag & click ────────────────────────────────────────
  toggleBtn.addEventListener('mousedown', (e) => {
    isToggleDragging = true;
    toggleHasMoved = false;
    const r = toggleBtn.getBoundingClientRect();
    toggleDragOffsetX = e.clientX - r.left;
    toggleDragOffsetY = e.clientY - r.top;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    toggleBtn.style.transition = 'none';
    panel.style.transition = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isToggleDragging) return;
    if (e.buttons === 0) {
      isToggleDragging = false;
      return;
    }
    toggleHasMoved = true;
    const dx = e.clientX - lastMouseX;
    const dy = e.clientY - lastMouseY;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    const x = e.clientX - toggleDragOffsetX;
    const y = e.clientY - toggleDragOffsetY;
    toggleBtn.style.setProperty('left', `${x}px`, 'important');
    toggleBtn.style.setProperty('top', `${y}px`, 'important');
    toggleBtn.style.setProperty('right', 'auto', 'important');
    toggleBtn.style.setProperty('bottom', 'auto', 'important');
    if (panelOpen) {
      const pr = panel.getBoundingClientRect();
      panel.style.setProperty('left', `${pr.left + dx}px`, 'important');
      panel.style.setProperty('top', `${pr.top + dy}px`, 'important');
      panel.style.setProperty('right', 'auto', 'important');
      panel.style.setProperty('bottom', 'auto', 'important');
      panel.style.setProperty('margin', '0', 'important');
    }
  });

  document.addEventListener('mouseup', () => {
    if (isToggleDragging) isToggleDragging = false;
  });

  toggleBtn.addEventListener('mouseenter', () => {
    if (isStealth) return; // don't reveal in stealth
    toggleBtn.style.opacity = '1';
    toggleBtn.style.transform = 'scale(1.1)';
  });
  toggleBtn.addEventListener('mouseleave', () => {
    if (isStealth) return;
    if (!panelOpen) { toggleBtn.style.opacity = '0.4'; toggleBtn.style.transform = 'scale(1)'; }
  });

  toggleBtn.addEventListener('click', () => {
    if (toggleHasMoved) return;

    // Safety: Check if extension context is valid
    // If chrome.runtime.id is missing or calling it throws, the extension
    const isContextValid = () => {
      try { return !!chrome.runtime.id; }
      catch (e) { return false; }
    };

    if (!isContextValid()) {
      showContextError();
      return;
    }

    try {
      // If in stealth mode, clicking the invisible S button exits stealth.
      if (isStealth) { exitStealth(); return; }

      chrome.storage.local.get(K.PREFERRED_MODE, async (data) => {
        if (chrome.runtime.lastError) { showContextError(); return; }

        if (data[K.PREFERRED_MODE] === 'sidepanel') {
          const resp = await sendMsg({ type: T.OPEN_SIDEPANEL });
          if (!resp.success && resp.error?.includes('disconnected')) showContextError();
        } else {
          panelOpen = !panelOpen;
          if (panelOpen) {
            panel.classList.add('nagasai-panel--open');
            applyToggleStyle(toggleBtn, true);
            toggleBtn.style.opacity = '1';
            chrome.storage.local.set({ [K.PREFERRED_MODE]: 'floating' });
            if (authState.signedIn) setTimeout(() => q('#nagasai-input')?.focus(), 100);
          } else {
            panel.classList.remove('nagasai-panel--open');
            applyToggleStyle(toggleBtn, false);
            chrome.storage.local.remove(K.PREFERRED_MODE);
          }
        }
      });
    } catch (e) {
      showContextError();
    }
  });

  function showContextError() {
    toggleBtn.style.setProperty('background', '#ff4d4d', 'important');
    toggleBtn.style.setProperty('transform', 'scale(1.2)', 'important');
    toggleBtn.title = 'Extension Updated — Please reload this page to continue using NagaSai AI';
    const s = toggleBtn.querySelector('#__pr_s_letter__');
    if (s) {
      s.textContent = '!';
      s.style.color = 'white';
      s.style.opacity = '1';
    }
    // Attempt a standard alert as a last resort for visibility
    alert('NagaSai AI has been updated or reloaded. Please refresh this page to continue using the extension.');
  }

  // ── Auth ───────────────────────────────────────────────────────
  async function refreshAuthState() {
    try {
      const res = await sendMsg({ type: T.GET_AUTH_STATE });
      if (res && res.signedIn !== undefined) authState = res;
      const keysRes = await sendMsg({ type: T.GET_API_KEYS });
      if (keysRes && keysRes.keys) apiKeys = keysRes.keys;
    } catch (_) { }
    renderView();
  }

  // ── Event Listeners ────────────────────────────────────────────
  function setupEventListeners() {
    q('#nagasai-close').addEventListener('click', () => {
      panelOpen = false;
      panel.classList.remove('nagasai-panel--open');
      applyToggleStyle(toggleBtn, false);
      toggleBtn.style.opacity = '0.4';
      chrome.storage.local.remove(K.PREFERRED_MODE);
    });

    // ◄ STEALTH BUTTON — the green eye icon in the panel header.
    // Clicking it immediately hides the panel AND makes the S button invisible
    // (but still clickable). Client cannot see a transparent element.
    // To come back: click where the S button was (bottom-right corner).
    q('#nagasai-stealth-btn').addEventListener('click', () => {
      enterStealth();
    });

    q('#nagasai-clear').addEventListener('click', () => {
      chatHistory = [];
      chrome.storage.local.set({ [K.CHAT_HISTORY]: [] });
      renderMessages();
    });

    // Bug #2 Fix: Apply theme class directly to panelRoot (id='nagasai-root') inside
    // the shadow DOM. The CSS selectors #nagasai-root.ns-dark-theme target this exactly,
    // consistent with how sidepanel.js works.
    q('#nagasai-theme-btn').addEventListener('click', () => {
      const isDark = panelRoot.classList.contains('ns-dark-theme') ||
        (!panelRoot.classList.contains('ns-light-theme') &&
          !window.matchMedia('(prefers-color-scheme: light)').matches);

      if (isDark) {
        panelRoot.classList.remove('ns-dark-theme');
        panelRoot.classList.add('ns-light-theme');
        localStorage.setItem('_xt', 'light');
      } else {
        panelRoot.classList.remove('ns-light-theme');
        panelRoot.classList.add('ns-dark-theme');
        localStorage.setItem('_xt', 'dark');
      }
      applyToggleStyle(toggleBtn, panelOpen);
    });

    const opacitySlider = panel.querySelector('#nagasai-pref-opacity');
    if (opacitySlider) {
      opacitySlider.value = localStorage.getItem('_xo') || '1';
      opacitySlider.addEventListener('input', (e) => {
        panelRoot.style.opacity = e.target.value;
      });
      opacitySlider.addEventListener('change', (e) => {
        localStorage.setItem('_xo', e.target.value);
      });
    }

    q('#nagasai-settings-btn').addEventListener('click', () => {
      currentView = currentView === 'settings' ? 'chat' : 'settings';
      renderView();
    });

    const sidePanelBtn = q('#nagasai-sidepanel-btn');
    if (sidePanelBtn) {
      sidePanelBtn.addEventListener('click', async () => {
        chrome.storage.local.set({ [K.PREFERRED_MODE]: 'sidepanel' });
        panelOpen = false;
        panel.classList.remove('nagasai-panel--open');
        applyToggleStyle(toggleBtn, false);
        await sendMsg({ type: T.OPEN_SIDEPANEL });
      });
    }

    panel.addEventListener('click', async (e) => {
      if (e.target.closest('#nagasai-send-btn')) {
        if (isLoading) {
          if (currentPort) {
            currentPort.postMessage({ type: T.STOP_GENERATION });
            currentPort = null;
          }
          return;
        }
        sendUserMessage();
      }
      if (e.target.closest('#nagasai-save-keys-btn')) saveApiKeys();
      if (e.target.closest('#nagasai-export-btn')) exportChatToHtml();

      if (e.target.closest('#nagasai-screenshot-btn')) {
        e.preventDefault();
        handleScreenshotCapture();
      }
      if (e.target.closest('#nagasai-remove-screenshot-btn')) {
        e.preventDefault();
        removeScreenshot();
      }

      // Bug #12 Fix: Suggestion button clicks handled via event delegation
      // instead of inline onclick attributes (which are fragile in Shadow DOM).
      const suggestion = e.target.closest('.nagasai-suggestion');
      if (suggestion) {
        const text = suggestion.dataset.suggestion;
        if (text) {
          const input = q('#nagasai-input');
          if (input) { input.value = text; input.focus(); }
        }
      }

      const copyBtn = e.target.closest('.nagasai-copy-btn');
      if (copyBtn) {
        const codeBlock = copyBtn.closest('.nagasai-code-wrapper').querySelector('code');
        if (codeBlock) {
          try {
            const textToCopy = codeBlock.innerHTML
              .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
            await navigator.clipboard.writeText(textToCopy);
            const orig = copyBtn.textContent;
            copyBtn.textContent = 'Copied!';
            copyBtn.classList.add('copied');
            setTimeout(() => { copyBtn.textContent = orig; copyBtn.classList.remove('copied'); }, 2000);
          } catch (_) { }
        }
      }
    });

    panel.addEventListener('change', (e) => {
      if (e.target.id === 'nagasai-provider-select') {
        selectedProvider = e.target.value;
        selectedModel = PROVIDERS[selectedProvider].models[0][0];
        renderModelSelect();
      }
      if (e.target.id === 'nagasai-model-select') selectedModel = e.target.value;
    });

    panel.addEventListener('keydown', (e) => {
      if (e.target && e.target.id === 'nagasai-input') {
        e.stopPropagation(); // Prevent host page from intercepting keypresses (like backspace)
        if ((e.key === 'Enter' || e.keyCode === 13) && !e.shiftKey) {
          e.preventDefault();
          sendUserMessage();
        }
      }
    });

    panel.addEventListener('keyup', (e) => {
      if (e.target && e.target.id === 'nagasai-input') {
        e.stopPropagation();
      }
    });

    panel.addEventListener('keypress', (e) => {
      if (e.target && e.target.id === 'nagasai-input') {
        e.stopPropagation();
      }
    });

    setupMicButton();

    q('#nagasai-header').addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', stopDrag);
  }

  // ── Export Chat ──────────────────────────────────────────────
  function exportChatToHtml() {
    if (chatHistory.length === 0) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    let htmlContent = `
    <html>
      <head>
        <title>NagaSai AI Export - ${timestamp}</title>
        <style>
          body { font-family: sans-serif; background: #161616; color: #eaeaea; padding: 20px; }
          .msg { margin-bottom: 20px; padding: 15px; border-radius: 8px; max-width: 800px; margin-left: auto; margin-right: auto; }
          .user { background: #2a2a2a; }
          .assistant { background: #1f1f1f; border-left: 4px solid #1dba8a; }
          .role { font-weight: bold; margin-bottom: 10px; color: #1dba8a; }
          .user .role { color: #888; }
          pre { background: #000; padding: 10px; border-radius: 6px; overflow-x: auto; white-space: pre-wrap; }
          code { font-family: monospace; }
        </style>
      </head>
      <body>
        <h2 style="text-align: center;">NagaSai AI Chat Export</h2>
    `;
    
    chatHistory.forEach((msg) => {
      const roleLabel = msg.role === 'user' ? 'You' : 'NagaSai AI';
      let content = (msg.content || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\\n/g, '<br>');
      htmlContent += `\n<div class="msg ${msg.role}">\n  <div class="role">${roleLabel}</div>\n  <div class="content"><pre>${content}</pre></div>\n</div>`;
    });
    
    htmlContent += '\n</body>\n</html>';
    
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `NagaSai_Export_${timestamp}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── API Keys (Bug #3 Fix: save ALL key fields including custom) ─
  async function saveApiKeys() {
    const btn = q('#nagasai-save-keys-btn');
    const msgEl = q('#nagasai-keys-msg');
    if (btn) btn.disabled = true;
    if (msgEl) { msgEl.style.display = 'none'; msgEl.textContent = ''; }

    const inputVal = q('#nagasai-key-smart')?.value.trim() || '';
    let identifiedProvider = null;

    // Read all fields — preserve existing custom fields from stored apiKeys
    let newKeys = {
      google: q('#nagasai-key-google')?.value.trim() ?? apiKeys.google ?? '',
      groq: q('#nagasai-key-groq')?.value.trim() ?? apiKeys.groq ?? '',
      openai: q('#nagasai-key-openai')?.value.trim() ?? apiKeys.openai ?? '',
      anthropic: q('#nagasai-key-anthropic')?.value.trim() ?? apiKeys.anthropic ?? '',
      openrouter: q('#nagasai-key-openrouter')?.value.trim() ?? apiKeys.openrouter ?? '',
      // Bug #3 Fix: preserve custom provider fields instead of wiping them
      customKey: q('#nagasai-key-custom')?.value.trim() ?? apiKeys.customKey ?? '',
      customUrl: q('#nagasai-key-customurl')?.value.trim() ?? apiKeys.customUrl ?? '',
      customModel: q('#nagasai-key-custommodel')?.value.trim() ?? apiKeys.customModel ?? '',
    };

    if (inputVal) {
      if (inputVal.startsWith('AIza')) { newKeys.google = inputVal; identifiedProvider = 'google'; }
      else if (inputVal.startsWith('gsk_')) { newKeys.groq = inputVal; identifiedProvider = 'groq'; }
      else if (inputVal.startsWith('sk-')) { newKeys.openai = inputVal; identifiedProvider = 'openai'; }
      else { newKeys.openai = inputVal; identifiedProvider = 'openai'; }
    }

    const res = await sendMsg({ type: T.SAVE_API_KEYS, payload: newKeys });
    if (btn) btn.disabled = false;

    if (res && res.success) {
      if (identifiedProvider) selectedProvider = identifiedProvider;
      apiKeys = newKeys;
      if (msgEl) {
        msgEl.textContent = identifiedProvider
          ? `✓ ${PROVIDERS[identifiedProvider]?.label || 'Provider'} unlocked!`
          : '✓ Keys saved!';
        msgEl.style.color = '#1dba8a';
        msgEl.style.display = 'block';
        setTimeout(() => msgEl.style.display = 'none', 3000);
      }
      renderProviderSelect();
      renderMessages();
    } else {
      if (msgEl) { msgEl.textContent = 'Error saving key.'; msgEl.style.color = '#ff8888'; msgEl.style.display = 'block'; }
    }
  }

  // ── Send Message (Bug #13 Fix: set isLoading synchronously) ────
  async function sendUserMessage() {
    // Bug #13 Fix: Set isLoading = true IMMEDIATELY and synchronously
    // before any awaits. This is the only reliable guard against rapid
    // double-tap / race conditions.
    if (isLoading) return;
    setLoading(true);

    const input = q('#nagasai-input');
    const text = input?.value.trim() || '';
    if (!text && !attachedScreenshotUrl) {
      setLoading(false);
      return;
    }

    const imgData = attachedScreenshotUrl;
    input.value = '';
    removeScreenshot();

    const msg = { role: 'user', content: text, image: imgData };
    chatHistory.push(msg);

    // Bug #4 Fix: Strip image data from history before persisting to storage.
    // Screenshots are kept in memory (chatHistory) for the current session
    // but are NOT stored in chrome.storage.local to avoid quota overflow.
    // A single base64 JPEG can be 100-300KB; 30 of them would hit the 10MB limit.
    saveChatHistory();

    try { renderMessages(); } catch (e) {
      chatHistory.push({ role: 'assistant', content: `⚠️ Render Error: ${e.message}` });
      renderMessages();
      setLoading(false);
      return;
    }

    renderMessages(); // show typing indicator

    try {
      const pageContent = extractPageContent() || 'No content found.';
      const systemPrompt = `You are NagaSai AI, a friendly, intelligent, and conversational browser assistant.

Instructions:
1. VERY IMPORTANT: Keep your conversational responses EXTREMELY short and concise, exactly like a natural human chat (e.g., 1-2 sentences). Do NOT write long essays unless explicitly asked.
2. If the user asks a simple question, reply briefly. Do NOT summarize or mention the page content unless the user specifically asks about it.
3. ONLY analyze the "PAGE CONTENT" below if the user's prompt references the page/text on the screen, OR if the user asks for code/answers to a problem (assume the problem is in the page content).
4. When providing code, ALWAYS wrap it in proper markdown code blocks (e.g., \`\`\`python ... \`\`\`). Do NOT use bold text for code. Provide direct, correct code solutions without unnecessary explanation.
5. Keep formatting clean and easy to read. Use bold text for emphasis and bullet points only when necessary.

Current Page Title: "${document.title}"
URL: ${window.location.href}

=== PAGE CONTENT ===
${pageContent}
===================
`;

      // Bug #5 Fix: Only send the last MAX_CONTEXT_MESSAGES messages to the LLM.
      // This prevents token explosion on long conversations and avoids sending
      // all stored screenshots (which are already stripped from persistence).
      const contextHistory = chatHistory.slice(-MAX_CONTEXT_MESSAGES).map((msg, idx, arr) => {
        // Keep the image ONLY if it's the very last message in the history
        if (idx === arr.length - 1) return { ...msg };
        if (msg.image) return { ...msg, image: null, content: msg.content + "\n*(Previous image omitted to save quota)*" };
        return { ...msg };
      });
      const messages = [{ role: 'system', content: systemPrompt }, ...contextHistory];

      // Smart Fallback Chain
      const fallbackChain = [
        { provider: selectedProvider, model: selectedModel, label: 'Selected AI' },
        { provider: 'google', model: 'gemini-3.6-flash', label: 'Gemini', available: !!apiKeys.google?.trim() },
        { provider: 'groq', model: 'llama-3.3-70b-versatile', label: 'Groq', available: !!apiKeys.groq?.trim() },
        { provider: 'openrouter', model: 'openrouter/free', label: 'OpenRouter Free', available: !!apiKeys.openrouter?.trim() },
        { provider: 'anthropic', model: 'claude-3-5-haiku-20241022', label: 'Claude Haiku', available: !!apiKeys.anthropic?.trim() },
        { provider: 'pollinations', model: 'openai', label: 'Free AI (No Key)', available: true }
      ].filter((item, index, self) => 
        (index === 0 || item.available) && 
        (index === 0 || !self.slice(0, index).some(x => x.provider === item.provider && x.model === item.model))
      );

      const assistantMsgIdx = chatHistory.length;
      chatHistory.push({ role: 'assistant', content: '' });
      renderMessages();
      setTimeout(() => scrollToNewAssistantMessage(), 30);

      let fullResponse = '';
      let lastError = null;

      for (let i = 0; i < fallbackChain.length; i++) {
        const attempt = fallbackChain[i];

        if (i > 0) {
          const errorMsg = lastError ? lastError.message : 'Unknown error';
          chatHistory.push({
            role: 'assistant',
            content: `⚠️ **${fallbackChain[i-1].label} API Error:** ${errorMsg}\n\nSwitching to ${attempt.label}...`
          });
          renderMessages();
          await new Promise(r => setTimeout(r, 500));
        }

        try {
          await new Promise((resolve, reject) => {
            currentPort = chrome.runtime.connect({ name: 'llm_stream' });
            currentPort.postMessage({ type: T.START_GENERATION, payload: { provider: attempt.provider, model: attempt.model, messages } });

            currentPort.onMessage.addListener((msg) => {
              if (msg.type === 'CHUNK') {
                fullResponse = msg.accumulated;
                chatHistory[chatHistory.length - 1].content = msg.accumulated;
                renderMessages();
              } else if (msg.type === 'DONE') {
                fullResponse = msg.response;
                chatHistory[chatHistory.length - 1].content = msg.response;
                saveChatHistory();
                renderMessages();
                currentPort = null;
                resolve();
              } else if (msg.type === 'ERROR') {
                currentPort = null;
                reject(new Error(msg.error));
              }
            });
            
            // Handle disconnect if background script crashes
            currentPort.onDisconnect.addListener(() => {
              if (currentPort) {
                currentPort = null;
                reject(new Error('Extension background script disconnected unexpectedly.'));
              }
            });
          });
          
          if (fullResponse) break; // Success!

        } catch (err) {
          lastError = err;
          console.log(`[NagaSai] Provider "${attempt.provider}" failed: ${err.message}`);
          
          // If aborted by user, stop chain
          if (err.message.includes('Generation stopped by user') || err.message.includes('aborted')) {
            break;
          }
        }
      }

      setLoading(false);
      if (!fullResponse) {
        chatHistory.push({ role: 'assistant', content: `⚠️ **Exception**: ${lastError?.message || 'Unknown error. Check your API key in Settings.'}` });
        saveChatHistory();
        renderMessages();
        setTimeout(() => scrollToNewAssistantMessage(), 30);
      }
    } catch (e) {
      setLoading(false);
    }
  }

  // Bug #4 Fix: Helper to save chat history WITHOUT image data
  function saveChatHistory() {
    const historyToSave = chatHistory.map(msg => {
      if (msg.image) return { ...msg, image: null }; // strip base64 image blobs
      return msg;
    });
    chrome.storage.local.set({ [K.CHAT_HISTORY]: historyToSave });
  }

  // ── Page Content Extractor ─────────────────────────────────────
  function extractPageContent() {
    // Specialized Code Editor Extraction (LeetCode, Monaco, etc.)
    let editorContent = "";
    try {
      const editor = document.querySelector('.monaco-editor');
      if (editor) {
        const lines = editor.querySelectorAll('.view-line');
        if (lines.length > 0) {
          editorContent = Array.from(lines).map(l => l.innerText).join('\n');
        }
      }
      if (!editorContent) {
        const ta = document.querySelector('textarea[class*="editor"], .ace_text-input, .monaco-mouse-cursor-text');
        if (ta && ta.value) editorContent = ta.value;
      }
    } catch (_) { }

    const skipTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'HEAD']);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p || skipTags.has(p.tagName)) return NodeFilter.FILTER_REJECT;
        if (p.closest('nav,footer,header,[role="navigation"],[role="banner"]')) return NodeFilter.FILTER_REJECT;
        return node.textContent.trim().length > 1 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });

    const textChunks = [];
    let n;
    while ((n = walker.nextNode())) {
      textChunks.push(n.textContent.trim());
    }

    // Process page text: collapse spaces but keep some structure
    let combinedText = textChunks.join(' ').replace(/\s+/g, ' ').trim();

    // Combine with code editor content (preserving newlines in code)
    let finalContent = "";
    if (editorContent) {
      finalContent += "--- CODE EDITOR CONTENT ---\n" + editorContent + "\n------------------------\n\n";
    }
    finalContent += combinedText;

    return finalContent.slice(0, 7000);
  }

  // ── UI Helpers ─────────────────────────────────────────────────
  function q(selector) { return panel.querySelector(selector); }
  function show(el) { if (el) el.classList.add('ns-show'); }
  function hide(el) { if (el) el.classList.remove('ns-show'); }

  function renderView() {
    const chatScreen = q('#nagasai-chat-screen');
    const settingsScreen = q('#nagasai-settings-screen');
    const toolbar = q('#nagasai-toolbar');
    
    if (!chatScreen) return;

    hide(chatScreen); hide(settingsScreen); hide(toolbar);

    if (currentView === 'settings') {
      show(settingsScreen); populateSettingsUser();
    } else {
      show(chatScreen);
      renderProviderSelect(); renderMessages();
    }
  }

  function populateSettingsUser() {
    const kGoogle = q('#nagasai-key-google');
    const kGroq = q('#nagasai-key-groq');
    const kOpenAI = q('#nagasai-key-openai');
    const kAnthropic = q('#nagasai-key-anthropic');
    const kOpenRouter = q('#nagasai-key-openrouter');
    const kCustom = q('#nagasai-key-custom');
    const kCustomUrl = q('#nagasai-key-customurl');
    const kCustomModel = q('#nagasai-key-custommodel');
    if (kGoogle) kGoogle.value = apiKeys.google || '';
    if (kGroq) kGroq.value = apiKeys.groq || '';
    if (kOpenAI) kOpenAI.value = apiKeys.openai || '';
    if (kAnthropic) kAnthropic.value = apiKeys.anthropic || '';
    if (kOpenRouter) kOpenRouter.value = apiKeys.openrouter || '';
    if (kCustom) kCustom.value = apiKeys.customKey || '';
    if (kCustomUrl) kCustomUrl.value = apiKeys.customUrl || '';
    if (kCustomModel) kCustomModel.value = apiKeys.customModel || '';
    const kSmart = q('#nagasai-key-smart');
    if (kSmart) kSmart.value = '';
  }

  function renderProviderSelect() {
    const sel = q('#nagasai-provider-select');
    if (!sel) return;
    const activeProviders = Object.entries(PROVIDERS).filter(([pId, p]) => {
      if (!p.requiresKey) return true;
      if (pId === 'custom') return !!(apiKeys.customUrl && apiKeys.customUrl.trim());
      return !!(apiKeys[pId] && apiKeys[pId].trim());
    });
    if (!activeProviders.find(([pId]) => pId === selectedProvider)) {
      selectedProvider = activeProviders.length > 0 ? activeProviders[0][0] : 'pollinations';
    }
    sel.innerHTML = activeProviders.map(([pId, p]) =>
      `<option value="${pId}" ${pId === selectedProvider ? 'selected' : ''}>${p.label}</option>`
    ).join('');
    renderModelSelect();
  }

  function renderModelSelect() {
    const sel = q('#nagasai-model-select');
    if (!sel) return;
    const models = PROVIDERS[selectedProvider]?.models || [];
    if (!models.find(([mId]) => mId === selectedModel)) selectedModel = models.length > 0 ? models[0][0] : '';
    sel.innerHTML = models.map(([mId, label]) =>
      `<option value="${mId}" ${mId === selectedModel ? 'selected' : ''}>${label}</option>`
    ).join('');
  }

  function renderMessages() {
    const container = q('#nagasai-messages');
    if (!container) return;

    if (chatHistory.length === 0) {
      const title = document.title.slice(0, 45) + (document.title.length > 45 ? '…' : '');
      // Bug #12 Fix: Use data-suggestion attributes + event delegation instead
      // of inline onclick handlers, which are fragile inside Shadow DOM.
      container.innerHTML = `
        <div class="nagasai-empty-state">
          <div class="nagasai-empty-icon">🔍</div>
          <p>Ask me anything about this page</p>
          <span class="nagasai-page-title">"${title}"</span>
          <div class="nagasai-suggestions">
            <button class="nagasai-suggestion" data-suggestion="Summarize this page">Summarize this page</button>
            <button class="nagasai-suggestion" data-suggestion="What are the key points?">Key points</button>
            <button class="nagasai-suggestion" data-suggestion="Explain this in simple terms">Explain simply</button>
          </div>
        </div>`;
      return;
    }

    container.innerHTML = '';
    chatHistory.forEach((msg, i) => {
      // Don't render empty assistant messages (the loader handles this state visually)
      if (msg.role === 'assistant' && !msg.content) return;

      const msgWrapper = document.createElement('div');
      msgWrapper.className = `nagasai-msg nagasai-msg--${msg.role}`;
      msgWrapper.dataset.index = i;

      if (msg.role === 'assistant') {
        const label = document.createElement('div');
        label.className = 'nagasai-msg-label';
        label.textContent = 'Assistant';
        msgWrapper.appendChild(label);
      }

      const bubble = document.createElement('div');
      bubble.className = 'nagasai-msg-bubble';

      if (msg.image) {
        const img = document.createElement('img');
        img.src = msg.image;
        img.style.cssText = 'max-width:100%;border-radius:4px;margin-bottom:6px;display:block;';
        bubble.appendChild(img);
      }

      if (msg.role === 'user') {
        bubble.appendChild(document.createTextNode(msg.content));
      } else {
        bubble.innerHTML += formatMessage(msg.content);
      }

      msgWrapper.appendChild(bubble);
      container.appendChild(msgWrapper);
    });

    const lastMsg = chatHistory[chatHistory.length - 1];
    const isWaitingForFirstChunk = isLoading && lastMsg && lastMsg.role === 'assistant' && !lastMsg.content;

    if (isWaitingForFirstChunk) {
      const loader = document.createElement('div');
      loader.className = 'nagasai-msg nagasai-msg--assistant';
      loader.innerHTML = `<div class="nagasai-msg-label">Assistant</div><div class="nagasai-msg-bubble nagasai-typing"><span></span><span></span><span></span></div>`;
      container.appendChild(loader);
    }

    scrollToBottom();
  }



  function setLoading(isLoad) {
    isLoading = isLoad;
    const sendBtn = q('#nagasai-send-btn');
    const input = q('#nagasai-input');
    if (isLoad) {
      if (sendBtn) {
        sendBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" ry="2"/></svg>';
        sendBtn.style.color = '#ff4a4a';
      }
    } else {
      if (sendBtn) {
        sendBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';
        sendBtn.style.color = '';
      }
    }
    if (input) input.disabled = isLoad;
  }

  // ── Drag ───────────────────────────────────────────────────────
  function startDrag(e) {
    if (e.target.closest('button,select,input')) return;
    isDragging = true;
    const r = panel.getBoundingClientRect();
    dragOffsetX = e.clientX - r.left;
    dragOffsetY = e.clientY - r.top;
    panel.style.transition = 'none';
    e.preventDefault();
  }
  function onDrag(e) {
    if (!isDragging) return;
    if (e.buttons === 0) {
      stopDrag();
      return;
    }
    panel.style.left = `${e.clientX - dragOffsetX}px`;
    panel.style.top = `${e.clientY - dragOffsetY}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }
  function stopDrag() { isDragging = false; panel.style.transition = ''; }

  // ── Mic / Voice Input (Web Speech API) ────────────────────────
  function setupMicButton() {
    const micBtn = q('#nagasai-mic-btn');
    if (!micBtn) return;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      micBtn.title = 'Voice input not supported in this browser';
      micBtn.style.opacity = '0.3';
      micBtn.style.cursor = 'not-allowed';
      return;
    }

    let recognition = null;
    let isRecording = false;
    let finalTranscript = '';

    micBtn.addEventListener('click', () => {
      if (isRecording) {
        recognition?.stop();
        return;
      }

      finalTranscript = '';
      recognition = new SR();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        isRecording = true;
        micBtn.classList.add('nagasai-mic-recording');
        micBtn.title = 'Recording… click to stop';
      };

      recognition.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript + ' ';
          } else {
            interim += event.results[i][0].transcript;
          }
        }
        const input = q('#nagasai-input');
        if (input) input.value = (finalTranscript + interim).trim();
      };

      recognition.onend = () => {
        isRecording = false;
        micBtn.classList.remove('nagasai-mic-recording');
        micBtn.title = 'Voice input — click to start, click again to stop';
        // Clean up any trailing space
        const input = q('#nagasai-input');
        if (input) input.value = input.value.trim();
        recognition = null;
      };

      recognition.onerror = (e) => {
        isRecording = false;
        micBtn.classList.remove('nagasai-mic-recording');
        micBtn.title = 'Voice input — click to start, click again to stop';
        recognition = null;
        if (e.error !== 'aborted') {
          const input = q('#nagasai-input');
          if (input && !input.value) input.placeholder = 'Mic error: ' + e.error;
          setTimeout(() => { if (input) input.placeholder = 'Ask, Learn, Understand…'; }, 3000);
        }
      };

      recognition.start();
    });
  }

  // ── Scroll to start of newest assistant response ───────────────
  // Called after AI response is received so the user reads from
  // the top of the answer — not from the bottom (like ChatGPT).
  function scrollToNewAssistantMessage() {
    const container = q('#nagasai-messages');
    if (!container) return;
    const msgs = container.querySelectorAll('.nagasai-msg--assistant');
    if (msgs.length === 0) return;
    const lastMsg = msgs[msgs.length - 1];
    container.scrollTop = lastMsg.offsetTop - 8;
  }

  // ── Utility ────────────────────────────────────────────────────
  // Bug #9 Fix: sendMsg now distinguishes context errors from API errors
  // so the user sees a meaningful message instead of "undefined".
  function sendMsg(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (response) => {
          if (chrome.runtime.lastError) {
            // Extension context error — background script may have restarted.
            resolve({
              success: false,
              error: 'Extension disconnected. Please reload the page and try again.'
            });
          } else {
            resolve(response ?? null);
          }
        });
      } catch (_) {
        resolve({
          success: false,
          error: 'Extension context error. Reload the page to fix this.'
        });
      }
    });
  }



  // ── Screenshot Handlers ────────────────────────────────────────
  async function handleScreenshotCapture() {
    const btn = q('#nagasai-screenshot-btn');
    if (!btn) return;
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '...';
    panelRoot.style.opacity = '0';
    await new Promise(r => setTimeout(r, 100));

    try {
      const res = await sendMsg({ type: T.CAPTURE_SCREENSHOT });
      if (res && res.success) {
        attachedScreenshotUrl = res.dataUrl;
        q('#nagasai-screenshot-preview').src = attachedScreenshotUrl;
        q('#nagasai-screenshot-preview-wrap').classList.add('ns-show');
      } else {
        chatHistory.push({ role: 'assistant', content: `⚠️ **Vision Error**: ${res?.error || 'Could not capture screenshot. Reload extension to accept permissions.'}` });
        renderMessages();
      }
    } catch (_) {
      chatHistory.push({ role: 'assistant', content: `⚠️ **Vision Error**: Background script disconnected. Reload the page.` });
      renderMessages();
    }

    panelRoot.style.opacity = '1';
    btn.innerHTML = originalHTML;
  }

  function removeScreenshot() {
    attachedScreenshotUrl = null;
    const img = q('#nagasai-screenshot-preview');
    const wrap = q('#nagasai-screenshot-preview-wrap');
    if (img) img.src = '';
    if (wrap) wrap.classList.remove('ns-show');
  }

  function scrollToBottom() {
    const container = q('#nagasai-messages');
    if (container) container.scrollTop = container.scrollHeight;
  }

})();
