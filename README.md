# sloppychat

Single user chat UI for any OpenAI compatible endpoint. SvelteKit, Tailwind, sqlite.

## Features

- Any OpenAI compatible API, several providers side by side, keys per provider
- Model discovery from `GET /models`, shown in a dropdown with vision and context hints
- Token streaming over server-sent events, plus reasoning output shown separately
- Follow up messages sent while an answer is still streaming are queued and sent
  when the turn finishes, in the order they were typed
- Turns run on the server, not in the tab. Reloading, closing the page, opening the
  same chat on another device, or switching chats mid answer all leave the model
  generating; the page reattaches and continues from what has arrived. Only Stop
  ends a turn
- Throughput statistics per answer: prefill (pp) and generation (tg) tokens per second,
  time to first token, and a live estimate while the answer streams.
- A context gauge in the top bar showing how full the model's window is, shaded accent
  to red as it fills. The window comes from model discovery: `context_length`,
  `context_window`, `max_context_length` or `max_model_len` at the top level, and
  `details` or `meta.n_ctx_train` where llama.cpp and friends put it. Hovering gives the
  totals, what is left, and the last turn's input and output tokens.
- For providers that report no window at all - OpenAI's own API lists model ids only -
  a small table of known families fills the gap. Those values are marked: `~128k` in the
  model picker and "window assumed for this model" in the gauge tooltip. Delete
  `contextWindowFor`'s table lookup if you would rather see nothing.
- The live speed sits under the streaming answer: prefill tokens per second while the
  model is still reading the prompt, then generation tokens per second once it starts.
  The prefill figure is what makes a slow local model bearable to watch. It stays under
  the user message afterwards as the exact figure for that prompt, and finished answers
  keep a brief line without hovering - `40.0 tok/s · 256 tok` - with the full breakdown
  in its tooltip. The hover actions sit on that same line rather than a row of their own. Rates reported by the
  server itself win over wall clock measurement: llama.cpp `timings` and vLLM
  per-request `metrics` are both read, and the line is marked `server` when they are
  used
- Live markdown rendered by a regex renderer, safe for partial (streaming) input
- LaTeX math, rendered to MathML with KaTeX: `$inline$`, `$$display$$`, `\(inline\)`,
  `\[display\]` and a bare `\begin{align}` block. MathML is used deliberately, so no
  formula stylesheet or webfont has to be downloaded and the browser draws the formula
  itself. One unreadable token costs only itself: it shows in the danger colour inside an
  otherwise correct formula, instead of turning the whole line back into source text. The
  siunitx macros models reach for, `\quantity`, `\qty`, `\SI`, `\si`, `\unit` and `\num`,
  are read as plain TeX with the unit kept upright
- Client side tool calls: `web_search` through SearXNG, `web_fetch` with reader mode extraction
- Skills, following the usual agent skills layout: upload markdown files with `name`
  and `description` frontmatter, or write them in Settings. Only the names and
  descriptions go into the prompt; the model pulls the instructions in with the
  `read_skill` tool when a task matches, so a large library stays cheap on context
- Prompt library: reusable snippets and system prompts, written in Settings. Type `/name` at
  the start of a line and Enter sends the message with the command filled in, so
  `/notes draft this` leaves as the prompt text plus the rest of the line. The menu lists the
  slug only, and Tab inserts the picked entry while you type, with its first blank selected.
  A system prompt is offered by the params panel of any chat
- Copy where you need it: every fenced block has its own copy button, an answer copies as
  markdown or as plain text, and any message or selection quotes into the message box
- Images: attach, paste or drop them, stored in sqlite and inlined for vision models
- PDFs: text is extracted page by page and pages are rendered to images, so text only
  models get the text and vision models also get the pages
- Text and code files: `.ts`, `.py`, `.md`, `.json`, `.jsonc`, `.csv`, `.sql` and about seventy
  more, plus `Makefile` and friends, are stored as typed and sent inside a fence marked with
  the language. A binary file is refused rather than guessed at. Drop one anywhere on the
  page, and open an attachment in the chat to read back what was sent
