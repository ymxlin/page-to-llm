// Shared defaults + loader used by both the popup and the options page.
const DEFAULTS = {
  baseUrl: "http://localhost:8080/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  systemPrompt: "You are a helpful assistant. The user will give you the text of a web page followed by an instruction.",
  defaultInstruction: "Summarize this page in a few bullet points.",
  maxChars: 50000,
  content: "text", // what to send by default: "text" | "both" | "image"
};

function loadSettings() {
  return chrome.storage.local.get(DEFAULTS);
}

// Origin pattern for the endpoint, e.g. "http://localhost:8080/*".
function originPattern(baseUrl) {
  const u = new URL(baseUrl);
  return `${u.protocol}//${u.hostname}/*`;
}
