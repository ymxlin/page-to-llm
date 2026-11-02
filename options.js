const FIELDS = Object.keys(DEFAULTS);
const status = document.getElementById("status");

loadSettings().then((s) => {
  for (const k of FIELDS) document.getElementById(k).value = s[k];
});

document.getElementById("save").addEventListener("click", async () => {
  const s = {};
  for (const k of FIELDS) s[k] = document.getElementById(k).value.trim();
  s.baseUrl = s.baseUrl.replace(/\/+$/, "");
  s.maxChars = parseInt(s.maxChars, 10) || DEFAULTS.maxChars;

  let pattern;
  try {
    pattern = originPattern(s.baseUrl);
  } catch {
    status.textContent = "Invalid base URL.";
    return;
  }

  // Host permission lets the extension call the endpoint without CORS issues.
  // Must be requested from a user gesture, which this click is.
  const granted = await chrome.permissions.request({ origins: [pattern] });
  await chrome.storage.local.set(s);
  status.textContent = granted ? "Saved." : "Saved, but host permission was denied – requests may fail due to CORS.";
});