- Twelve named themes such as Rosé Pine, Catppuccin, Tokyo Night, Gruvbox, Nord and
  VS Code, each with a light and a dark variant where the palette has both, plus a
  System or custom font, three text sizes, five corner radii and three padding
  densities, all set in Settings, Appearance
- Fenced code is coloured from the palette you picked: every theme carries the syntax
  colours of its upstream project, on that palette's own code background
- The chat list is a column when the window is wide and a drawer over the conversation
  when it is not, with a backdrop, Escape to close, and focus handed back to the toggle
- Every generation parameter is editable, per chat or as a global default
- Everything persisted in one sqlite file, no accounts

## Requirements

- Node 22.5 or newer, because the store uses the built in `node:sqlite` module
- Optional: a SearXNG instance with `json` enabled under `search.formats` for web search

## Run

```sh
npm install
npm run dev          # http://localhost:5173
```

Production:

```sh
npm run build
npm start            # PORT=3000 by default
```

## First steps

1. Open Settings, press Add provider and pick a preset, or type a base URL such as
   `http://localhost:11434/v1` for Ollama. API keys are optional for local servers.
2. Press Discover models, then pick a model in the top bar.
3. For web search, set the SearXNG URL under Settings, Tools.
4. The params panel sets temperature, top p, top k, min p, penalties, seed, stop
   sequences, reasoning effort, tool choice and raw extra JSON, per chat.

## How the model is chosen

- Model lists are discovered on page load, in the background, for every provider you
  have. Adding or editing a provider also refreshes its list
- A new chat starts with the provider and model that are already in view, so you keep
  working with the same model
- Pressing New chat puts the caret in the message box, and closes the chat drawer on a
  narrow screen, so typing starts without another click
- A chat with no model picks, in order: the model last used with that provider, the
  provider's default model, then the first model the provider reports. The choice is
  saved on the chat straight away, so sending works without touching the picker
- Whatever model actually runs is remembered, so a fresh session starts where the last
  one left off

## Skills

A skill is one markdown file:

```markdown
---
name: release-notes
description: Use when the user asks for release notes or a changelog.
---

# Release notes

1. Collect the merged pull requests since the last tag.
```

- Upload one or more files under Settings, Skills, or press New skill and type it
  there in a plain text box
- The `name` is normalised to lowercase-hyphen form, and a file without frontmatter
  falls back to its filename and first line
- Enabled skills are listed by name and description in the system prompt, and
  `read_skill` fetches the full instructions when the model asks for them
- Disable a skill to keep it out of the prompt without deleting it

## Prompt library

A prompt is one text with a title, stored under Settings, Prompts. Two kinds:

- `message snippet`: type `/` at the start of a line in the composer and keep typing the
  slug. The menu lists the slugs, arrow keys move through them, Tab inserts the picked entry
  at the caret, and Escape closes the menu. Enter always sends, and the send fills the
  command in first: `/notes draft this` leaves as the prompt text followed by `draft this`.
  Only a slug that names a prompt is filled in, so `/etc/hosts` stays a path, and a slash in
  the middle of a line is left alone
- `system prompt`: the params panel lists these above the system field. Picking one copies
  the text into the field, where it stays editable

Both kinds can hold variables, filled in where the text is used:
`{{date}}`, `{{time}}`, `{{datetime}}`, `{{model}}`, `{{provider}}`, `{{chat}}`. The system
prompt is filled again on every request, so `{{date}}` never goes stale in a long chat.
Any other name in braces, `{{topic}}` for example, is left alone: in a snippet it becomes
the blank the caret lands on, and in a system prompt it stays visible as a hole to fill.

## Text and code files

An attached plain file skips every conversion step. The rules live in
`src/lib/shared/files.ts`, which the file picker, the upload route and the prompt builder
all read, so they cannot disagree:

