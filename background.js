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
  OPEN_SIDEPANEL: '_r8',
  GET_SIDEPANEL_STATE: '_r9',
  PULL_PAGE_CONTENT: '_ra',
  SIDEPANEL_STATE: '_rb',
  OPEN_FLOATING: '_rc',
  TOGGLE_STEALTH: '_rd',   // stealth mode: hide/show all extension UI
};

// ── Obfuscated storage keys (must match content.js) ──────────────
const K = {
  USER: '_s1',
  TOKEN: '_s2',
  SIGNED_IN: '_s3',
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

  if (type === T.SIGN_IN) { handleSignIn(sendResponse); return true; }
  if (type === T.SIGN_OUT) { handleSignOut(sendResponse); return true; }
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

// ── Google Sign-In ────────────────────────────────────────────────
async function handleSignIn(sendResponse) {
  try {
    await clearAllCachedTokens();
    const token = await getGoogleToken(true);
    if (!token) throw new Error('No token received.');

    const userInfo = await fetchUserInfo(token);

    await chrome.storage.sync.set({
      [K.USER]: userInfo,
      [K.TOKEN]: token,
      [K.SIGNED_IN]: true
    });

    sendResponse({ success: true, user: userInfo, token });
  } catch (err) {
    sendResponse({ success: false, error: err.message || 'Sign-in failed. Please try again.' });
  }
}

async function handleSignOut(sendResponse) {
  try {
    const data = await chrome.storage.sync.get(K.TOKEN);
    if (data[K.TOKEN]) await revokeToken(data[K.TOKEN]);
    await chrome.storage.sync.remove([K.USER, K.TOKEN, K.SIGNED_IN]);
    sendResponse({ success: true });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// Bug #14 Fix: Silently refresh the OAuth token on every auth state check.
// Google OAuth tokens expire in ~1 hour. This keeps the stored token fresh
// without requiring the user to sign in again.
async function getAuthState(sendResponse) {
  try {
    const data = await chrome.storage.sync.get([K.USER, K.SIGNED_IN, K.TOKEN]);

    if (data[K.SIGNED_IN] && data[K.USER]) {
      // Attempt a silent (non-interactive) token refresh.
      try {
        const freshToken = await getGoogleToken(false);
        if (freshToken && freshToken !== data[K.TOKEN]) {
          await chrome.storage.sync.set({ [K.TOKEN]: freshToken });
          data[K.TOKEN] = freshToken;
        }
      } catch (_) {
        // Silent refresh failed — user may need to re-sign in eventually.
        // We still return the cached auth state so the extension keeps working.
      }
    }

    sendResponse({
      signedIn: !!data[K.SIGNED_IN],
      user: data[K.USER] || null,
      token: data[K.TOKEN] || null
    });
  } catch (_) {
    sendResponse({ signedIn: false, user: null, token: null });
  }
}

// ── API Keys ──────────────────────────────────────────────────────
async function getApiKeys(sendResponse) {
  try {
    const data = await chrome.storage.sync.get(K.API_KEYS);
    sendResponse({ keys: data[K.API_KEYS] || { google: '', groq: '', openai: '', customKey: '', customUrl: '', customModel: '' } });
  } catch (_) {
    sendResponse({ keys: { google: '', groq: '', openai: '', customKey: '', customUrl: '', customModel: '' } });
  }
}

async function saveApiKeys(keys, sendResponse) {
  try {
    await chrome.storage.sync.set({ [K.API_KEYS]: keys });
    sendResponse({ success: true });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// ── Google OAuth Token ────────────────────────────────────────────
function getGoogleToken(interactive = false) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else if (!token) reject(new Error('No token returned.'));
      else resolve(token);
    });
  });
}

function clearAllCachedTokens() {
  return new Promise((resolve) => {
    if (chrome.identity.clearAllCachedAuthTokens) chrome.identity.clearAllCachedAuthTokens(resolve);
    else resolve();
  });
}

async function fetchUserInfo(token) {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    await new Promise(r => chrome.identity.removeCachedAuthToken({ token }, r));
    throw new Error(`Auth error: ${res.status}`);
  }
  return res.json();
}

async function revokeToken(token) {
  await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`).catch(() => { });
  return new Promise((resolve) => chrome.identity.removeCachedAuthToken({ token }, resolve));
}

// ── LLM Request ───────────────────────────────────────────────────
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
