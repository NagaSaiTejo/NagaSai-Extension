# NagaSai AI — The Ultimate Web AI Assistant

**A Stealthy, DOM-Isolated, Multi-Model Browser Companion**

NagaSai AI is a high-performance Chrome extension (Manifest V3) designed to be your permanent AI companion on the web. It integrates seamlessly into any webpage or your browser's side panel, allowing you to summarize, analyze, and chat with page content using the world's most powerful LLMs including **Google Gemini, GPT-4o, and Llama 3**.

---

## The "Walkthrough" Experience

### 1. Unified Access (Floating or Docked)
Upon installation, a subtle, semi-transparent **"S" button** appears in the bottom-right corner of every website. 
- **Floating Mode:** Click the "S" to open the glassmorphism chat bubble. Use the header to drag it anywhere on your screen.
- **Side Panel Mode:** Click the "Dock" icon in the header to instantly slide the extension into Chrome's native side panel for a dedicated, full-height workspace that stays open as you browse different tabs.

### 2. Intelligent Content Extraction
NagaSai AI doesn't just "chat"; it **reads**. When you ask a question like *"Summarize this article,"* the extension's extraction engine parses the visible DOM, strips away noise (ads, nav bars, footers), and feeds the core content directly to the AI for instant analysis.

### 3. Visual Reasoning (Screenshots)
Got a complex chart, a weird error message, or a design you want to discuss? Click the **Camera Icon**. The extension captures a snapshot of your current tab (automatically hiding its own UI first) and attaches it to your message. Pair this with a model like **Gemini 1.5 Pro** or **GPT-4o** for elite vision capabilities.

### 4. Stealth Mode
Sharing your screen on Zoom or Teams? Use **Alt + Shift + H** (or the Green Eye icon) to enter **Stealth Mode**. This instantly closes the panels and makes the "S" toggle nearly invisible (transparent). Only you know where it is, keeping your AI assistant private during presentations.

### 5. Multi-Model Powerhouse
Switch models mid-conversation! 
- **Free AI:** Powered by Pollinations.ai for instant, key-less access.
- **Bring Your Own Key:** Securely add your own API keys for **Google Gemini, Groq, or OpenAI** in the Settings tab to unlock higher rate limits and pro models.

---

## Optimized Technical Architecture

The project has been heavily refactored for performance and "zero-clutter" maintenance.

### Shared Logic Engine (`shared.js`)
To reduce bundle size and memory overhead, we extracted 200+ lines of duplicated UI generation and data logic from `content.js` and `sidepanel.js` into a centralized `shared.js`. This file serves as the single source of truth for:
- **UI Schematics:** The `buildPanelHTML` function generates consistent interfaces for both modes.
- **Markdown Parsing:** The `formatMessage` function handles code blocks, bolding, and list rendering.
- **Provider Lists:** Centralized model definitions and URL endpoints.

### Shadow DOM Isolation
The floating panel utilizes a **"Closed" Shadow DOM**. This ensures:
- **Zero Style Leakage:** The extension's CSS (`ui.css`) will never break the website you're visiting.
- **Security:** The host website's JavaScript cannot easily access or interfere with your chat history or API keys.

### Background Service Worker (`background.js`)
A lean MV3 service worker that handles:
- **OAuth2 Flow:** Secure Google Sign-in via `chrome.identity`.
- **Screenshot Marshaling:** Capturing tab data without requiring local storage.
- **Cross-Communication:** Syncing states (like Stealth Mode) across all active tabs.

---

## Privacy & Security First
- **No Middleman:** All API calls are made **locally** from your browser directly to the AI providers. There is no NagaSai server sitting in the middle reading your data.
- **Local Storage:** Your chat history and preferences stay on your machine (synced via `chrome.storage.sync` if you're logged into Chrome).
- **Ephemeral Access:** Screenshots and page content are only sent when you explicitly hit "Send."

---

## Installation (Unpacked)
1. Clone this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer Mode** (top right).
4. Click **Load unpacked** and select the extension folder.

*Developed with precision for a seamless AI-native browsing experience with NagaSai AI.*
 Extension v1.0*
