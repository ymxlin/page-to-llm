// Used by the background worker.

// Builds the chat messages for a conversation. The first user turn carries the
// page content (and the screenshot, in the multi-part format vision models expect).
// Failed assistant turns are left out.
function buildMessages(s, source, turns, imageDataUrl) {
  const context = `Page title: ${source.title}\nURL: ${source.url}\n\n` +
    (source.text ? `---\n${source.text}\n---\n\n` : "");
  const messages = [{ role: "system", content: s.systemPrompt }];
  turns.filter((t) => !t.error).forEach((t, i) => {
    if (i > 0) return messages.push({ role: t.role, content: t.text });
    const text = context + t.text;
    messages.push({
      role: "user",
      content: imageDataUrl
        ? [{ type: "text", text }, { type: "image_url", image_url: { url: imageDataUrl } }]
        : text,
    });
  });
  return messages;
}

async function streamChat(s, messages, onChunk, signal) {
  const headers = { "Content-Type": "application/json" };
  if (s.apiKey) headers.Authorization = `Bearer ${s.apiKey}`;

  const res = await fetch(`${s.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: s.model, messages, stream: true }),
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

  // Some servers ignore stream:true and return a plain JSON body.
  if (!(res.headers.get("content-type") || "").includes("text/event-stream")) {
    const data = await res.json();
    onChunk(data.choices?.[0]?.message?.content ?? JSON.stringify(data, null, 2));
    return;
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      const payload = line.replace(/^data:\s*/, "").trim();
      if (!line.startsWith("data:") || !payload || payload === "[DONE]") continue;
      const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
      if (delta) onChunk(delta);
    }
  }
}