- the extension, or a name such as `Makefile`, `Dockerfile` or `CMakeLists.txt`, decides it
  is text, and a mime type of `text/...` is trusted on its own
- a paste of 2000 characters or more becomes an attachment called `pasted-20260814-1705.txt`,
  which keeps a long log out of the message box. `Ctrl+Shift+V` pastes inline as before
- the bytes have the final say: a NUL byte or too many control characters means the file is
  refused, so a renamed object file cannot reach the prompt
- files stop at 2 MB whole, and each one is cut at Settings, Tools, "Characters per attached
  file" with `[file text truncated]` marked
- the text is sent as its own block after the question, fenced with the language of the
  extension, and the fence grows when the body holds backticks
- the file picker lists the known extensions, and a drop works anywhere on the page: the
  window answers it, shows a dashed frame while a file drag is over the page, and asks the
  server what to do with it. A drag that carries no file, such as moving a chat into a
  folder, is left alone
- every attachment in the chat opens with a caret to show the text that was sent, with a copy
  button. The text is read back from sqlite, so an old chat stays reviewable after the
  original file is gone

## Copying and quoting

Text leaves the chat in four ways:

- every fenced block carries a copy button in its top right corner, shown on hover and
  always visible on touch. It takes the code exactly as written, without the language label
- an answer copies as markdown, which is the stored text, and as plain text, which drops the
  markup for a terminal or a log
- any message quotes into the message box. With a selection inside that message the
  selection is quoted, otherwise the whole text. The quote lands below what is already
  typed, the caret goes to the end, and the field takes focus
- drag across a few words in the chat and a small Quote chip floats beside them. `Alt+Q`
  does the same from the keyboard. A selection outside the conversation, such as in the chat
  list, gets no chip
- the chip lets go on its own: it disappears when the selection is cleared, when the
  conversation scrolls, and when you switch chat
- an open attachment keeps a copy button for the text that was sent

## PDF handling

A PDF attached to a message is processed on the server with mupdf (WASM):

- Text is extracted per page and inlined as one text part, capped by
  Settings, Tools, "PDF text per message"
- Pages are rendered to JPEG at about 1400 px on the long edge and inlined as image
  parts, capped by "PDF page images"
- When the picked model is reported as text only, the client skips the page images and
  sends the text alone
- A PDF with no extractable text still reaches a vision model through its pages

## Environment

| Variable | Meaning |
| --- | --- |
| `PORT`, `HOST` | Listen address of the production server |
| `ORIGIN` | Public origin, needed behind a proxy |
| `SLOPPYCHAT_DATA_DIR` | Directory for the database, default `./var` |
| `SLOPPYCHAT_DB` | Full path to the database file, overrides the directory |
| `SLOPPYCHAT_TOKEN` | Token every device must send to reach the app. Unset means loopback only |

## Who may open the app

The server has one door, and `SLOPPYCHAT_TOKEN` is the key to it:

- **Token set.** A device opens `http://<host>:<port>/?token=<token>` once. The server
  puts the token in an `HttpOnly` cookie and drops it from the address, so the browser
  history keeps no copy. Every later request, the chat stream included, rides on the
  cookie.
- **Token unset.** The server answers `127.0.0.1` and refuses every other address with
  403. Starting the app on a shared machine therefore shares nothing by accident.

The token is checked with a hash and a fixed-time compare, so neither its length nor
where a guess differs is readable from the timing. Set it to anything long enough to
not be guessed, for example `openssl rand -hex 24`.

Secrets stay on the server. A provider key, the search key, and the environment and
headers of an MCP server are never sent to the browser: the settings window says "is
set, type to replace" and writes only what you type. Clearing one takes the Remove key
button, or an empty value where the app sends one on purpose.

## web_fetch safety

`web_fetch` runs on the server, so the fetcher is built against SSRF:

- Only http and https, no credentials in the URL, public ports limited to 80 and 443
- Every resolved address is classified. Loopback, RFC1918, carrier grade NAT, unique
  local and link local space are refused, so a name cannot point at a metadata service
