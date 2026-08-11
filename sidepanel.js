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
    OPEN_SIDEPANEL: '_r10',
    TOGGLE_PRIVACY: '_rd',
    PULL_PAGE_CONTENT: '_ra',
    OPEN_FLOATING: '_rc',
    START_GENERATION: 'START_GENERATION',
    STOP_GENERATION: 'STOP_GENERATION'
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
  let currentPort = null;
  let authState = { signedIn: false, user: null, token: null };
  let apiKeys = { google: '', groq: '', openai: '', anthropic: '', openrouter: '', customKey: '', customUrl: '', customModel: '' };
  let chatHistory = [];
  let selectedProvider = 'pollinations';
  let selectedModel = 'openai';
  let isLoading = false;
  let isDragging = false;
  let dragOffsetX = 0, dragOffsetY = 0;
  let attachedScreenshotUrl = null;
  let attachedFileName = null;
  let attachedFileText = null;
  let isFileUploading = false;

  if (typeof pdfjsLib !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('libs/pdf.worker.min.js');
  }

  // ─── Build & Inject UI ───────────────────────────────────
  const panelRoot = document.createElement('div');
  panelRoot.id = 'nagasai-root';

  panelRoot.innerHTML = window.NagaSaiShared.buildPanelHTML(true);
  document.body.appendChild(panelRoot);

  const panel = panelRoot.querySelector('#nagasai-panel');

  // Apply saved theme and opacity preference immediately
  const storedTheme = localStorage.getItem('_xt') || 'dark';
  if (storedTheme === 'light') panelRoot.classList.add('ns-light-theme');
  else panelRoot.classList.add('ns-dark-theme');

  function syncShellBackground() {
    const isLight = panelRoot.classList.contains('ns-light-theme');
    const shellColor = isLight ? '#ffffff' : '#161616';
    document.documentElement.style.background = shellColor;
    document.body.style.background = shellColor;
  }

  syncShellBackground();

  panelRoot.style.opacity = '1';

  // Force full-screen open immediately since it's the side panel
  panelOpen = true;
  panel.classList.add('nagasai-panel--open');

  // Notify background script we are open so it hides the floating toggle
  const port = chrome.runtime.connect({ name: PORT_NAME });

  // Listen for commands from background.js sent directly through the port.
  // FORCE_CLOSE is sent when the user activates privacy mode (Alt+Shift+H).
  // window.close() is the ONLY reliable way to close the side panel from inside.
  port.onMessage.addListener((msg) => {
    if (msg.type === 'FORCE_CLOSE') {
      window.close();
    }
  });

  chrome.storage.local.get([K.CHAT_HISTORY, K.IS_GUEST], (data) => {
    if (data[K.CHAT_HISTORY]) {
      chatHistory = data[K.CHAT_HISTORY];
      if (currentView === 'chat') renderMessages();
    }
    if (data[K.IS_GUEST]) {
      handleAlternativeBrowserMode(true); // silent restore
    }
  });

  // Listen for storage changes (chat history sync across tabs/panels)
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes[K.CHAT_HISTORY]) {
      if (!isLoading) {
        chatHistory = changes[K.CHAT_HISTORY].newValue || [];
        if (currentView === 'chat') renderMessages();
      }
    }
      if (namespace === 'sync' && changes._s4) {
        apiKeys = changes._s4.newValue || apiKeys;
        renderView();
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

    // ◄ PRIVACY BUTTON — the green eye icon in the side panel header.
    // 1. Tells the content script to make the S button invisible (opacity:0, still clickable)
    // 2. Calls window.close() to close the side panel itself
    // To exit privacy mode: click where the S button was (bottom-right corner of page).
    panel.querySelector('#nagasai-privacy-btn').addEventListener('click', async () => {
      // Hide the S button on the active tab's page
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, { type: T.TOGGLE_PRIVACY, entering: true }).catch(() => { });
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

      syncShellBackground();
    });

    panel.querySelector('#nagasai-settings-btn').addEventListener('click', () => {
      currentView = currentView === 'settings' ? 'chat' : 'settings';
      renderView();
    });

    // Delegated clicks for dynamically rendered content
    panel.addEventListener('click', (e) => {
      if (e.target.closest('#nagasai-send-btn')) {
        if (isLoading) {
          if (currentPort) {
            currentPort.postMessage({ type: T.STOP_GENERATION });
            currentPort = null;
          }
          // Immediately re-enable input so user can type again
          setLoading(false);
          return;
        }
        sendUserMessage();
      }
      if (e.target.closest('#nagasai-save-keys-btn')) saveApiKeys();
      if (e.target.closest('#nagasai-export-btn')) exportChatToHtml();

      const screenshotBtn = e.target.closest('#nagasai-screenshot-btn');
      if (screenshotBtn) {
        e.preventDefault();
        handleScreenshotCapture();
      }

      const uploadBtn = e.target.closest('#nagasai-upload-btn');
      if (uploadBtn) {
        e.preventDefault();
        const fileInput = panel.querySelector('#nagasai-file-upload');
        if (fileInput) fileInput.click();
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
            const textToCopy = codeBlock.textContent;
            navigator.clipboard.writeText(textToCopy);

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
      if (e.target.id === 'nagasai-file-upload') {
        if (e.target.files && e.target.files.length > 0) {
          handleFileUpload(e.target.files[0]);
          e.target.value = ''; // reset
        }
      }
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

    // Image drag and drop
    panel.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
    panel.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFileUpload(e.dataTransfer.files[0]);
      }
    });

    setupMicButton();
  }

  // ─── Export Chat ──────────────────────────────────────────
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
      anthropic: panel.querySelector('#nagasai-key-anthropic')?.value.trim() ?? apiKeys.anthropic ?? '',
      openrouter: panel.querySelector('#nagasai-key-openrouter')?.value.trim() ?? apiKeys.openrouter ?? '',
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
      } else if (inputVal.startsWith('sk-ant-')) {
        newKeys.anthropic = inputVal;
        identifiedProvider = 'anthropic';
      } else if (inputVal.startsWith('sk-or-')) {
        newKeys.openrouter = inputVal;
        identifiedProvider = 'openrouter';
      } else if (inputVal.startsWith('sk-')) {
        newKeys.openai = inputVal;
        identifiedProvider = 'openai';
      } else {
        identifiedProvider = 'custom';
        newKeys.customKey = inputVal;
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
    if (isFileUploading) return;
    setLoading(true);

    const input = panel.querySelector('#nagasai-input');
    const text = input?.value.trim() || '';
    if (!text && !attachedScreenshotUrl && !attachedFileText) {
      setLoading(false);
      return;
    }

    const imgData = attachedScreenshotUrl;
    const fName = attachedFileName;
    const fText = attachedFileText;

    input.value = '';
    removeScreenshot();

    const msg = { role: 'user', content: text, image: imgData, attachmentName: fName, attachmentText: fText };
    chatHistory.push(msg);

    // Bug #4 Fix: Strip image data before saving to storage
    saveChatHistory();

    try { renderMessages(); } catch (e) {
      chatHistory.push({ role: 'assistant', content: `⚠️ Render Error: ${e.message}` });
      renderMessages();
      setLoading(false);
      return;
    }

    try {
      const pageContent = await extractPageContent() || 'No content found on page.';
      const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const pageTitle = activeTabs[0]?.title || 'Current Page';
      const pageUrl = activeTabs[0]?.url || 'Unknown URL';

      // ── Auto-screenshot for quiz/answer requests ──────────────────────
      // Cisco NetAcad and similar sites use cross-origin iframes for quiz content.
      // DOM reading fails on those, so we auto-capture the screen visually.
      const quizKeywords = /answer|solve|question|quiz|mcq|correct|option|choice|which one|what is the answer|give answer/i;
      let autoShotData = null;
      if (quizKeywords.test(text) && !imgData) {
        try {
          const shotRes = await sendMessage({ type: T.CAPTURE_SCREENSHOT });
          if (shotRes && shotRes.success) autoShotData = shotRes.dataUrl;
        } catch (_) { }
      }

      const systemPrompt = `You are NagaSai AI, a friendly, intelligent, and conversational browser assistant.

Instructions:
1. VERY IMPORTANT: Keep your conversational responses EXTREMELY short and concise, exactly like a natural human chat (e.g., 1-2 sentences). Do NOT write long essays unless explicitly asked.
2. If the user asks a simple question, reply briefly. Do NOT summarize or mention the page content unless the user specifically asks about it.
3. ONLY analyze the "PAGE CONTENT" below if the user's prompt references the page/text on the screen, OR if the user asks for code/answers to a problem (assume the problem is in the page content).
4. When providing code, ALWAYS wrap it in proper markdown code blocks (e.g., \`\`\`python ... \`\`\`). Do NOT use bold text for code. Provide direct, correct code solutions without unnecessary explanation.
5. Keep formatting clean and easy to read. Use bold text for emphasis and bullet points only when necessary.

Current Page Title: "${pageTitle}"
URL: ${pageUrl}

=== PAGE CONTENT ===
${pageContent}
===================
`;

      // Only send last MAX_CONTEXT_MESSAGES to avoid token explosion
      // Strip images from past messages to prevent massive token usage
      const contextHistory = chatHistory.slice(-MAX_CONTEXT_MESSAGES).map((msg, idx, arr) => {
        const hiddenFileContext = msg.attachmentText
          ? `${msg.content || `Please analyze the attached file: ${msg.attachmentName || 'uploaded file'}.`}\n\n--- Attached File: ${msg.attachmentName || 'Uploaded File'} ---\n${msg.attachmentText}`
          : null;
        const baseMsg = hiddenFileContext ? { ...msg, content: hiddenFileContext } : { ...msg };
        // Keep the image ONLY if it's the very last message in the history
        if (idx === arr.length - 1) return baseMsg;
        if (baseMsg.image) return { ...baseMsg, image: null, content: baseMsg.content + "\n*(Previous image omitted to save quota)*" };
        return baseMsg;
      });

      // Inject auto-screenshot into last user message for vision models
      if (autoShotData) {
        const lastUserMsg = [...contextHistory].reverse().find(m => m.role === 'user');
        if (lastUserMsg && !lastUserMsg.image) lastUserMsg.image = autoShotData;
      }

      const messages = [{ role: 'system', content: systemPrompt }, ...contextHistory];

      // Smart Fallback Chain
      const fallbackChain = [
        { provider: selectedProvider, model: selectedModel, label: 'Selected AI' },
        { provider: 'google', model: 'gemini-2.0-flash', label: 'Gemini', available: !!apiKeys.google?.trim() },
        { provider: 'groq', model: 'llama-3.3-70b-versatile', label: 'Groq', available: !!apiKeys.groq?.trim() },
        { provider: 'openrouter', model: 'meta-llama/llama-4-maverick:free', label: 'OpenRouter Free', available: !!apiKeys.openrouter?.trim() },
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

            // Per-provider timeout: abort after 60 seconds to avoid infinite hangs
            const timeoutId = setTimeout(() => {
              if (currentPort) {
                currentPort.postMessage({ type: T.STOP_GENERATION });
                currentPort = null;
              }
              reject(new Error(`${attempt.label} timed out after 60 seconds.`));
            }, 60000);

            currentPort.onMessage.addListener((msg) => {
              if (msg.type === 'CHUNK') {
                fullResponse = msg.accumulated;
                chatHistory[chatHistory.length - 1].content = msg.accumulated;
                renderMessages();
              } else if (msg.type === 'DONE') {
                clearTimeout(timeoutId);
                fullResponse = msg.response;
                chatHistory[chatHistory.length - 1].content = msg.response;
                saveChatHistory();
                renderMessages();
                currentPort = null;
                resolve();
              } else if (msg.type === 'ERROR') {
                clearTimeout(timeoutId);
                currentPort = null;
                reject(new Error(msg.error));
              }
            });
            
            // Handle disconnect if background script crashes
            currentPort.onDisconnect.addListener(() => {
              clearTimeout(timeoutId);
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

  // Bug #4 Fix: Helper — save chat history with images stripped
  function saveChatHistory() {
    const historyToSave = chatHistory.map(msg => {
      const saved = { ...msg };
      if (saved.image) saved.image = null; // strip base64 blobs
      if (saved.attachmentText) saved.attachmentText = null; // strip extracted document text
      return saved;
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
      (apiKeys.anthropic && apiKeys.anthropic.trim()) ||
      (apiKeys.openrouter && apiKeys.openrouter.trim()) ||
      (apiKeys.customKey && apiKeys.customKey.trim()) ||
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

    if (!chatScreen) return;

    hide(chatScreen); hide(settingsScreen); hide(toolbar);

    if (currentView === 'settings') {
      show(settingsScreen);
      populateSettingsUser();

      const opacitySlider = panel.querySelector('#nagasai-pref-opacity');
      if (opacitySlider) {
        const opacityRow = opacitySlider.parentElement;
        if (opacityRow) opacityRow.style.display = 'none';
      }
    } else {
      show(chatScreen);
      renderProviderSelect();
      renderMessages();
    }
  }

  function populateSettingsUser() {
    const kGoogle = panel.querySelector('#nagasai-key-google');
    const kGroq = panel.querySelector('#nagasai-key-groq');
    const kOpenAI = panel.querySelector('#nagasai-key-openai');
    const kAnthropic = panel.querySelector('#nagasai-key-anthropic');
    const kOpenRouter = panel.querySelector('#nagasai-key-openrouter');
    const kCustom = panel.querySelector('#nagasai-key-custom');
    const kCustomUrl = panel.querySelector('#nagasai-key-customurl');
    const kCustomModel = panel.querySelector('#nagasai-key-custommodel');

    if (kGoogle) kGoogle.value = apiKeys.google || '';
    if (kGroq) kGroq.value = apiKeys.groq || '';
    if (kOpenAI) kOpenAI.value = apiKeys.openai || '';
    if (kAnthropic) kAnthropic.value = apiKeys.anthropic || '';
    if (kOpenRouter) kOpenRouter.value = apiKeys.openrouter || '';
    if (kCustom) kCustom.value = apiKeys.customKey || '';
    if (kCustomUrl) kCustomUrl.value = apiKeys.customUrl || '';
    if (kCustomModel) kCustomModel.value = apiKeys.customModel || '';

    const kSmart = panel.querySelector('#nagasai-key-smart');
    if (kSmart) kSmart.value = '';
  }

  function renderProviderSelect() {
    const sel = panel.querySelector('#nagasai-provider-select');
    if (!sel) return;

    const activeProviders = Object.entries(PROVIDERS).filter(([pId, p]) => {
      if (!p.requiresKey) return true; // always show free providers
      if (pId === 'custom') return !!(apiKeys.customUrl && apiKeys.customUrl.trim());
      // Show providers if they have a key or a masked key (e.g. "****")
      return !!(apiKeys[pId] && apiKeys[pId].trim());
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

      if (msg.attachmentName) {
        const attDiv = document.createElement('div');
        attDiv.style.cssText = 'background:rgba(0,0,0,0.1); padding:4px 8px; border-radius:4px; margin-bottom:6px; font-size:11px; display:inline-flex; align-items:center; gap:4px;';
        attDiv.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg> <b>File attached</b>`;
        bubble.appendChild(attDiv);
      }

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
        if (msg.content) {
          const textNode = document.createTextNode(msg.content);
          bubble.appendChild(textNode);
        }
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
      loader.innerHTML = `
        <div class="nagasai-msg-label">Assistant</div>
        <div class="nagasai-msg-bubble nagasai-typing"><span></span><span></span><span></span></div>
      `;
      container.appendChild(loader);
    }

    scrollToBottom();
  }

  function setLoading(isLoad) {
    isLoading = isLoad;
    const sendBtn = panel.querySelector('#nagasai-send-btn');
    const input = panel.querySelector('#nagasai-input');
    if (isLoad) {
      if (sendBtn) {
        sendBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" ry="2"/></svg>';
        sendBtn.style.color = '#ff4a4a';
        sendBtn.title = 'Stop Generation';
      }
    } else {
      if (sendBtn) {
        sendBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';
        sendBtn.style.color = '';
        sendBtn.title = 'Send (Enter)';
      }
    }
    if (input) input.disabled = isLoad;
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
    if (e.buttons === 0) {
      stopDrag();
      return;
    }
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
    attachedFileName = null;
    attachedFileText = null;
    const img = panel.querySelector('#nagasai-screenshot-preview');
    const wrap = panel.querySelector('#nagasai-screenshot-preview-wrap');
    if (img) img.src = '';
    const label = panel.querySelector('#nagasai-file-label');
    if (label) label.remove();
    if (wrap) wrap.classList.remove('ns-show');
  }

  async function handleFileUpload(file) {
    if (!file) return;
    isFileUploading = true;
    try {
      attachedFileName = file.name;
      const wrap = panel.querySelector('#nagasai-screenshot-preview-wrap');
      const img = panel.querySelector('#nagasai-screenshot-preview');

      let label = panel.querySelector('#nagasai-file-label');
      if (label) label.remove();
      label = document.createElement('div');
      label.id = 'nagasai-file-label';
      label.style.cssText = 'position:absolute; bottom:5px; left:5px; background:rgba(0,0,0,0.7); color:white; padding:2px 6px; font-size:10px; border-radius:4px; max-width:90%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
      label.textContent = file.name;

      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        await new Promise((resolve, reject) => {
          reader.onload = (e) => {
            attachedScreenshotUrl = e.target.result;
            attachedFileText = null;
            if (img) img.src = attachedScreenshotUrl;
            if (wrap) { wrap.appendChild(label); wrap.classList.add('ns-show'); }
            resolve();
          };
          reader.onerror = () => reject(reader.error || new Error('Failed to read image file.'));
          reader.readAsDataURL(file);
        });
      } else {
        attachedScreenshotUrl = null;
        if (img) img.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="gray" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>';
        if (wrap) { wrap.appendChild(label); wrap.classList.add('ns-show'); }

        const lowerName = file.name.toLowerCase();
        if (lowerName.endsWith('.pdf')) {
          const arrayBuffer = await file.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
          let text = '';
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            text += content.items.map(item => item.str).join(' ') + '\n';
          }
          attachedFileText = text;
        } else if (lowerName.endsWith('.docx')) {
          const arrayBuffer = await file.arrayBuffer();
          const result = await mammoth.extractRawText({ arrayBuffer });
          attachedFileText = result.value;
        } else {
          attachedFileText = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result || '');
            reader.onerror = () => reject(reader.error || new Error('Failed to read text file.'));
            reader.readAsText(file);
          });
        }
      }
    } catch (e) {
      attachedFileText = null;
      attachedScreenshotUrl = null;
      chatHistory.push({ role: 'assistant', content: `⚠️ **Error parsing document**: ${e.message}` });
      renderMessages();
    } finally {
      isFileUploading = false;
    }
  }



  function scrollToBottom() {
    const container = panel.querySelector('#nagasai-messages');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }

})();