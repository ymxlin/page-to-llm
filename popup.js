// The popup only renders: the background worker owns the conversation
// (see background.js) and we redraw whenever its storage entry changes.
const $ = (id) => document.getElementById(id);
let tab;
let busy = false;

for (const a of document.querySelectorAll(".openOptions")) {
  a.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

loadSettings().then((s) => { $("content").value = s.content; });

const send = (msg) => chrome.runtime.sendMessage({ tabId: tab.id, ...msg });

init();

async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const keys = [`conv:${tab.id}`, `img:${tab.id}`];
  const data = await chrome.storage.session.get(keys);
  render(data[keys[0]], data[keys[1]]);

  chrome.storage.session.onChanged.addListener(async (changes) => {
    if (!keys.some((k) => k in changes)) return;
    const data = await chrome.storage.session.get(keys);
    render(data[keys[0]], data[keys[1]]);
  });
}

/* ---------- start view ---------- */

$("send").addEventListener("click", sendPage);
$("pick").addEventListener("click", pick);
$("prompt").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) sendPage();
});

const startOpts = () => ({
  instruction: $("prompt").value.trim(),
  includeText: $("content").value !== "image",
  includeImage: $("content").value !== "text",
});
const showStartError = (err) => { $("startError").textContent = err ? err.message || String(err) : ""; };

// Hands off to picker.js in the page; the popup closes as soon as the page is clicked anyway.
async function pick() {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (o) => { window.__p2lOpts = o; },
      args: [startOpts()],
    });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["picker.js"] });
    window.close();
  } catch (err) {
    showStartError(err);
  }
}

// Runs inside the page: the selection if there is one, otherwise the whole visible body text.
function extractPage() {
  const selection = String(window.getSelection() || "").trim();
  return {
    mode: selection ? "selection" : "page",
    title: document.title,
    url: location.href,
    text: selection || document.body.innerText,
  };
}

async function sendPage() {
  showStartError(null);
  $("send").disabled = true;
  try {
    const [{ result: source }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPage,
    });
    if (!source.text && $("content").value === "text") throw new Error("No text found on this page.");
    const res = await send({ type: "start", windowId: tab.windowId, source, ...startOpts() });
    if (res?.error) throw new Error(res.error);
  } catch (err) {
    showStartError(err);
  } finally {
    $("send").disabled = false;
  }
}

/* ---------- conversation view ---------- */

$("newChat").addEventListener("click", () => send({ type: "clear" }));

$("composer").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return send({ type: "stop" });
  const text = $("followup").value.trim();
  if (!text) return;
  const res = await send({ type: "ask", text });
  if (res?.error) return alert(res.error);
  $("followup").value = "";
});

$("followup").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $("composer").requestSubmit();
  }
});

$("srcImg").addEventListener("click", (e) => e.target.classList.toggle("big"));

$("copyText").addEventListener("click", async (e) => {
  e.preventDefault(); // the button sits inside <summary>: don't expand/collapse the text
  const button = e.currentTarget;
  try {
    await navigator.clipboard.writeText($("srcText").textContent);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Copy failed";
  }
  setTimeout(() => { button.textContent = "Copy"; }, 1500);
});

// Model replies are usually Markdown. Sanitize the HTML, since replies can echo
// content from the page, and open links in a new tab instead of inside the popup.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});
const renderMarkdown = (text) => DOMPurify.sanitize(marked.parse(text, { gfm: true, breaks: true }));

function render(conv, image) {
  $("start").hidden = !!conv;
  $("conv").hidden = !conv;
  if (!conv) return $("prompt").focus();

  const { source, turns } = conv;
  $("srcBadge").textContent = source.mode === "element" ? `<${source.tag}>` : source.mode;
  $("srcTitle").textContent = source.title || source.url;
  $("srcTitle").href = source.url;
  $("srcTitle").title = source.url;
  $("srcMeta").textContent = !source.text ? "Screenshot only" :
    `${source.text.length.toLocaleString()} chars` +
    (source.fullLength > source.text.length ? ` (truncated from ${source.fullLength.toLocaleString()})` : "") +
    (source.hasImage ? " · screenshot" : "");
  $("srcText").textContent = source.text || "(no text)";
  $("copyText").hidden = !source.text;
  $("srcImg").hidden = !image;
  if (image && $("srcImg").src !== image) $("srcImg").src = image;

  const chat = $("chat");
  const atBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 40;
  chat.replaceChildren(...turns.map((t) => {
    const div = document.createElement("div");
    const md = t.role === "assistant" && !t.error && t.text;
    div.className = `msg ${t.role}${t.error ? " error" : ""}${t.streaming ? " streaming" : ""}${md ? " md" : ""}`;
    if (md) div.innerHTML = renderMarkdown(t.text);
    else div.textContent = t.error || t.text;
    if (t.streaming) div.style.setProperty("--phase", `-${Date.now() % 1200}ms`);
    if (t.stopped) div.append(Object.assign(document.createElement("span"), { className: "note", textContent: "(stopped)" }));
    return div;
  }));
  if (atBottom) chat.scrollTop = chat.scrollHeight;

  busy = turns.some((t) => t.streaming);
  $("ask").textContent = busy ? "Stop" : "Send";
  if (document.activeElement !== $("followup")) $("followup").focus();
}
