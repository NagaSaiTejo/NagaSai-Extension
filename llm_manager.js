// ─── LLM Router ───────────────────────────────────────────────
export async function callLLM({ provider, model, messages, apiKeys = {} }) {
    // Trim system message if it's too large for general contexts
    const trimmedMessages = messages.map(m => {
        if (m.role === 'system' && m.content.length > 25000) {
            return { ...m, content: m.content.slice(0, 25000) + '\n...[content truncated]' };
        }
        return m;
    });

    if (provider === 'pollinations') {
        return callPollinations(model, trimmedMessages);
    } else if (provider === 'google') {
        if (!apiKeys.google) throw new Error('Google Gemini API Key is missing. Please add it in Settings.');
        return callGemini(model, trimmedMessages, apiKeys.google);
    } else if (provider === 'groq') {
        if (!apiKeys.groq) throw new Error('Groq API Key is missing. Please add it in Settings.');
        return callOpenAIFormat(model, trimmedMessages, apiKeys.groq, 'https://api.groq.com/openai/v1/chat/completions');
    } else if (provider === 'openai') {
        if (!apiKeys.openai) throw new Error('OpenAI API Key is missing. Please add it in Settings.');
        return callOpenAIFormat(model, trimmedMessages, apiKeys.openai, 'https://api.openai.com/v1/chat/completions');
    } else if (provider === 'custom') {
        if (!apiKeys.customUrl) throw new Error('Custom API URL is missing. Please add it in Settings.');
        // Allow empty keys for local endpoints (like LMStudio)
        const selectedModel = apiKeys.customModel || model || 'default';
        return callOpenAIFormat(selectedModel, trimmedMessages, apiKeys.customKey || '', apiKeys.customUrl);
    }

    throw new Error(`Unsupported provider: ${provider}`);
}

// ─── Pollinations (Free) ─────────────────────────────────────
async function callPollinations(model, messages) {
    // text.pollinations.ai optimally uses the 'openai' model namespace for free tier
    const safeModel = 'openai';
    const POLLINATIONS_BASE = 'https://text.pollinations.ai';

    const res = await fetch(`${POLLINATIONS_BASE}/openai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ model: safeModel, messages, stream: false })
    });

    const content = await handleOpenAIResponse(res);
    return stripPollinationsAd(content);
}

// Strip any promotional / ad content Pollinations appends to its responses.
// This keeps the extension output clean for end users.
function stripPollinationsAd(text) {
    if (!text) return text;
    // Match common separators + promotional blocks Pollinations injects
    // Covers: --- Support Pollinations ---, 🌸 Powered by..., etc.
    // Also catches "Powered by Pollinations" in any case and with or without URL.
    return text
        .replace(/\n*---+\n*(Support|Powered by) Pollinations[\s\S]*/i, '')
        .replace(/\n*---+\n*🌸[\s\S]*/i, '')
        .replace(/\n*(Powered by|Support) Pollinations(\.AI)?[\s\S]*/i, '')
        .replace(/\n*Pollinations\.AI[\s\S]*/i, '')
        .trim();
}


// ─── Google Gemini API ───────────────────────────────────────
async function callGemini(model, messages, apiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    // Format messages for Gemini API
    const contents = messages.map(m => {
        const parts = [];
        if (m.image) {
            const prefix = m.image.split(',')[0];
            const base64Data = m.image.split(',')[1];
            const mimeType = prefix.match(/:(.*?);/)[1];
            parts.push({ inlineData: { mimeType, data: base64Data } });
        }
        if (m.content) {
            parts.push({ text: m.content });
        } else if (m.image) {
            parts.push({ text: 'Please process this image.' });
        }
        return {
            role: m.role === 'assistant' ? 'model' : 'user',
            parts
        };
    }).filter(c => c.parts.length > 0); // drop empty entries

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents })
    });

    if (!res.ok) {
        let errMsg = `Gemini API Error (HTTP ${res.status})`;
        try { const errorData = await res.json(); errMsg = errorData.error?.message || errMsg; } catch (_) { }
        throw new Error(errMsg);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty response from Gemini API.');
    return text;
}

// ─── Generic OpenAI Format (Groq, OpenAI) ────────────────────
async function callOpenAIFormat(model, messages, apiKey, endpoint) {
    const formattedMessages = messages.map(m => {
        if (m.image) {
            // Vision-capable message with inline image
            return {
                role: m.role,
                content: [
                    { type: 'image_url', image_url: { url: m.image } },
                    { type: 'text', text: m.content || 'Please process this image.' }
                ]
            };
        }
        // Clean message — only send role + content, strip any extra fields (image: null etc.)
        return { role: m.role, content: m.content };
    });

    const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({ model, messages: formattedMessages, stream: false })
    });

    return handleOpenAIResponse(res);
}

// ─── Response Helper ─────────────────────────────────────────
async function handleOpenAIResponse(res) {
    const contentType = res.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
        if (res.status === 401) throw new Error('Invalid API key. Please clear it in Settings and enter a valid one.');
        if (res.status === 403) throw new Error('Access denied. Your key may not have permission for this model.');
        if (res.status === 429) throw new Error('Rate limited. Please wait a moment and try again.');
        if (res.status === 503) throw new Error('AI Service temporarily unavailable. Try again shortly.');
        throw new Error(`API error (HTTP ${res.status}). Check your key in Settings.`);
    }

    if (!res.ok) {
        let errMsg = `AI API Error (HTTP ${res.status})`;
        try {
            const err = await res.json();
            errMsg = err.error?.message || errMsg;
        } catch (_) { }
        throw new Error(errMsg);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty response from AI helper.');
    return content;
}
