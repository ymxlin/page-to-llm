// Injected into the page by the popup. DevTools-style element picker:
// hover to highlight, w/s to move to parent/child, click to send, Esc to cancel.
// The chosen element goes to the background worker; the conversation shows in the popup.
(() => {
  window.__p2lCleanup?.();
  const opts = window.__p2lOpts || {};

  const host = document.createElement("div");
  host.style.cssText = "all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      .box { position: fixed; background: rgba(66,133,244,.25); outline: 2px solid #4285f4;
             pointer-events: none; display: none; }
      .tag { position: fixed; background: #222; color: #fff; font: 11px/1.4 monospace;
             padding: 2px 6px; border-radius: 3px; pointer-events: none; display: none; white-space: nowrap; }
      .hint { position: fixed; top: 8px; left: 50%; transform: translateX(-50%); background: #222; color: #fff;
              font: 12px system-ui, sans-serif; padding: 6px 12px; border-radius: 4px; pointer-events: none;
              max-width: calc(100vw - 32px); }
      .hint.error { background: #b00020; }
    </style>
    <div class="box"></div><div class="tag"></div>
    <div class="hint">Click an element to send it &middot; w parent &middot; s child &middot; Esc cancel</div>`;
  document.documentElement.appendChild(host);

  const box = root.querySelector(".box");
  const tag = root.querySelector(".tag");
  const hint = root.querySelector(".hint");

  let current = null;
  const trail = []; // children we stepped up from, so ↓ can go back down

  function highlight(el) {
    current = el;
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: "block", left: `${r.left}px`, top: `${r.top}px`,
                               width: `${r.width}px`, height: `${r.height}px` });
    const cls = [...el.classList].slice(0, 2).map((c) => `.${c}`).join("");
    tag.textContent = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${cls}  ${Math.round(r.width)}×${Math.round(r.height)}`;
    Object.assign(tag.style, { display: "block", left: `${Math.max(0, r.left)}px`,
                               top: `${r.top > 22 ? r.top - 22 : r.bottom + 4}px` });
  }

  function onMove(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el && el !== host && el !== current) {
      trail.length = 0;
      highlight(el);
    }
  }

  function onKey(e) {
    if (e.key === "Escape") return cleanup();
    if (!current) return;
    if (e.key === "w" && current.parentElement && current.parentElement !== document.documentElement) {
      trail.push(current);
      highlight(current.parentElement);
    } else if (e.key === "n" && trail.length) {
      highlight(trail.pop());
    } else return;
    e.preventDefault();
    e.stopPropagation();
  }

  function swallow(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  function onClick(e) {
    swallow(e);
    if (current) select(current);
  }

  function stop() {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("mousedown", swallow, true);
    document.removeEventListener("mouseup", swallow, true);
    box.style.display = tag.style.display = hint.style.display = "none";
  }

  function cleanup() {
    stop();
    host.remove();
    delete window.__p2lCleanup;
  }
  window.__p2lCleanup = cleanup;

  function toast(text, isError) {
    hint.textContent = text;
    hint.classList.toggle("error", !!isError);
    hint.style.display = "block";
    setTimeout(cleanup, isError ? 6000 : 3000);
  }

  async function select(el) {
    stop();
    // Let the overlay disappear from the screen before the background takes a screenshot.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const r = el.getBoundingClientRect();
    const text = (el.innerText || el.getAttribute("alt") || el.getAttribute("aria-label") || "").trim();

    const res = await chrome.runtime.sendMessage({
      type: "start",
      source: { mode: "element", tag: el.tagName.toLowerCase(), title: document.title, url: location.href, text },
      instruction: opts.instruction,
      includeText: opts.includeText !== false,
      includeImage: !!opts.includeImage,
      rect: { x: r.left, y: r.top, width: r.width, height: r.height },
      viewportWidth: window.innerWidth,
    });
    if (res?.error) toast(res.error, true);
    else toast("Sent – click the extension icon to see the reply and chat.");
  }

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("mousedown", swallow, true);
  document.addEventListener("mouseup", swallow, true);
})();
