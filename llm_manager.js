// ─── Key Fallback Wrapper ──────────────────────────────────────
async function withKeyFallback(providerName, keysStr, fn) {
    if (!keysStr) throw new Error(`${providerName} API Key is missing. Please add it in Settings.`);
    const keys = keysStr.split(',').map(k => k.trim()).filter(k => k);
    if (keys.length === 0) throw new Error(`${providerName} API Key is missing. Please add it in Settings.`);
    
    let lastError = null;
    for (let i = 0; i < keys.length; i++) {
        try {
            return await fn(keys[i]);
        } catch (err) {
            lastError = err;
            if (err.name === 'AbortError' || err.message?.includes('user aborted')) {
                throw err;
            }
            if (i < keys.length - 1) {
                console.log(`${providerName} Key ${i + 1} failed, falling back to next key...`, err);
                continue;
            }
        }
    }
    throw lastError;
}

// ─── Main Router ─────────────────────────────────────────────────────────────
export async function callLLM({ provider, model, messages, apiKeys = {}, onChunk = null, signal = null }) {
    // Trim system message if it's too large for general contexts
    const trimmed = messages.map(m => {
        if (m.role === 'system' && m.content.length > 25000) {
            return { ...m, content: m.content.slice(0, 25000) + '\n...[content truncated]' };
        }
        return m;
    });

    if (provider === 'pollinations') {
        return callPollinations(model, trimmed, onChunk, signal);
    } else if (provider === 'google') {
        return withKeyFallback('Google Gemini', apiKeys.google, key => callGemini(model, trimmed, key, onChunk, signal));
    } else if (provider === 'groq') {
        return withKeyFallback('Groq', apiKeys.groq, key => callOpenAIFormat(model, trimmed, key, 'https://api.groq.com/openai/v1/chat/completions', onChunk, signal));
    } else if (provider === 'openai') {
        return withKeyFallback('OpenAI', apiKeys.openai, key => callOpenAIFormat(model, trimmed, key, 'https://api.openai.com/v1/chat/completions', onChunk, signal));
    } else if (provider === 'openrouter') {
        return withKeyFallback('OpenRouter', apiKeys.openrouter, key => callOpenAIFormat(model, trimmed, key, 'https://openrouter.ai/api/v1/chat/completions', onChunk, signal));
    } else if (provider === 'anthropic') {
        return withKeyFallback('Anthropic', apiKeys.anthropic, key => callAnthropic(model, trimmed, key, onChunk, signal));
    } else if (provider === 'custom') {
        if (!apiKeys.customUrl) throw new Error('Custom API URL is missing. Please add it in Settings.');
        const m = apiKeys.customModel || model || 'default';
        const customKeys = apiKeys.customKey || ' '; 
        return withKeyFallback('Custom', customKeys, key => callOpenAIFormat(m, trimmed, key.trim(), apiKeys.customUrl, onChunk, signal));
    }
    throw new Error(`Unsupported provider: ${provider}`);
}

// ─── Pollinations (Free) ──────────────────────────────────────────────────
async function callPollinations(model, messages, onChunk, signal = null) {
    let lastError = null;
    for (let attempt = 0; attempt < 1; attempt++) {
        try {
            const useStream = typeof onChunk === 'function';
            // Use AbortController for timeouts to avoid hanging indefinitely if rate limited
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); 

            const combinedSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;

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

            const res = await fetch('https://text.pollinations.ai/openai', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ model: 'openai', messages: formattedMessages, stream: useStream }),
                signal: combinedSignal
            });

            clearTimeout(timeoutId);

            if (useStream) {
                return await readStream(res, onChunk);
            }
            const content = await handleOpenAIResponse(res);
            return stripAds(content);
        } catch (err) {
            if (signal && signal.aborted) {
                throw new Error('The user aborted a request');
            }
            if (err.name === 'AbortError') {
                lastError = new Error('Free AI request timed out. The server is likely overloaded. Try again or add a free key.');
            } else {
                lastError = err;
            }
            await new Promise(r => setTimeout(r, 1500));
        }
    }
    throw lastError || new Error('Empty response from Free AI.');
}

function stripAds(text) {
    if (!text) return text;
    return text
        .replace(/\n*---+\n*(Support|Powered by) Pollinations[\s\S]*/i, '')
        .replace(/\n*---+\n*🌸[\s\S]*/i, '')
        .replace(/\n*(Powered by|Support) Pollinations(\.AI)?[\s\S]*/i, '')
        .replace(/\n*Pollinations\.AI[\s\S]*/i, '')
        .trim();
}

