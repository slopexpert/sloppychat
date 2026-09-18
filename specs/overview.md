# sloppychat overview

- chat interface that works with any OpenAI compatible API, custom providers and all
- automatic model discovery when applicable
- themes, with auto dark and light mode as well
- live markdown with regex rendering
- token streaming
- must support basic tool calls, ideally client side
    - `web_search` via SearXNG
    - `web_fetch` with Reader mode style summarization (check pi-minimal-web for this)
- must support images
- build with sveltekit and tailwind
- single user, use sqlite3 to persist