- The socket connects to the address that was checked, which defeats DNS rebinding
- Redirects are followed by hand and each hop repeats every check
- The body is capped while it streams in

Settings, Tools has "allow private and loopback hosts" for local testing. Even then,
link local, multicast and reserved ranges stay blocked.

## Theming

The theme sets the whole palette, accent included. A theme is a family with a variant
per scheme, so the browser's `prefers-color-scheme` picks the light or dark one:
Catppuccin is Latte or Mocha, Rosé Pine is Dawn or the main palette, Gruvbox and VS Code
have both too. Families with a single variant, such as Nord, OLED and Tokyo Night, keep
their own scheme. There is no light or dark setting to manage.

A family may also pick its own tone for inline code with the `--code` token, which falls
back to the accent so untouched palettes keep today's look. Rosé Pine and Rosé Pine Moon set
it to their gold, which reads as lemon against the pink accent; Dawn sets a darker gold,
because its own gold only reaches 1.9:1 on that pale background.

Fenced code takes six colours from the `--syn-*` tokens, one for each role the highlighter
emits: comment, string, number, keyword, function, punctuation. The default palette derives
them from the accent. Every named palette sets the real values of its upstream project,
following the role guide of the palette (Rosé Pine), the editor theme of the project
(Catppuccin, Tokyo Night, Gruvbox, Nord) or the grammar the theme inherits (VS Code Dark+
and Light+). Blocks sit on `--code-bg`, which each palette keeps at its own background, so
code reads as a panel set into the conversation. Where a role colour cannot clear 4.5:1 on
that background, the palette takes the nearest readable step of the same hue, and the line
says so; comments only have to clear 3:1, because every palette dims them on purpose.
`test/appearance.spec.ts` checks both rules and spot checks one role per family against the
upstream value.

Two details keep the first paint clean:

- A pre-paint script in `src/app.html` resolves the family and the system scheme to a
  variant and sets `data-theme`, `data-mode` and the other appearance attributes on
  `<html>`, so the theme is correct before any stylesheet arrives
- The same file inlines the critical background, foreground and `color-scheme`, plus a
  themed `#boot` placeholder that the layout removes on mount. Without this, the page
  flashes white while the app stylesheet loads, which is visible in dev where Vite
  injects CSS through JavaScript

`test/boot.spec.ts` checks the ordering and compares the inline colours with the
`:root` and `[data-mode='dark']` tokens in `src/app.css`, so the two cannot drift apart.

## Accessibility

The interface is built for keyboard first use, which also keeps keyboard driven
browsers happy:

- The message box is the first text field in the document. The chat title is a
  heading with a rename button, so nothing competes with it. Tridactyl's `gi` and
  plain `Tab` therefore land in the composer
- The composer is rendered before the first data arrives, so `gi` works during load
- A skip link jumps to the composer, and every icon only control has an accessible name
- Focus is visible on every control, dark mode follows the system, and colours stay
  above a 4.5:1 contrast ratio
- The conversation is a live region with `role="log"`, so new answers are announced
- The settings dialog traps Tab, closes on Escape, and marks the rest of the page inert
- Animations are dropped when the system asks for reduced motion

`test/accessibility.spec.ts` renders the page and checks these rules, including the
first text field rule that `gi` depends on.

## Tests

```sh
npm test             # markdown, stats, SSRF classification, PDF extraction, accessibility
npm run test:e2e     # build first: mock provider, tool loop, images and PDF end to end
```

## Layout

```
src/lib/server/     db, store, openai client, bridge, sse, search, fetcher, safe-fetch, pdf, reader
src/lib/shared/     types, markdown renderer, stats, tool catalog, parameter merging
src/lib/client/     api client, app state with the tool loop, tool executor
src/lib/components/ chat view, composer, sidebar, settings, parameter panel
src/routes/api/     settings, providers, conversations, chat, chat/tools, search, fetch, images, documents
```

The reader mode extraction under `src/lib/server/reader` is ported from pi-minimal-web.
