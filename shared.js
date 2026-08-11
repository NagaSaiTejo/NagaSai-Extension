// shared.js - Shared utilities, constants, and UI generation for NagaSai AI

window.NagaSaiShared = {
  PROVIDERS: {
    pollinations: {
      label: 'Free AI (No Key)',
      badge: 'Free',
      models: [['openai', '⚡ GPT-4o Mini (Free)']]
    },
    google: {
      label: 'Google Gemini',
      badge: 'API Key',
      requiresKey: true,
      models: [
        ['gemini-3.6-flash', '⚡ Gemini 3.6 Flash (Fastest)'],
        ['gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite'],
        ['gemini-2.5-flash', 'Gemini 2.5 Flash(Old key users)'],
        ['gemini-3.1-flash-lite', 'Gemini 3.1 Flash-Lite'],
        ['gemini-flash-latest', 'Gemini Flash Latest'],
        ['gemini-flash-lite-latest', 'Gemini Flash-Lite Latest']
      ],
      keyUrl: 'https://aistudio.google.com/app/apikey'
    },
    groq: {
      label: 'Groq',
      badge: 'API Key',
      requiresKey: true,
      models: [
        ['llama-3.3-70b-versatile', '⚡ Llama 3.3 70B (Fast)'],
        ['openai/gpt-oss-120b', 'OpenAI GPT OSS 120B'],
        ['openai/gpt-oss-20b', 'OpenAI GPT OSS 20B']
      ],
      keyUrl: 'https://console.groq.com/keys'
    },
    openai: {
      label: 'OpenAI',
      badge: 'API Key',
      requiresKey: true,
      models: [
        ['gpt-4o', 'GPT-4o'],
        ['gpt-4o-mini', 'GPT-4o Mini'],
        ['o3-mini', 'o3-mini']
      ],
      keyUrl: 'https://platform.openai.com/api-keys'
    },
    anthropic: {
      label: 'Anthropic Claude',
      badge: 'API Key',
      requiresKey: true,
      models: [
        ['claude-3-7-sonnet-20250219', 'Claude 3.7 Sonnet'],
        ['claude-3-5-sonnet-20241022', 'Claude 3.5 Sonnet'],
        ['claude-3-5-haiku-20241022', 'Claude 3.5 Haiku']
      ],
      keyUrl: 'https://console.anthropic.com/settings/keys'
    },
    openrouter: {
      label: 'OpenRouter (Free)',
      badge: 'API Key',
      requiresKey: true,
      models: [
        ['openrouter/free', 'Auto Free Router (Unlimited)'],
        ['google/gemma-3-27b-it', 'Gemma 3 27B']
      ],
      keyUrl: 'https://openrouter.ai/settings/keys'
    },
    custom: {
      label: 'Custom / Local API',
      badge: 'Advanced',
      requiresKey: true,
      models: [['custom-model', 'Custom Model']],
      keyUrl: '#'
    }
  },

  MAX_CONTEXT_MESSAGES: 10,

  formatMessage: function (text) {
    if (!text || typeof text !== 'string') return '';
    let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<div style="white-space: pre-wrap; word-wrap: break-word;">${html}</div>`;
  },

  buildPanelHTML: function (isSidePanel) {
    return `
    <div id="nagasai-panel" data-ns="panel" style="display: none;">
      <div id="nagasai-header">
        <div class="nagasai-header-left">
          <div class="nagasai-logo-pulse"></div>
          <span class="nagasai-title">NagaSai AI</span>
          <span class="nagasai-ai-badge">AI</span>
        </div>
        <div class="nagasai-header-right">
          <button id="nagasai-privacy-btn" class="nagasai-icon-btn" title="Privacy Mode — hide from screen share (click S to restore)" style="color: rgba(100,200,100,0.8);">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
          </button>
          <button id="nagasai-theme-btn" class="nagasai-icon-btn" title="Toggle Theme">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
          </button>
          ${isSidePanel ? `
          <button id="nagasai-floating-btn" class="nagasai-icon-btn" title="Switch to Floating panel">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
          </button>
          ` : `
          <button id="nagasai-sidepanel-btn" class="nagasai-icon-btn" title="Open in Side Panel">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="15" y1="3" x2="15" y2="21"></line></svg>
          </button>
          `}
          <button id="nagasai-clear" class="nagasai-icon-btn" title="Clear chat">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
          <button id="nagasai-export-btn" class="nagasai-icon-btn" title="Export Chat">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          </button>
          <button id="nagasai-settings-btn" class="nagasai-icon-btn" title="Settings">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
          </button>
          <button id="nagasai-close" class="nagasai-icon-btn" title="Close">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      <div id="nagasai-toolbar" style="display:none;">
      </div>

      <div id="nagasai-chat-screen">
        <div class="nagasai-model-bar">
          <div class="nagasai-select-wrap">
            <label>Provider</label>
            <select id="nagasai-provider-select" class="nagasai-select"></select>
          </div>
          <div class="nagasai-select-wrap">
            <label>Model</label>
            <select id="nagasai-model-select" class="nagasai-select"></select>
          </div>
        </div>
        <div id="nagasai-messages" class="nagasai-messages"></div>
        <div class="nagasai-input-row">
          <div id="nagasai-screenshot-preview-wrap" class="nagasai-screenshot-preview-wrap">
            <img id="nagasai-screenshot-preview" class="nagasai-screenshot-preview" src="" />
            <button id="nagasai-remove-screenshot-btn" class="nagasai-remove-screenshot-btn">✕</button>
          </div>
          <div class="nagasai-input-controls">
            <input type="file" id="nagasai-file-upload" accept="image/*,.pdf,.docx,.txt,.csv,.md" style="display: none;" />
            <button id="nagasai-upload-btn" class="nagasai-screenshot-btn" title="Upload File or Image">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            </button>
            <button id="nagasai-screenshot-btn" class="nagasai-screenshot-btn" title="Attach Screenshot">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
            </button>
            <textarea id="nagasai-input" class="nagasai-input" placeholder="Ask, Learn, Understand…" rows="1"></textarea>
            <button id="nagasai-mic-btn" class="nagasai-mic-btn" title="Voice input — click to start, click again to stop">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
            </button>
            <button id="nagasai-send-btn" class="nagasai-send-btn" title="Send (Enter)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
            </button>
          </div>
        </div>
      </div>

      <div id="nagasai-settings-screen">
        <div class="nagasai-settings-wrap">
          <h3 class="nagasai-settings-section">Appearance</h3>
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; background: rgba(0,0,0,0.1); padding: 8px; border-radius: 6px;">
            <label style="margin-bottom: 0; font-size: 11px; color: #a0a0a0; white-space: nowrap;">App Opacity</label>
            <input type="range" id="nagasai-pref-opacity" min="0.2" max="1" step="0.05" value="1" style="flex: 1; margin-left: 10px; cursor: pointer;" />
          </div>
          <h3 class="nagasai-settings-section">API Keys</h3>
          <p style="font-size:10.5px;color:rgba(200,200,200,0.6);margin-bottom:5px;line-height:1.4;">Add your own free API keys to unlock models. Keys stored safely in Chrome Sync.</p>
          <div class="nagasai-keys-form">
            <div class="nagasai-key-group">
              <label>Google Gemini API Key <a href="${this.PROVIDERS.google.keyUrl}" target="_blank">(Get free key)</a></label>
              <input type="password" id="nagasai-key-google" placeholder="AIzaSy..." value="" />
            </div>
            <div class="nagasai-key-group">
              <label>Groq API Key <a href="${this.PROVIDERS.groq.keyUrl}" target="_blank">(Get free key)</a></label>
              <input type="password" id="nagasai-key-groq" placeholder="gsk_..." value="" />
            </div>
            <div class="nagasai-key-group">
              <label>OpenAI Key <a href="${this.PROVIDERS.openai.keyUrl}" target="_blank">(Get key)</a></label>
              <input type="password" id="nagasai-key-openai" placeholder="sk-..." value="" />
            </div>
            <div class="nagasai-key-group">
              <label>Anthropic Claude Key <a href="${this.PROVIDERS.anthropic.keyUrl}" target="_blank">(Get key)</a></label>
              <input type="password" id="nagasai-key-anthropic" placeholder="sk-ant-..." value="" />
            </div>
            <div class="nagasai-key-group">
              <label>OpenRouter Key <a href="${this.PROVIDERS.openrouter.keyUrl}" target="_blank">(Get free models)</a></label>
              <input type="password" id="nagasai-key-openrouter" placeholder="sk-or-v1-..." value="" />
            </div>
            <hr style="border:0;height:1px;background:rgba(255,255,255,0.1);margin:12px 0;">
            <div class="nagasai-key-group">
              <label>Custom / Local API URL (e.g. LMStudio)</label>
              <input type="text" id="nagasai-key-customurl" placeholder="http://localhost:1234/v1/chat/completions" value="" />
            </div>
            <div class="nagasai-key-group">
              <label>Custom API Key (optional)</label>
              <input type="password" id="nagasai-key-custom" placeholder="sk-... (leave blank for local)" value="" />
            </div>
            <div class="nagasai-key-group">
              <label>Custom Model Name (optional)</label>
              <input type="text" id="nagasai-key-custommodel" placeholder="mistral, llama3, etc." value="" />
            </div>
            <hr style="border:0;height:1px;background:rgba(255,255,255,0.1);margin:12px 0;">
            <p style="font-size: 10.5px; color: rgba(168, 210, 193, 0.7); margin-bottom: 5px; line-height: 1.4;">
              <strong>Smart Auto-Detect:</strong> Paste any API key below. We automatically detect and unlock providers!
            </p>
            <div class="nagasai-key-group">
              <label>Paste API Key</label>
              <input type="password" id="nagasai-key-smart" placeholder="sk-ant-..., sk-..., gsk_..., etc." value="" />
            </div>
            <button id="nagasai-save-keys-btn" class="nagasai-google-btn" style="margin-top:5px;padding:7px;">Save &amp; Unlock Provider</button>
            <p id="nagasai-keys-msg" style="font-size:10.5px;color:#1dba8a;display:none;text-align:center;margin-top:2px;"></p>
          </div>
          <h3 class="nagasai-settings-section">About & Privacy</h3>
          <div class="nagasai-about-card">
            <p>🔒 <strong>Privacy First</strong> — Page content is only sent when asking a question. We do not store or track your chats on external servers.</p>
            <p>🤖 <strong>Multi-model</strong> — Gemini, GPT, Groq &amp; more. Add multiple comma-separated keys to enable automatic fallback on rate limits.</p>
            <p>🖱️ <strong>Drag icon</strong> — Drag the floating 'S' anywhere.</p>
            <p>📋 <strong>Screenshot</strong> — Ask questions about what's on your screen.</p>
          </div>
          <p style="text-align: center; font-size: 10px; color: rgba(255,255,255,0.4); margin-top: 15px;">
            By using NagaSai AI, you agree that your API keys are stored locally on your device using Chrome storage. 
            We do not log your conversations.
          </p>
        </div>
      </div>
    </div>`;
  }
};
