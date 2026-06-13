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
    } else if (provider === 'openrouter') {
        if (!apiKeys.openrouter) throw new Error('OpenRouter API Key is missing. Please add it in Settings.');
        return callOpenAIFormat(model, trimmedMessages, apiKeys.openrouter, 'https://openrouter.ai/api/v1/chat/completions');
    } else if (provider === 'anthropic') {
        if (!apiKeys.anthropic) throw new Error('Anthropic API Key is missing. Please add it in Settings.');
        return callAnthropic(model, trimmedMessages, apiKeys.anthropic);
    } else if (provider === 'cohere') {
        if (!apiKeys.cohere) throw new Error('Cohere API Key is missing. Please add it in Settings.');
        return callCohere(model, trimmedMessages, apiKeys.cohere);
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
    const POLLINATIONS_BASE = 'https://text.pollinations.ai';

    // Check if any message has an image — use vision-capable model
    const hasImage = messages.some(m => m.image);
    const safeModel = hasImage ? 'openai-large' : 'openai'; // openai-large = GPT-4o (vision), openai = GPT-4o Mini

    // Format messages: convert image fields to OpenAI vision content arrays
    const formattedMessages = messages.map(m => {
        if (m.image) {
            return {
                role: m.role,
                content: [
                    { type: 'image_url', image_url: { url: m.image } },
                    { type: 'text', text: m.content || 'Please answer the question shown in this screenshot.' }
                ]
            };
        }
        return { role: m.role, content: m.content };
    });

    let lastError = null;
    // Retry up to 5 times with increasing delay
    for (let i = 0; i < 5; i++) {
        try {
            const res = await fetch(`${POLLINATIONS_BASE}/openai`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ model: safeModel, messages: formattedMessages, stream: false })
            });

            const content = await handleOpenAIResponse(res);
            const cleaned = stripPollinationsAd(content);
            if (cleaned) return cleaned;
            throw new Error('Empty response from AI helper.');
        } catch (err) {
            lastError = err;
            await new Promise(r => setTimeout(r, 2000 * (i + 1))); // Wait 2s, 4s, 6s...
        }
    }
    
    throw lastError || new Error('Empty response from AI helper.');
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

    let res;
    let lastError = null;
    
    // Retry up to 3 times for high demand/rate limits
    for (let i = 0; i < 3; i++) {
        res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents })
        });

        if (res.ok) break;

        let errMsg = `Gemini API Error (HTTP ${res.status})`;
        try { const errorData = await res.json(); errMsg = errorData.error?.message || errMsg; } catch (_) { }
        lastError = new Error(errMsg);

        // If high demand (503) or rate limit (429), wait and retry
        if (res.status === 429 || res.status === 503) {
            await new Promise(r => setTimeout(r, 2000 * (i + 1))); // Wait 2s, 4s, 6s...
        } else {
            throw lastError; // Throw immediately for other errors
        }
    }

    if (!res?.ok) throw lastError;

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

// ─── Anthropic API ───────────────────────────────────────────
async function callAnthropic(model, messages, apiKey) {
    let systemPrompt = '';
    const anthropicMessages = [];
    
    for (const m of messages) {
        if (m.role === 'system') {
            systemPrompt += m.content + '\n';
        } else {
            let content = m.content;
            if (m.image) {
                const match = m.image.match(/^data:(image\/[a-zA-Z]+);base64,(.*)$/);
                if (match) {
                    content = [
                        { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } },
                        { type: "text", text: m.content || "Please process this image." }
                    ];
                }
            }
            anthropicMessages.push({ role: m.role, content: content });
        }
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
            model: model,
            system: systemPrompt.trim(),
            messages: anthropicMessages,
            max_tokens: 4096
        })
    });

    if (!res.ok) {
        let errMsg = `Anthropic API Error (HTTP ${res.status})`;
        try { const errorData = await res.json(); errMsg = errorData.error?.message || errMsg; } catch (_) { }
        throw new Error(errMsg);
    }

    const data = await res.json();
    const text = data.content?.[0]?.text;
    if (!text) throw new Error('Empty response from Anthropic API.');
    return text;
}

// ─── Cohere API ────────────────────────────────────────────────
async function callCohere(model, messages, apiKey) {
    const formattedMessages = messages.map(m => {
        if (m.role === 'system') {
            return { role: 'system', content: m.content };
        }

        const text = m.content || (m.image ? 'Please process this image.' : '');
        return {
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: text
        };
    }).filter(m => m.content);

    const res = await fetch('https://api.cohere.com/v2/chat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model,
            messages: formattedMessages,
            temperature: 0.3,
            stream: false
        })
    });

    if (!res.ok) {
        let errMsg = `Cohere API Error (HTTP ${res.status})`;
        try { const errorData = await res.json(); errMsg = errorData.message || errorData.error?.message || errMsg; } catch (_) { }
        throw new Error(errMsg);
    }

    const data = await res.json();
    const text = data.message?.content?.[0]?.text || data.text || data.generations?.[0]?.text;
    if (!text) throw new Error('Empty response from Cohere API.');
    return text;
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
