// Page side panel script

(function () {
  // Obfuscated message types (must match background.js)
  const T = {
    SIGN_IN: '_r1',
    SIGN_OUT: '_r2',
    GET_AUTH_STATE: '_r3',
    GET_API_KEYS: '_r4',
    SAVE_API_KEYS: '_r5',
    LLM_REQUEST: '_r6',
    CAPTURE_SCREENSHOT: '_r7',
    OPEN_SIDEPANEL: '_r8',
    PULL_PAGE_CONTENT: '_ra',
    OPEN_FLOATING: '_rc',
  };
  const K = { CHAT_HISTORY: '_c1', PREFERRED_MODE: '_c2', IS_GUEST: '_c3' };
  const PORT_NAME = '_p0rt_sp';

  // Bug #5 Fix: Sliding window — only send last N messages to LLM
  if (document.getElementById('nagasai-root')) return;

  // ── Pull Shared Logic ──────────────────────────────────────────
  const { PROVIDERS, MAX_CONTEXT_MESSAGES, formatMessage } = window.NagaSaiShared;

  // ─── State ──────────────────────────────────────────────
  let panelOpen = false;
  let currentView = 'chat';
  let authState = { signedIn: false, user: null, token: null };
  let apiKeys = { google: '', groq: '', openai: '', customKey: '', customUrl: '', customModel: '' };
  let chatHistory = [];
  let selectedProvider = 'pollinations';
  let selectedModel = 'openai';
  let isLoading = false;
  let isDragging = false;
  let dragOffsetX = 0, dragOffsetY = 0;
  let attachedScreenshotUrl = null;

  // ─── Build & Inject UI ───────────────────────────────────
  const panelRoot = document.createElement('div');
  panelRoot.id = 'nagasai-root';

  // Apply saved theme preference immediately
  const storedTheme = localStorage.getItem('_xt');
  if (storedTheme === 'light') panelRoot.classList.add('ns-light-theme');
  else if (storedTheme === 'dark') panelRoot.classList.add('ns-dark-theme');

  panelRoot.innerHTML = window.NagaSaiShared.buildPanelHTML(true);
  document.body.appendChild(panelRoot);

  const panel = panelRoot.querySelector('#nagasai-panel');

  // Force full-screen open immediately since it's the side panel
  panelOpen = true;
  panel.classList.add('nagasai-panel--open');

  // Notify background script we are open so it hides the floating toggle
  const port = chrome.runtime.connect({ name: PORT_NAME });

  // Listen for commands from background.js sent directly through the port.
  // FORCE_CLOSE is sent when the user activates stealth mode (Alt+Shift+H).
  // window.close() is the ONLY reliable way to close the side panel from inside.
  port.onMessage.addListener((msg) => {
    if (msg.type === 'FORCE_CLOSE') {
      window.close();
    }
  });

  chrome.storage.local.get([K.CHAT_HISTORY, K.IS_GUEST], (data) => {
    if (data[K.CHAT_HISTORY]) chatHistory = data[K.CHAT_HISTORY];
    if (data[K.IS_GUEST]) {
      handleAlternativeBrowserMode(true); // silent restore
    }
  });

  // Listen for storage changes (chat history sync across tabs/panels)
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes[K.CHAT_HISTORY]) {
      chatHistory = changes[K.CHAT_HISTORY].newValue || [];
      if (currentView === 'chat') renderMessages();
    }
  });

  // Show sign-in screen immediately (prevents blank screen flash)
  renderView();

  // Then async check real auth state
  (async () => {
    await refreshAuthState();
    setupEventListeners();
  })();



  // ─── Auth ────────────────────────────────────────────────
  async function refreshAuthState() {
    try {
      const res = await sendMessage({ type: T.GET_AUTH_STATE });
      if (res && res.signedIn !== undefined) authState = res;
      const keysRes = await sendMessage({ type: T.GET_API_KEYS });
      if (keysRes && keysRes.keys) apiKeys = keysRes.keys;
    } catch (_) { }
    renderView();
  }

  // ─── Event Listeners ─────────────────────────────────────
  function setupEventListeners() {
    // Header buttons
    panel.querySelector('#nagasai-floating-btn').addEventListener('click', () => {
      chrome.storage.local.set({ [K.PREFERRED_MODE]: 'floating' });
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        for (const tab of tabs) {
          chrome.tabs.sendMessage(tab.id, { type: T.OPEN_FLOATING }).catch(() => { });
        }
      });
      window.close();
    });

    // ◄ STEALTH BUTTON — the green eye icon in the side panel header.
    // 1. Tells the content script to make the S button invisible (opacity:0, still clickable)
    // 2. Calls window.close() to close the side panel itself
    // To exit stealth: click where the S button was (bottom-right corner of page).
    panel.querySelector('#nagasai-stealth-btn').addEventListener('click', async () => {
      // Hide the S button on the active tab's page
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, { type: T.TOGGLE_STEALTH, entering: true }).catch(() => { });
      }
      // Close the side panel
      window.close();
    });

    panel.querySelector('#nagasai-clear').addEventListener('click', () => {
      chatHistory = [];
      chrome.storage.local.set({ [K.CHAT_HISTORY]: [] });
      renderMessages();
    });

    // Bug #2 Fix: Theme toggle logic correctly reads and updates panelRoot class
    panel.querySelector('#nagasai-theme-btn').addEventListener('click', () => {
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
    });

    panel.querySelector('#nagasai-settings-btn').addEventListener('click', () => {
      currentView = currentView === 'settings' ? 'chat' : 'settings';
      renderView();
    });

    // Delegated clicks for dynamically rendered content
    panel.addEventListener('click', async (e) => {
      if (e.target.closest('#nagasai-signin-btn')) handleSignIn();
      if (e.target.closest('#nagasai-signout-btn')) handleSignOut();
      if (e.target.closest('#nagasai-not-google-link')) {
        e.preventDefault();
        handleAlternativeBrowserMode();
      }
      if (e.target.closest('#nagasai-send-btn')) sendUserMessage();
      if (e.target.closest('#nagasai-save-keys-btn')) saveApiKeys();

      const screenshotBtn = e.target.closest('#nagasai-screenshot-btn');
      if (screenshotBtn) {
        e.preventDefault();
        handleScreenshotCapture();
      }

      const removeScreenshotBtn = e.target.closest('#nagasai-remove-screenshot-btn');
      if (removeScreenshotBtn) {
        e.preventDefault();
        removeScreenshot();
      }

      // Bug #12 Fix: suggestion buttons handled via event delegation + data attributes
      const suggestion = e.target.closest('.nagasai-suggestion');
      if (suggestion) {
        const text = suggestion.dataset.suggestion;
        if (text) {
          const input = panel.querySelector('#nagasai-input');
          if (input) { input.value = text; input.focus(); }
        }
      }

      const copyBtn = e.target.closest('.nagasai-copy-btn');
      if (copyBtn) {
        const codeBlock = copyBtn.closest('.nagasai-code-wrapper').querySelector('code');
        if (codeBlock) {
          try {
            const textToCopy = codeBlock.innerHTML
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&amp;/g, '&');
            await navigator.clipboard.writeText(textToCopy);

            const originalText = copyBtn.textContent;
            copyBtn.textContent = 'Copied!';
            copyBtn.classList.add('copied');
            setTimeout(() => {
              copyBtn.textContent = originalText;
              copyBtn.classList.remove('copied');
            }, 2000);
          } catch (err) {
            console.error('Failed to copy text: ', err);
          }
        }
      }
    });

    // Provider/model selects
    panel.addEventListener('change', (e) => {
      if (e.target.id === 'nagasai-provider-select') {
        selectedProvider = e.target.value;
        selectedModel = PROVIDERS[selectedProvider].models[0][0];
        renderModelSelect();
      }
      if (e.target.id === 'nagasai-model-select') {
        selectedModel = e.target.value;
      }
    });

    // Bug #13 Fix: keydown send — isLoading is set synchronously in sendUserMessage
    panel.addEventListener('keydown', (e) => {
      if (e.target && e.target.id === 'nagasai-input') {
        if ((e.key === 'Enter' || e.keyCode === 13) && !e.shiftKey) {
          e.preventDefault();
          sendUserMessage();
        }
      }
    });

    // Drag (disabled in side panel since it's full-screen, but kept for consistency)
    panel.querySelector('#nagasai-header').addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', stopDrag);

    setupMicButton();
  }

  // ─── Sign In / Out ────────────────────────────────────────
  async function handleSignIn() {
    const btn = panel.querySelector('#nagasai-signin-btn');
    const errEl = panel.querySelector('#nagasai-signin-error');

    if (btn) { btn.textContent = 'Opening Google…'; btn.disabled = true; }
    if (errEl) errEl.textContent = '';

    const res = await Promise.race([
      sendMessage({ type: T.SIGN_IN }),
      new Promise(resolve => setTimeout(() => resolve({ success: false, error: 'Sign-in timed out. Reload extension and try again.' }), 15000))
    ]);

    if (res && res.success) {
      chrome.storage.local.remove(K.IS_GUEST);
      authState = { signedIn: true, user: res.user, token: res.token };
      renderView();
    } else {
      if (btn) { btn.innerHTML = googleBtnContent(); btn.disabled = false; }
      if (errEl) errEl.textContent = res?.error || 'Sign-in failed. Please try again.';
    }
  }

  async function handleSignOut() {
    await sendMessage({ type: T.SIGN_OUT });
    chrome.storage.local.remove(K.IS_GUEST);
    authState = { signedIn: false, user: null, token: null };
    chatHistory = [];
    chrome.storage.local.set({ [K.CHAT_HISTORY]: [] }); // Fix: Clear storage on sign out
    currentView = 'chat';
    renderView();
  }

  function handleAlternativeBrowserMode(silent = false) {
    if (!silent) {
      // Clear storage first to prevent history bleed
      chrome.storage.local.set({ [K.CHAT_HISTORY]: [], [K.IS_GUEST]: true });

      // Set a specialized welcome message
      chatHistory = [{
        role: 'assistant',
        content: '👋 Hi! To use NagaSai AI in this browser, please click the **Settings** button (⚙️) and paste your API key to start.'
      }];
    }

    // Fake a minimal auth state to bypass sign-in screen
    authState = { signedIn: true, user: { name: 'Anonymous', given_name: 'Guest', picture: '' }, token: 'local-only' };

    currentView = 'chat';
    renderView();
    if (!silent) saveChatHistory();
  }

  // ─── Settings / API Keys (Bug #3 Fix: save ALL fields including custom) ─
  async function saveApiKeys() {
    const btn = panel.querySelector('#nagasai-save-keys-btn');
    const msgEl = panel.querySelector('#nagasai-keys-msg');

    if (btn) btn.disabled = true;
    if (msgEl) { msgEl.style.display = 'none'; msgEl.textContent = ''; }

    const inputVal = panel.querySelector('#nagasai-key-smart')?.value.trim() || '';

    let identifiedProvider = null;
    // Bug #3 Fix: Read ALL key fields, preserving existing values for fields not in the form
    let newKeys = {
      google: panel.querySelector('#nagasai-key-google')?.value.trim() ?? apiKeys.google ?? '',
      groq: panel.querySelector('#nagasai-key-groq')?.value.trim() ?? apiKeys.groq ?? '',
      openai: panel.querySelector('#nagasai-key-openai')?.value.trim() ?? apiKeys.openai ?? '',
      customKey: panel.querySelector('#nagasai-key-custom')?.value.trim() ?? apiKeys.customKey ?? '',
      customUrl: panel.querySelector('#nagasai-key-customurl')?.value.trim() ?? apiKeys.customUrl ?? '',
      customModel: panel.querySelector('#nagasai-key-custommodel')?.value.trim() ?? apiKeys.customModel ?? '',
    };

    if (inputVal) {
      if (inputVal.startsWith('AIza')) {
        newKeys.google = inputVal;
        identifiedProvider = 'google';
      } else if (inputVal.startsWith('gsk_')) {
        newKeys.groq = inputVal;
        identifiedProvider = 'groq';
      } else if (inputVal.startsWith('sk-') || inputVal.startsWith('sk-or')) {
        newKeys.openai = inputVal;
        identifiedProvider = 'openai';
      } else {
        identifiedProvider = 'openai'; // Fallback
        newKeys.openai = inputVal;
      }
    }

    const res = await sendMessage({ type: T.SAVE_API_KEYS, payload: newKeys });

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
      renderView();
      renderProviderSelect();
      renderMessages();
    } else {
      if (msgEl) {
        msgEl.textContent = 'Error saving key.';
        msgEl.style.color = '#ff8888';
        msgEl.style.display = 'block';
      }
    }
  }

  // ─── Send Message (Bug #13 Fix: synchronous isLoading guard) ───
  async function sendUserMessage() {
    // Bug #13 Fix: Set isLoading = true IMMEDIATELY before any await.
    if (isLoading) return;
    isLoading = true;

    const input = panel.querySelector('#nagasai-input');
    const text = input?.value.trim() || '';
    if (!text && !attachedScreenshotUrl) {
      isLoading = false;
      return;
    }

    const imgData = attachedScreenshotUrl;

    input.value = '';
    removeScreenshot();

    const msg = { role: 'user', content: text, image: imgData };
    chatHistory.push(msg);

    // Bug #4 Fix: Strip image data before saving to storage
    saveChatHistory();

    const btn = panel.querySelector('#nagasai-send-btn');
    if (btn) btn.disabled = true;
    if (input) input.disabled = true;

    try {
      renderMessages();
    } catch (e) {
      chatHistory.push({ role: 'assistant', content: `⚠️ Render Error: ${e.message}` });
      renderMessages();
      isLoading = false;
      if (btn) btn.disabled = false;
      if (input) input.disabled = false;
      return;
    }

    try {
      const pageContent = await extractPageContent() || 'No content found on page.';
      const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const pageTitle = activeTabs[0]?.title || 'Current Page';
      const pageUrl = activeTabs[0]?.url || 'Unknown URL';

      const systemPrompt = `You are NagaSai AI — a smart, friendly assistant built into a Chrome extension. You operate in three modes depending on the user's intent:

**MODE 1 — CONVERSATION:**
For greetings, casual chat, or general questions not related to the current page — respond naturally and conversationally. Do NOT reference the page content here.

**MODE 2 — PAGE ANALYSIS:**
For questions about the current page content (summarization, explanation, info gathering) — use the provided page content to answer accurately.

**MODE 3 — CODE COMPLETION (CRITICAL):**
If the page contains a code editor (like LeetCode, GitHub, etc.) and the user asks to "complete this", "solve this", or similar:
- STRICTLY preserve all existing class names, method signatures, and parameter lists provided by the platform.
- NEVER rewrite the basic boilerplate; only CONTINUE the logic from where the user left off or fill in the required method.
- Use the same language and coding style as seen in the editor.
- Always provide the full solution including the original given signatures to ensure the code remains a valid, runnable unit.

Always detect the user's intent FIRST before responding.

IMPORTANT: NEVER include any signatures, footer messages, or 'Powered by' statements in your response. Provide only the answer itself.

Current Page: "${pageTitle}"
URL: ${pageUrl}

=== PAGE CONTENT ===
${pageContent}
===================
`;

      // Bug #5 Fix: Only send last MAX_CONTEXT_MESSAGES to avoid token explosion
      const contextHistory = chatHistory.slice(-MAX_CONTEXT_MESSAGES);
      const messages = [
        { role: 'system', content: systemPrompt },
        ...contextHistory
      ];

      const res = await sendMessage({
        type: T.LLM_REQUEST,
        payload: { provider: selectedProvider, model: selectedModel, messages }
      });

      chatHistory.push({
        role: 'assistant',
        content: res?.success
          ? res.response
          : `⚠️ **Engine Error**: ${res?.error || 'No response from AI. Check your API key in Settings.'}`
      });
      saveChatHistory();
      renderMessages();

    } catch (err) {
      chatHistory.push({
        role: 'assistant',
        content: `⚠️ **Exception**: ${err.message || 'Unknown error. Reload the extension and try again.'}`
      });
      saveChatHistory();
      renderMessages();
      setTimeout(() => scrollToNewAssistantMessage(), 30);
    } finally {
      isLoading = false;
      if (btn) btn.disabled = false;
      if (input) input.disabled = false;
    }
  }

  // Bug #4 Fix: Helper — save chat history with images stripped
  function saveChatHistory() {
    const historyToSave = chatHistory.map(msg => {
      if (msg.image) return { ...msg, image: null }; // strip base64 blobs
      return msg;
    });
    chrome.storage.local.set({ [K.CHAT_HISTORY]: historyToSave });
  }

  // ─── Active Tab Content Extractor ────────────────────────
  async function extractPageContent() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs || tabs.length === 0) return 'No active tab found.';
      const res = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tabs[0].id, { type: T.PULL_PAGE_CONTENT }, (response) => { resolve(response); });
      });
      if (res && res.title) document.title = res.title;
      return res?.content || 'No text content found on this page.';
    } catch (_) {
      return 'Unable to read page content.';
    }
  }

  function hasAnyKey() {
    return !!(
      (apiKeys.google && apiKeys.google.trim()) ||
      (apiKeys.groq && apiKeys.groq.trim()) ||
      (apiKeys.openai && apiKeys.openai.trim()) ||
      (apiKeys.customUrl && apiKeys.customUrl.trim())
    );
  }

  // ─── UI Helpers ───────────────────────────────────────────────
  function show(el) { if (el) el.classList.add('ns-show'); }
  function hide(el) { if (el) el.classList.remove('ns-show'); }

  function renderView() {
    const signInScreen = panel.querySelector('#nagasai-signin-screen');
    const chatScreen = panel.querySelector('#nagasai-chat-screen');
    const settingsScreen = panel.querySelector('#nagasai-settings-screen');
    const toolbar = panel.querySelector('#nagasai-toolbar');

    if (!signInScreen) return;

    hide(signInScreen); hide(chatScreen); hide(settingsScreen); hide(toolbar);

    const isGuest = authState.token === 'local-only';
    const noKeys = !hasAnyKey();
    const isLocked = isGuest && noKeys;

    if (!authState.signedIn) {
      show(signInScreen);
    } else if (currentView === 'settings') {
      show(toolbar);
      show(settingsScreen);
      populateSettingsUser();
    } else {
      show(toolbar);
      show(chatScreen);
      chatScreen.classList.toggle('nagasai-chat-screen--locked', isLocked);

      if (isLocked) {
        let lockedMsg = panel.querySelector('#nagasai-locked-message');
        if (!lockedMsg) {
          lockedMsg = document.createElement('div');
          lockedMsg.id = 'nagasai-locked-message';
          lockedMsg.innerHTML = `
            <div style="font-size:40px; margin-bottom:20px; opacity:0.5;">🔒</div>
            <p style="font-size:14px; line-height:1.6;">Add an api key in settings page to use nagasai extension</p>`;
          chatScreen.appendChild(lockedMsg);
        }
      } else {
        renderProviderSelect();
        renderMessages();
      }
    }

    if (authState.signedIn && authState.user) {
      const nameEl = panel.querySelector('#nagasai-username');
      const avatarEl = panel.querySelector('#nagasai-avatar');
      if (nameEl) nameEl.textContent = authState.user.given_name || authState.user.name || 'User';
      if (avatarEl && authState.user.picture) {
        avatarEl.src = authState.user.picture;
        avatarEl.classList.add('ns-show');
      }
    }
  }

  function populateSettingsUser() {
    const u = authState.user;
    const el = panel.querySelector('#nagasai-settings-user');
    if (el && u) {
      el.innerHTML = `
        <img src="${u.picture || ''}" alt="avatar" class="nagasai-settings-avatar"/>
        <div>
          <div class="nagasai-settings-name">${u.name || ''}</div>
          <div class="nagasai-settings-email">${u.email || ''}</div>
        </div>`;
    }

    const kGoogle = panel.querySelector('#nagasai-key-google');
    const kGroq = panel.querySelector('#nagasai-key-groq');
    const kOpenAI = panel.querySelector('#nagasai-key-openai');
    const kCustom = panel.querySelector('#nagasai-key-custom');
    const kCustomUrl = panel.querySelector('#nagasai-key-customurl');
    const kCustomModel = panel.querySelector('#nagasai-key-custommodel');

    if (kGoogle) kGoogle.value = apiKeys.google || '';
    if (kGroq) kGroq.value = apiKeys.groq || '';
    if (kOpenAI) kOpenAI.value = apiKeys.openai || '';
    if (kCustom) kCustom.value = apiKeys.customKey || '';
    if (kCustomUrl) kCustomUrl.value = apiKeys.customUrl || '';
    if (kCustomModel) kCustomModel.value = apiKeys.customModel || '';

    const kSmart = panel.querySelector('#nagasai-key-smart');
    if (kSmart) kSmart.value = '';
  }

  function renderProviderSelect() {
    const sel = panel.querySelector('#nagasai-provider-select');
    if (!sel) return;

    const isGuest = authState.token === 'local-only';
    const activeProviders = Object.entries(PROVIDERS).filter(([pId, p]) => {
      if (isGuest && pId === 'pollinations') return false; // Fix: Hide Free AI for guest mode
      if (!p.requiresKey) return true;
      if (pId === 'custom') return !!(apiKeys.customUrl && apiKeys.customUrl.trim());
      return !!(apiKeys[pId] && apiKeys[pId].trim() !== '');
    });

    if (!activeProviders.find(([pId]) => pId === selectedProvider)) {
      selectedProvider = activeProviders.length > 0 ? activeProviders[0][0] : 'pollinations';
    }

    sel.innerHTML = activeProviders
      .map(([pId, p]) => `<option value="${pId}" ${pId === selectedProvider ? 'selected' : ''}>${p.label}</option>`)
      .join('');

    renderModelSelect();
  }

  function renderModelSelect() {
    const sel = panel.querySelector('#nagasai-model-select');
    if (!sel) return;

    const models = PROVIDERS[selectedProvider]?.models || [];

    if (!models.find(([mId]) => mId === selectedModel)) {
      selectedModel = models.length > 0 ? models[0][0] : '';
    }

    sel.innerHTML = models
      .map(([mId, label]) => `<option value="${mId}" ${mId === selectedModel ? 'selected' : ''}>${label}</option>`)
      .join('');
  }

  function renderMessages() {
    const container = panel.querySelector('#nagasai-messages');
    if (!container) return;

    if (chatHistory.length === 0) {
      const title = document.title.slice(0, 45) + (document.title.length > 45 ? '…' : '');
      // Bug #12 Fix: use data-suggestion + event delegation, no inline onclick
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
        img.style.maxWidth = '100%';
        img.style.borderRadius = '4px';
        img.style.marginBottom = '6px';
        img.style.display = 'block';
        bubble.appendChild(img);
      }

      if (msg.role === 'user') {
        const textNode = document.createTextNode(msg.content);
        bubble.appendChild(textNode);
      } else {
        bubble.innerHTML += formatMessage(msg.content);
      }

      msgWrapper.appendChild(bubble);
      container.appendChild(msgWrapper);
    });

    if (isLoading) {
      const loader = document.createElement('div');
      loader.className = 'nagasai-msg nagasai-msg--assistant';
      loader.innerHTML = `
        <div class="nagasai-msg-label">Assistant</div>
        <div class="nagasai-msg-bubble nagasai-typing"><span></span><span></span><span></span></div>
      `;
      container.appendChild(loader);
    }

    scrollToBottom();
  }



  // Bug #11 Fix: Removed the unused escapeHTML() function that was dead code.

  function setLoading(state) {
    isLoading = state;
    const btn = panel.querySelector('#nagasai-send-btn');
    const input = panel.querySelector('#nagasai-input');
    if (btn) btn.disabled = state;
    if (input) input.disabled = state;
    renderMessages();
  }

  // ─── Drag ────────────────────────────────────────────────
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
    const x = e.clientX - dragOffsetX;
    const y = e.clientY - dragOffsetY;
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }
  function stopDrag() { isDragging = false; panel.style.transition = ''; }

  // ─── Mic / Voice Input (Web Speech API) ─────────────────────
  function setupMicButton() {
    const micBtn = panel.querySelector('#nagasai-mic-btn');
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

    micBtn.addEventListener('click', async () => {
      if (isRecording) { recognition?.stop(); return; }

      // Chrome requires an explicit getUserMedia call for extension pages
      // (side panel runs at chrome-extension:// origin). This triggers the
      // permission prompt once; subsequent clicks work immediately.
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop()); // permission granted — stop immediately
      } catch (permErr) {
        const input = panel.querySelector('#nagasai-input');
        if (input) {
          input.placeholder = 'Microphone access denied — allow it in browser settings';
          setTimeout(() => { input.placeholder = 'Ask, Learn, Understand…'; }, 4000);
        }
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
        const input = panel.querySelector('#nagasai-input');
        if (input) input.value = (finalTranscript + interim).trim();
      };

      recognition.onend = () => {
        isRecording = false;
        micBtn.classList.remove('nagasai-mic-recording');
        micBtn.title = 'Voice input — click to start, click again to stop';
        const input = panel.querySelector('#nagasai-input');
        if (input) input.value = input.value.trim();
        recognition = null;
      };

      recognition.onerror = (e) => {
        isRecording = false;
        micBtn.classList.remove('nagasai-mic-recording');
        micBtn.title = 'Voice input — click to start, click again to stop';
        recognition = null;
        if (e.error !== 'aborted') {
          const input = panel.querySelector('#nagasai-input');
          if (input && !input.value) input.placeholder = 'Mic error: ' + e.error;
          setTimeout(() => { if (input) input.placeholder = 'Ask, Learn, Understand…'; }, 3000);
        }
      };

      recognition.start();
    });
  }

  // ─── Scroll to top of newest assistant message ───────────────
  function scrollToNewAssistantMessage() {
    const container = panel.querySelector('#nagasai-messages');
    if (!container) return;
    const msgs = container.querySelectorAll('.nagasai-msg--assistant');
    if (msgs.length === 0) return;
    container.scrollTop = msgs[msgs.length - 1].offsetTop - 8;
  }

  // ─── Utility ─────────────────────────────────────────────
  // Bug #9 Fix: Return a structured error instead of null so callers
  // get a meaningful message rather than showing "undefined" to the user.
  function sendMessage(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (response) => {
          if (chrome.runtime.lastError) {
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



  // ─── Screenshot Handlers ─────────────────────────────────
  async function handleScreenshotCapture() {
    const btn = panel.querySelector('#nagasai-screenshot-btn');
    if (!btn) return;
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '...';

    panelRoot.style.opacity = '0';
    await new Promise(r => setTimeout(r, 100));

    try {
      const res = await sendMessage({ type: T.CAPTURE_SCREENSHOT });
      if (res && res.success) {
        attachedScreenshotUrl = res.dataUrl;
        panel.querySelector('#nagasai-screenshot-preview').src = attachedScreenshotUrl;
        panel.querySelector('#nagasai-screenshot-preview-wrap').classList.add('ns-show');
      } else {
        chatHistory.push({
          role: 'assistant',
          content: `⚠️ **Vision Error**: ${res?.error || 'Could not capture screenshot. Reload extension to accept permissions.'}`
        });
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
    const img = panel.querySelector('#nagasai-screenshot-preview');
    const wrap = panel.querySelector('#nagasai-screenshot-preview-wrap');
    if (img) img.src = '';
    if (wrap) wrap.classList.remove('ns-show');
  }

  function scrollToBottom() {
    const container = panel.querySelector('#nagasai-messages');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }

})();