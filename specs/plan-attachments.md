# Plan for the next work: attachments and the command palette

## Status

Steps 1 to 6 are done: drop anywhere, jsonc and json5, the line count fix, the read back
route with the expandable attachment, and the long paste becoming a file. Nothing is
committed yet. Step 7, the command palette, is the next thing to start.

## Where the tree stands

- Feature 4, the prompt library, is committed as `215e861 add prompt library with slash commands`
- Feature 6, text and code attachments, is finished but **not committed**. `git status` shows
  nine modified files plus `src/lib/shared/files.ts`, `test/files.spec.ts` and the new
  `src/routes/api/documents` behaviour
- `npm test` gives 399 tests in 32 files, `npm run check` gives no error and no warning
- jsdom is present in `node_modules` from a `--no-save` install. It is not in
  `package.json`. Drop it with `npm prune` or add it on purpose

Commit feature 6 before starting, so the five fixes below land as their own commit.

## Purpose

Five fixes to the attachment path the user reported, then the command palette from the
feature list. Each step has a goal, the work, the files, and the test.

## Step 1. Drop a file anywhere on the page

Goal: a drop works anywhere in the window, not only on the composer card.

Work: move the drop handling from the composer card to the window. Add
`ondragover`, `ondragleave` and `ondrop` on `<svelte:window>` in `src/routes/+page.svelte`,
and show a full window overlay with "Drop files to attach" while a file drag is over the
page. Only react when `event.dataTransfer?.types` includes `Files`, so the chat drag and
drop of folders and tags keeps working and a text selection drag is ignored. Use a small
counter rather than a boolean for enter and leave, because dragleave fires for every child
element. Remove `ondragover`, `ondragleave`, `ondrop` and the `dragging` border from
`Composer.svelte`; keep `app.attach(files)` as the single entry point.

Files: `src/routes/+page.svelte`, `src/lib/components/Composer.svelte`,
`src/lib/client/state.svelte.ts` if the overlay flag belongs on the app state.

Test: `test/accessibility.spec.ts` gains a check that the composer card no longer owns the
drop handlers and that the page renders the overlay markup only while dragging. A render
test cannot drive a real drop, so the drop path stays covered by the manual check plus the
unit tests of `app.attach`.

## Step 2. Accept jsonc and json5

Goal: commented JSON attaches.

Work: add `jsonc`, `json5` and `geojson` to `TEXT_EXTENSIONS`, and map them in `FENCES` to
`jsonc` and `json5`. The fence name is only a hint for the model, so no change is needed in
the markdown highlighter.

Files: `src/lib/shared/files.ts`, `README.md`.

Test: `test/files.spec.ts` adds `isTextFile({ name: 'settings.jsonc' })` and
`codeLanguage('a.jsonc')`.

## Step 3. Keep the line count of a text file after it is sent

Goal: the message row shows the real line count, not `0 lines`.

Cause, found: `src/routes/api/conversations/[id]/messages/+server.ts` line 24 rebuilds each
document from the store as `{ id, name, pages, chars }`. That drops `lines`, so the chip
before the send is right and the row after it is wrong. The queued message path may do the
same; check it too.

Work: read `lines` from the store instead of dropping it. Either return it from
`getDocument()` and copy it here, or recompute it with `countLines(stored.text)`, which is
the same function the upload used.

Files: `src/lib/server/store.ts` (`getDocument`), `src/routes/api/conversations/[id]/messages/+server.ts`,
`src/routes/api/conversations/[id]/queue/+server.ts` if it rebuilds refs the same way.

Test: `test/files.spec.ts` posts a message with a text document through the route handler and
asserts `message.documents[0].lines === 2`.

## Step 4. Read an attachment from the chat

Goal: expanding an attachment shows what was sent, so a chat stays reviewable.

Work: add `GET /api/documents/[id]` that returns the stored name, mime, pages, chars and the
text, cut to a display cap of about 20000 characters with a flag that says more exists. In
`MessageItem.svelte` put a caret button on each attachment chip that toggles a `pre` block
under it, with `max-h-64 overflow-y-auto`, a monospace face, and a second button "Copy".
PDF text and text files both read from the same row, so no new table is needed. Keep the
block out of the print and announce state with `aria-expanded`.

Files: `src/routes/api/documents/[id]/+server.ts` (new), `src/lib/client/api.ts`,
`src/lib/components/MessageItem.svelte`, `src/lib/shared/files.ts` if the display cap wants
one home.

Test: a route test that an unknown id gives 404 and a stored row returns its text; a render
test that the toggle button carries an accessible name and `aria-expanded`.

## Step 5. Paste long text as a file

Goal: a pasted wall of text becomes an attachment instead of filling the composer.

Work: in `Composer.onPaste`, when the clipboard holds no file and the text length passes a
threshold, build a `File` from the text and pass it to `app.attach`, then
`event.preventDefault()`. Name it `pasted-<month><day>-<hour><minute>.txt`, and keep a
counter while one is already pending. Put the threshold in `shared/files.ts` as
`PASTE_AS_FILE_CHARS = 2000` so the tooltip and the code agree. Keep an escape hatch:
`Ctrl+Shift+V` pastes into the box as today, because some users want the text inline; say so
in the composer tooltip.

Files: `src/lib/components/Composer.svelte`, `src/lib/shared/files.ts`, `README.md`.

Test: `test/files.spec.ts` covers the name builder and the threshold rule; the paste wiring
is checked by hand.

## Step 6. Close the attachment work

Goal: the documents and the checks agree with the code.

Work: update `README.md`, the "Text and code files" section, for the drop target, jsonc, the
read path and the paste rule. Run `npm test`, `npm run check`, `npm run build`, then
`npm run test:e2e` after a build. One commit for step 1 to 5, or one per step if that reads
better in the log.

## Step 7. Command palette on Ctrl+Shift+P

Goal: one keystroke reaches every action, keyboard first as the README promises. `Ctrl+K`
stays chat search.

Work: a modal with an input and a filtered list of commands, arrow keys and Enter to run one,
Escape to close, focus returned to where it came from. Commands to start with: new chat,
rename chat, stop the turn, open settings, open parameters, toggle the sidebar, pick the next
model of the current provider, set a tool to off, ask or on, and jump to a chat by title,
which reuses `app.searchChats`. Keep the command list in one array in
`src/lib/shared/commands.ts` so the palette and a later keymap share it. Do not put a second
binding in three components: one window listener that ignores keystrokes inside a field other
than the palette input.

Files: `src/lib/shared/commands.ts` (new), `src/lib/components/CommandPalette.svelte` (new),
`src/routes/+page.svelte`, `src/lib/client/state.svelte.ts`, `README.md`.

Test: unit tests for the filter and for the command list shape; a render test for the
accessible name, and that Escape is listed in the dialog rules of
`test/accessibility.spec.ts`.

## Risks

- A window level drop handler can swallow the chat drag and drop. The `Files` type check is
  the guard, so a regression there is visible only in the browser: check folders and tags by
  hand.
- A paste threshold that is too low turns the composer into a file machine. 2000 characters is
  a guess; be ready to move it to Settings.
- The read path serves stored text, so it must stay behind the same single user assumption as
  the rest of the API. There is no access control in this app by design.
- A message tree change is not needed here, but step 3 touches document refs, which the
  queued message table also stores. Check the queue path in the same pass.
