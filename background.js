// Service Worker — NagaSai AI Extension
import { callLLM } from './llm_manager.js';

// ── Obfuscated message type map (must match content.js) ──────────
const T = {
  SIGN_IN: '_r1',
  SIGN_OUT: '_r2',
  GET_AUTH_STATE: '_r3',
  GET_API_KEYS: '_r4',
  SAVE_API_KEYS: '_r5',
  LLM_REQUEST: '_r6',
  CAPTURE_SCREENSHOT: '_r7',
  OPEN_SIDEPANEL: '_r10',
  GET_SIDEPANEL_STATE: '_r11',
  PULL_PAGE_CONTENT: '_ra',
  SIDEPANEL_STATE: '_rb',
  OPEN_FLOATING: '_rc',
  TOGGLE_STEALTH: '_rd',   // stealth mode: hide/show all extension UI
  START_GENERATION: 'START_GENERATION',
  STOP_GENERATION: 'STOP_GENERATION',
};

const K = {
  USER: '_s1',
  API_KEYS: '_s4',
};

// ── Port name (must match content.js) ────────────────────────────
const PORT_NAME = '_p0rt_sp';

let sidePanelOpen = false;
let sidePanelWindowId = null;
let sidePanelPort = null;  // stored so we can message sidepanel.js directly

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === PORT_NAME) {
    sidePanelOpen = true;
    sidePanelPort = port;  // keep reference so stealth can FORCE_CLOSE it
    broadcastSidePanelState(true);
    port.onDisconnect.addListener(() => {
      sidePanelOpen = false;
      sidePanelPort = null;
      broadcastSidePanelState(false);
      sidePanelWindowId = null;
    });
  }
});

// Bug #7 Fix: Only broadcast to tabs in the window that owns the side panel.
function broadcastSidePanelState(isOpen) {
  const query = sidePanelWindowId ? { windowId: sidePanelWindowId } : {};
  chrome.tabs.query(query, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: T.SIDEPANEL_STATE, isOpen }).catch(() => { });
    }
  });
}

// ── Message Router ────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type } = message;

  if (type === T.SIGN_IN) { sendResponse({ success: true, user: { name: 'User' }, token: 'free-mode' }); return true; }
  if (type === T.SIGN_OUT) { sendResponse({ success: true }); return true; }
  if (type === T.GET_AUTH_STATE) { getAuthState(sendResponse); return true; }
  if (type === T.GET_API_KEYS) { getApiKeys(sendResponse); return true; }
  if (type === T.SAVE_API_KEYS) { saveApiKeys(message.payload, sendResponse); return true; }
  if (type === T.LLM_REQUEST) { handleLLMRequest(message.payload, sendResponse); return true; }
  if (type === T.CAPTURE_SCREENSHOT) { handleScreenshot(sender, sendResponse); return true; }
  if (type === T.GET_SIDEPANEL_STATE) { sendResponse({ isOpen: sidePanelOpen }); return true; }

  if (type === T.OPEN_SIDEPANEL) {
    // Bug #7 Fix: Capture the window ID of the tab that requested the side panel.
    if (sender.tab) {
      sidePanelWindowId = sender.tab.windowId;
      chrome.sidePanel.open({ tabId: sender.tab.id });
    }
    sendResponse({ success: true });
    return true;
  }
});

// ── Auth State (Always Free/Signed In) ────────────────────────────
async function getAuthState(sendResponse) {
  sendResponse({
    signedIn: true,
    user: { name: 'User', picture: '' },
    token: 'free-mode'
  });
}

