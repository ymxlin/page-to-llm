importScripts("settings.js", "llm.js");

// One conversation per tab, kept in chrome.storage.session so the popup can be
// closed and reopened without losing it:
//   conv:<tabId> = { source: {mode, tag?, title, url, text, fullLength, hasImage}, turns: [{role, text, streaming?, error?, stopped?}] }
//   img:<tabId>  = screenshot data URL (kept apart so streaming saves stay small)
// The popup renders from storage; this worker does all model calls.
const convKey = (tabId) => `conv:${tabId}`;
const imgKey = (tabId) => `img:${tabId}`;
const controllers = new Map(); // tabId -> AbortController of the reply in flight

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = msg.tabId ?? sender.tab?.id;
  handle(msg, sender, tabId).then(
    () => sendResponse({ ok: true }),
    (err) => sendResponse({ error: err.message || String(err) }),
  );
  return true; // async response
});

chrome.tabs.onRemoved.addListener((tabId) => {
  controllers.get(tabId)?.abort("clear");
  chrome.storage.session.remove([convKey(tabId), imgKey(tabId)]);
});

async function handle(msg, sender, tabId) {
  switch (msg.type) {
    case "start": return start(tabId, msg, sender);
    case "ask": return ask(tabId, msg.text);
    case "stop": return controllers.get(tabId)?.abort("stop");
    case "clear":
      controllers.get(tabId)?.abort("clear");
      return chrome.storage.session.remove([convKey(tabId), imgKey(tabId)]);
  }
}

// msg: { source: {mode, tag?, title, url, text}, instruction, includeText, includeImage, windowId?, rect?, viewportWidth? }
async function start(tabId, msg, sender) {
  const s = await loadSettings();
  const image = msg.includeImage
    ? await capture(msg.windowId ?? sender.tab.windowId, msg.rect, msg.viewportWidth)
    : null;
  const text = msg.includeText === false ? "" : msg.source.text;
  if (!text && !image) {
    throw new Error(msg.includeImage
      ? "Nothing to send: the element is off-screen and has no text."
      : "Nothing to send: no text found. Choose “Text + screenshot” to send it as an image.");
  }

  controllers.get(tabId)?.abort("clear");
  const source = {
    ...msg.source,
    text: text.slice(0, s.maxChars),
    fullLength: text.length,
    hasImage: !!image,
  };
  const conv = { source, turns: [{ role: "user", text: msg.instruction || s.defaultInstruction }] };
  await chrome.storage.session.set({ [convKey(tabId)]: conv, [imgKey(tabId)]: image });

  // Picked from the page: the popup closed when the page was clicked, so try to reopen it.
  if (sender.tab) chrome.action.openPopup({ windowId: sender.tab.windowId }).catch(() => {});
  reply(tabId, conv, s, image);
}

async function ask(tabId, text) {
  const conv = (await chrome.storage.session.get(convKey(tabId)))[convKey(tabId)];
  if (!conv) throw new Error("No conversation for this tab.");
  if (controllers.has(tabId)) throw new Error("Still answering – stop it first.");
  conv.turns.push({ role: "user", text });
  const image = (await chrome.storage.session.get(imgKey(tabId)))[imgKey(tabId)];
  reply(tabId, conv, await loadSettings(), image);
}

// Streams an assistant turn into conv, saving to storage as it goes (throttled).
async function reply(tabId, conv, s, image) {
  const abort = new AbortController();
  controllers.set(tabId, abort);
  const messages = buildMessages(s, conv.source, conv.turns, image);
  const turn = { role: "assistant", text: "", streaming: true };
  conv.turns.push(turn);

  const save = () => chrome.storage.session.set({ [convKey(tabId)]: conv });
  let lastSave = 0;
  await save();
  try {
    await streamChat(s, messages, (chunk) => {
      turn.text += chunk;
      if (Date.now() - lastSave > 150) {
        lastSave = Date.now();
        save();
      }
    }, abort.signal);
  } catch (err) {
    if (abort.signal.aborted) turn.stopped = true;
    else turn.error = err.message || String(err);
  } finally {
    turn.streaming = false;
    if (controllers.get(tabId) === abort) controllers.delete(tabId);
    // A cleared or replaced conversation must not be written back.
    if (abort.signal.reason !== "clear") await save();
  }
}

// Screenshot the visible tab, cropped to rect (CSS pixels) when given.
async function capture(windowId, rect, viewportWidth) {
  const shot = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  if (!rect) return shot;

  const bitmap = await createImageBitmap(await (await fetch(shot)).blob());
  const scale = bitmap.width / viewportWidth; // device pixel ratio, incl. zoom
  const x = Math.max(0, Math.round(rect.x * scale));
  const y = Math.max(0, Math.round(rect.y * scale));
  const w = Math.min(bitmap.width, Math.round((rect.x + rect.width) * scale)) - x;
  const h = Math.min(bitmap.height, Math.round((rect.y + rect.height) * scale)) - y;
  if (w <= 0 || h <= 0) return null; // element is off-screen

  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext("2d").drawImage(bitmap, x, y, w, h, 0, 0, w, h);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(bin)}`;
}