// ─── Google Gemini API ──────────────────────────────────────────────────
async function callGemini(model, messages, apiKey, onChunk, signal = null) {
    const useStream = typeof onChunk === 'function';

    const cleanKey = apiKey.replace(/^(Bearer\s+|Bearer)/i, '').replace(/\s/g, '');

    const systemParts = messages
        .filter(m => m.role === 'system')
        .map(m => ({ text: m.content }));

    const nonSystemMessages = messages.filter(m => m.role !== 'system');

    const rawContents = nonSystemMessages.map(m => {
        const parts = [];
        if (m.image) {
            const prefix = m.image.split(',')[0];
            const base64Data = m.image.split(',')[1];
            const mimeType = prefix.match(/:(.*?);/)[1];
            parts.push({ inlineData: { mimeType, data: base64Data } });
        }
        if (m.content) parts.push({ text: m.content });
        else if (m.image) parts.push({ text: 'Please process this image.' });
        
        return {
            role: m.role === 'assistant' ? 'model' : 'user',
            parts
        };
    }).filter(c => c.parts.length > 0);

    const contents = [];
    for (const entry of rawContents) {
        if (contents.length > 0 && contents[contents.length - 1].role === entry.role) {
            contents[contents.length - 1].parts.push(...entry.parts);
        } else {
            contents.push({ role: entry.role, parts: [...entry.parts] });
        }
    }

    if (contents.length > 0 && contents[contents.length - 1].role === 'model') {
        contents.push({ role: 'user', parts: [{ text: 'Please continue.' }] });
    }

    const endpoint = useStream
        ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`
        : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const requestBody = { contents };
    if (systemParts.length > 0) {
        requestBody.systemInstruction = { parts: systemParts };
    }

    let res;
    let lastError = null;
    
    for (let i = 0; i < 3; i++) {
        try {
            res = await fetch(endpoint, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-goog-api-key': cleanKey
                },
                body: JSON.stringify(requestBody),
                ...(signal ? { signal } : {})
            });

            if (res.ok) break;

            let errMsg = `Gemini API Error (HTTP ${res.status})`;
            try { const errorData = await res.json(); errMsg = errorData.error?.message || errMsg; } catch (_) { }
            lastError = new Error(errMsg);

            if (res.status === 429 || res.status === 503) {
                await new Promise(r => setTimeout(r, 2000 * (i + 1))); 
            } else {
                throw lastError; 
            }
        } catch (err) {
            if (signal && signal.aborted) throw new Error('The user aborted a request');
            throw err;
        }
    }

    if (!res?.ok) throw lastError;

    if (useStream) return await readGeminiStream(res, onChunk);

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty response from Gemini API.');
    return text;
}

// ─── Generic OpenAI Format (Groq, OpenAI, OpenRouter) ───────────────────
async function callOpenAIFormat(model, messages, apiKey, endpoint, onChunk, signal = null) {
    if (!endpoint) throw new Error('API endpoint is missing.');

    const useStream = typeof onChunk === 'function';

    const formattedMessages = messages.map(m => {
        if (m.image) {
            return {
                role: m.role,
                content: [
                    { type: 'image_url', image_url: { url: m.image } },
                    { type: 'text', text: m.content || 'Please process this image.' }
                ]
            };
        }
        return { role: m.role, content: m.content };
    });

    const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify({ model, messages: formattedMessages, stream: useStream }),
        ...(signal ? { signal } : {})
    });

    if (useStream) return await readStream(res, onChunk);
    return await handleOpenAIResponse(res);
}

// ─── Anthropic API ──────────────────────────────────────────────────────
async function callAnthropic(model, messages, apiKey, onChunk, signal = null) {
    if (!apiKey) throw new Error('Anthropic API Key is missing. Please add it in Settings.');

    const useStream = typeof onChunk === 'function';
    let systemPrompt = '';
    const anthropicMessages = [];

    for (const m of messages) {
        if (m.role === 'system') {
            systemPrompt += m.content + '\n';
        } else {
            if (m.image) {
                const content = [];
                const match = m.image.match(/^data:(image\/[a-zA-Z]+);base64,(.*)$/);
                if (match) {
                    content.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } });
                }
                content.push({ type: 'text', text: m.content || 'Please analyze this.' });
                anthropicMessages.push({ role: m.role, content });
            } else {
                anthropicMessages.push({ role: m.role, content: m.content });
            }
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
            model,
            system: systemPrompt.trim(),
            messages: anthropicMessages,
            max_tokens: 4096,
            stream: useStream
        }),
        ...(signal ? { signal } : {})
    });

    if (!res.ok) {
        let errMsg = `Anthropic API Error (HTTP ${res.status})`;
        try { const e = await res.json(); errMsg = e.error?.message || errMsg; } catch (_) {}
        throw new Error(errMsg);
    }

    if (useStream) return await readAnthropicStream(res, onChunk);

    const data = await res.json();
    const text = data.content?.[0]?.text;
    if (!text) throw new Error('Empty response from Anthropic API.');
    return text;
}

// ─── Stream Readers ─────────────────────────────────────────────────────
async function readStream(res, onChunk) {
    if (!res.ok) return await handleOpenAIResponse(res);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line in buffer

        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
                const json = JSON.parse(data);
                const chunk = json.choices?.[0]?.delta?.content;
                if (chunk) {
                    fullText += chunk;
                    onChunk(chunk, fullText);
                }
            } catch (_) {}
        }
    }
    return fullText;
}

async function readGeminiStream(res, onChunk) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            try {
                const json = JSON.parse(data);
                const chunk = json.candidates?.[0]?.content?.parts?.[0]?.text;
                if (chunk) {
                    fullText += chunk;
                    onChunk(chunk, fullText);
                }
            } catch (_) {}
        }
    }
    return fullText;
}

async function readAnthropicStream(res, onChunk) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            try {
                const json = JSON.parse(data);
                if (json.type === 'content_block_delta') {
                    const chunk = json.delta?.text;
                    if (chunk) {
                        fullText += chunk;
                        onChunk(chunk, fullText);
                    }
                }
            } catch (_) {}
        }
    }
    return fullText;
}

// ─── Response Helper ───────────────────────────────────────────────────
async function handleOpenAIResponse(res) {
    const contentType = res.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
        if (res.status === 401) throw new Error('Invalid API key. Please check Settings.');
        if (res.status === 403) throw new Error('Access denied. Your key may not have permission for this model.');
        if (res.status === 429) throw new Error('Rate limited. Please wait and try again.');
        if (res.status === 503) throw new Error('AI service temporarily unavailable. Try again shortly.');
        throw new Error(`API error (HTTP ${res.status}). Check your key in Settings.`);
    }

    if (!res.ok) {
        let errMsg = `AI API Error (HTTP ${res.status})`;
        try { const e = await res.json(); errMsg = e.error?.message || errMsg; } catch (_) {}
        throw new Error(errMsg);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty response from AI. Try again.');
    return content;
}