// ── API Keys ──────────────────────────────────────────────────────
function maskKey(key) {
  if (!key) return '';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

async function getApiKeys(sendResponse) {
  try {
    const data = await chrome.storage.sync.get(K.API_KEYS);
    const realKeys = data[K.API_KEYS] || {};
    const maskedKeys = {
      google: maskKey(realKeys.google),
      groq: maskKey(realKeys.groq),
      openai: maskKey(realKeys.openai),
      anthropic: maskKey(realKeys.anthropic),
      openrouter: maskKey(realKeys.openrouter),
      customKey: maskKey(realKeys.customKey),
      customUrl: realKeys.customUrl || '',
      customModel: realKeys.customModel || ''
    };
    sendResponse({ keys: maskedKeys });
  } catch (_) {
    sendResponse({ keys: {} });
  }
}

async function saveApiKeys(newKeys, sendResponse) {
  try {
    const data = await chrome.storage.sync.get(K.API_KEYS);
    const existingKeys = data[K.API_KEYS] || {};
    
    // Only update keys that do not contain the mask '****'
    const finalKeys = { ...existingKeys };
    for (const [k, v] of Object.entries(newKeys)) {
      if (v && v.includes('****')) {
        continue; // retain existing key
      }
      finalKeys[k] = v;
    }

    await chrome.storage.sync.set({ [K.API_KEYS]: finalKeys });
    sendResponse({ success: true });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

let activeControllers = new Map(); // Port -> AbortController

// Handle LLM Requests via one-off messages (non-streaming legacy fallback if needed)
async function handleLLMRequest(payload, sendResponse) {
  try {
    const { provider, model, messages } = payload;
    const data = await chrome.storage.sync.get(K.API_KEYS);
    const apiKeys = data[K.API_KEYS] || {};
    const response = await callLLM({ provider, model, messages, apiKeys });
    sendResponse({ success: true, response });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// Handle LLM Requests via Ports (Streaming)
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'llm_stream') return;

  port.onMessage.addListener(async (msg) => {
    if (msg.type === T.STOP_GENERATION) {
      const controller = activeControllers.get(port);
      if (controller) {
        controller.abort();
        activeControllers.delete(port);
      }
      return;
    }

    if (msg.type === T.START_GENERATION) {
      const { provider, model, messages } = msg.payload;
      const controller = new AbortController();
      activeControllers.set(port, controller);

      try {
        const data = await chrome.storage.sync.get(K.API_KEYS);
        const apiKeys = data[K.API_KEYS] || {};

        const response = await callLLM({
          provider,
          model,
          messages,
          apiKeys,
          signal: controller.signal,
          onChunk: (chunk, accumulated) => {
            port.postMessage({ type: 'CHUNK', chunk, accumulated });
          }
        });

        port.postMessage({ type: 'DONE', response });
      } catch (err) {
        if (err.name === 'AbortError' || err.message?.includes('user aborted')) {
          port.postMessage({ type: 'ERROR', error: 'Generation stopped by user.' });
        } else {
          port.postMessage({ type: 'ERROR', error: err.message });
        }
      } finally {
        activeControllers.delete(port);
      }
    }
  });

  port.onDisconnect.addListener(() => {
    const controller = activeControllers.get(port);
    if (controller) {
      controller.abort();
      activeControllers.delete(port);
    }
  });
});


// ── Screenshot ────────────────────────────────────────────────────
// Bug #9 improvement: pass sender so we capture the correct tab's window.
function handleScreenshot(sender, sendResponse) {
  // Use the sender's windowId to capture the right tab's screenshot.
  const windowId = sender?.tab?.windowId ?? null;
  chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 60 }, (dataUrl) => {
    if (chrome.runtime.lastError) {
      sendResponse({ success: false, error: `Screenshot failed: ${chrome.runtime.lastError.message}. Try reloading the extension.` });
    } else {
      sendResponse({ success: true, dataUrl });
    }
  });
}

// ── Stealth Mode ────────────────────────────────────────────────────────────
// Alt+Shift+H hides EVERYTHING:
//   1. S button + floating panel  → via TOGGLE_STEALTH to content script
//   2. Chrome Side Panel          → via FORCE_CLOSE port message to sidepanel.js
//                                    sidepanel.js calls window.close() on itself
// This is the only reliable way to close the side panel — chrome.sidePanel.setOptions
// alone doesn't guarantee closing an already-open panel.

let stealthActive = false;
let stealthSidePanelTabId = null;

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== '_toggle_stealth') return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  stealthActive = !stealthActive;

  if (stealthActive) {
    // 1. Hide S button + floating panel in the page
    chrome.tabs.sendMessage(tab.id, { type: T.TOGGLE_STEALTH, entering: true }).catch(() => { });

    // 2. Force-close the side panel by messaging sidepanel.js directly through the port.
    //    sidepanel.js receives 'FORCE_CLOSE' and calls window.close() on itself.
    stealthSidePanelTabId = sidePanelOpen ? tab.id : null;
    if (sidePanelPort) {
      try { sidePanelPort.postMessage({ type: 'FORCE_CLOSE' }); } catch (_) { }
    }
    // Also disable via API as a belt-and-suspenders backup
    try { await chrome.sidePanel.setOptions({ tabId: tab.id, enabled: false }); } catch (_) { }

  } else {
    // 1. Restore S button + floating panel
    chrome.tabs.sendMessage(tab.id, { type: T.TOGGLE_STEALTH, entering: false }).catch(() => { });

    // 2. Re-enable side panel so user can open it again
    try {
      await chrome.sidePanel.setOptions({ tabId: tab.id, enabled: true });
      // Auto-reopen if it was open before stealth
      if (stealthSidePanelTabId === tab.id) {
        await chrome.sidePanel.open({ tabId: tab.id });
        stealthSidePanelTabId = null;
      }
    } catch (_) { }
  }
});
