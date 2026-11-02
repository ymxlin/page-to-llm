# Page to LLM

A Chrome/Edge extension that sends the web page you're reading to your own AI model and lets you chat about it.
It works with any OpenAI-compatible `/chat/completions` endpoint, such as OpenAI, llama.cpp, Ollama, LM Studio or vLLM.

## Features

- **Send page:** send the page's text, or just your highlighted selection.
- **Pick element:** point at part of a page, like the DevTools inspector. ↑/↓ move to the parent/child element.
- **Screenshots:** send text only, text + screenshot, or screenshot only (needs a vision-capable model).
- **Chat:** see what was sent, then ask follow-ups. Each tab keeps its own conversation.
- **Markdown replies** that stream in live.

## Install from source

1. Open `chrome://extensions` or `edge://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Open the extension's **Settings** and enter your endpoint's base URL, model and API key (if it needs one).

## Privacy

Page content, screenshots and your messages go only to the endpoint you configure. Settings stay in your browser,
and conversations are cleared when you close the tab or the browser. There is no tracking and no server of ours.

## Third-party code

`vendor/` contains [marked](https://github.com/markedjs/marked) and [DOMPurify](https://github.com/cure53/DOMPurify), under their own licenses.
