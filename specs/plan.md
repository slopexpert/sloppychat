# Plan for the next work
## Purpose
The plan below gives the order of the next nine features. Each step has a goal, the work, the files, and the test. I do each step in the given order, because the next step uses the result of the step above.

## Scope
In scope:
- A menu for the tools, with three modes for each tool: off, ask first, or on.
- Execution of the tools on the server, with an approval step for the mode ask first.
- A queue on the server for the follow-up messages, which survives a reload.
- Exact token counts for llama.cpp and vLLM.
- Memory, with the same three modes.
- An MCP client in the app, so the model gets the tools of an MCP server.
- Branches for the messages, a Continue action, and a comparison of two models.
- Search across the chats, folders, tags, and pins.
- An installable app (PWA).

Out of scope. You said no to the features below:
- The passthrough of the tools that the backend owns.
- Cost tracking.
- Export and backup.
- Voice.
- The generation of images.
- Notifications.
- Retrieval with embeddings.
- A separate approval switch for one chat, because the menu holds the same mode.
- Code execution.
- Access control.

Two notes about the scope:
- The menu for the tools stays, because your answer about memory asks for the menu and the MCP tools of step 7 need a switch. The passthrough of the tools that llama.cpp owns is out, so the app ignores the tool list of the backend.
- The menu holds the mode ask first. That mode does the same work as the per-chat approval.

## Step 1. Add the tests that show the two defects
Goal: show the two defects before the repair.
Work: Add a test that starts a turn which needs a tool, and then closes the event stream. The test shows that the turn waits. Add a test that puts two messages in the queue, then reloads the page. The test shows that a reload empties the queue.
Files: `test/turn.spec.ts` (new), `test/e2e.mjs`.
Test: The two new tests fail on the current code. The two tests pass after steps 3 and 4.

## Step 2. Add the tools menu with three modes
Goal: one place to set each tool to off, ask first, or on.
Work: Put the registry in `shared/tools.ts`. Each entry holds the name, the label, the description, and the default mode. Add `tools.modes` to the settings. The map goes from the tool name to the mode. A migration turns the old `webSearch` and `webFetch` booleans into modes. The globe button in the top bar becomes a popover with a row for each tool and a three-state control. The settings window uses the same component. Only the tools with the mode ask first or on go to the model. A tool with the mode off costs no tokens.
Files: `src/lib/shared/tools.ts`, `src/lib/shared/types.ts`, `src/lib/components/ToolsMenu.svelte` (new), `src/lib/components/TopBar.svelte`, `src/lib/components/SettingsModal.svelte`, `src/lib/client/state.svelte.ts`, `src/lib/server/bridge.ts`.
Test: Unit tests for the mode map and for the migration. A test that the request holds the schemas of the tools that are on only. A component test for the three states.

## Step 3. Move the tool execution to the server
Goal: a turn finishes when the page is closed.
Work: Add `src/lib/server/tools.ts` with the code for the builtin tools. The loop in `bridge.ts` writes the tool result and continues the turn. The mode ask first stops the turn and sends an event with the request. The page shows a card with the buttons Approve and Deny. A new route continues the turn after an approval. The client module keeps the code for the cards only.
Files: `src/lib/server/tools.ts` (new), `src/lib/server/bridge.ts`, `src/lib/server/hub.ts`, `src/routes/api/chat/tools/+server.ts`, `src/lib/client/state.svelte.ts`, `src/lib/client/tools.ts`.
Test: The tests of step 1 pass now. An e2e test with the mock provider asks for a tool and finishes the turn. A test covers Deny. A test covers a tool that fails.

## Step 4. Move the follow-up queue to the server
Goal: the queue survives a reload, and two windows show the same queue.
Work: Add a table for the queued messages. The route adds a message to the queue while a turn runs. The hub starts the next message at the end of the turn. The snapshot carries the queue, so the page can draw the queue. The Stop button empties the queue, as today.
Files: `src/lib/server/db.ts`, `src/lib/server/store.ts`, `src/lib/server/hub.ts`, `src/routes/api/chat/+server.ts`, `src/lib/client/state.svelte.ts`.
Test: The queue test of step 1 passes. A test shows the same queue in two browser contexts.

## Step 5. Count the tokens exactly
Goal: the gauge and the statistics use exact numbers where the backend gives them.
Work: Add `src/lib/server/tokens.ts`. For llama.cpp, `POST /tokenize` gives the prompt count and `POST /apply-template` gives the true prompt text. For vLLM, `POST /tokenize` gives the same count, and the field `return_token_ids` gives the token identities in each stream chunk. For the other backends, the estimate stays, with the mark `~`. The gauge reads `n_ctx` from `GET /props` on llama.cpp when the model list has no window. The app probes each provider one time and remembers the result.
Files: `src/lib/server/tokens.ts` (new), `src/lib/server/openai.ts`, `src/lib/server/bridge.ts`, `src/lib/shared/stats.ts`, `src/lib/components/ContextGauge.svelte`.
Test: A unit test for each backend shape with a mock server. A test that shows the mark `~` on an estimate.

## Step 6. Add memory
Goal: the model remembers facts across the chats.
Work: Add a table for the memories. Add the tools `remember` and `forget`, with the mode from the menu. Add a system section with a fixed limit on the characters. The settings window gets a tab for the memories, where you can change or delete an entry.
Files: `src/lib/server/db.ts`, `src/lib/server/store.ts`, `src/lib/shared/tools.ts`, `src/lib/server/tools.ts`, `src/lib/server/bridge.ts`, `src/lib/components/SettingsModal.svelte`, `src/routes/api/memories/+server.ts` (new).
Test: The system section stays out of the prompt when memory is off. The section stops at the limit. The mode ask first shows the card before a write.

## Step 7. Add the MCP client
Goal: the app connects to MCP servers and gives their tools to the model.
Work: Store the server list in the Cursor format (`mcpServers` with `command`, `args`, `env`, `cwd`, `timeout_ms`, or `url` and `headers`). Add a client that speaks JSON-RPC over stdio and over Streamable HTTP. At start, the server opens each enabled server, calls `initialize`, and calls `tools/list`. The tools appear in the menu as `<server>_<tool>`, with the mode ask first as the default. The executor of step 3 sends a call to the correct server with `tools/call` and turns the content blocks into text. An image block goes to the images table and becomes an attachment. A server that stops restarts at the next call. The settings window gets a tab with the server list, the tool count, the state, and a test button.
Files: `src/lib/server/mcp/client.ts` (new), `src/lib/server/mcp/stdio.ts` (new), `src/lib/server/mcp/http.ts` (new), `src/lib/server/mcp/config.ts` (new), `src/lib/server/tools.ts`, `src/lib/shared/tools.ts`, `src/lib/components/SettingsModal.svelte`, `src/routes/api/mcp/+server.ts` (new).
Test: A small MCP server for the tests gives an echo tool and an add tool. Tests cover the tool list, a call, a timeout, a crash, a bad answer, and an image result.
Risk: A server that writes text to stdout can break the protocol. The reader ignores the lines without JSON.

## Step 8. Add branches, Continue, and comparison
Goal: an answer keeps the old answer, and two models can answer the same question.
Work: Add `parent_id` to the messages and an active leaf to each conversation. A migration fills `parent_id` from the current sequence, so the old chats stay in the same order. The actions Retry and Edit make a brother message in place of the removal of the tail. Each message gets a small control `1/3` for the brothers. The action Continue appears when the answer stops at the length limit. Both backends support the prefill of an assistant message for the Continue action. The comparison view sends the same prompt to a second model in a parallel chat and shows the two answers side by side.
Files: `src/lib/server/db.ts`, `src/lib/server/store.ts`, `src/lib/server/bridge.ts`, `src/routes/api/conversations/[id]/+server.ts`, `src/lib/components/MessageItem.svelte`, `src/lib/components/CompareView.svelte` (new), `src/lib/client/state.svelte.ts`.
Test: A migration test on a database with one chat. A test for the brothers. A test for Continue after the length limit. An e2e test for the comparison.

## Step 9. Add search, folders, tags, and pins
Goal: find an old chat fast, and put the chats in groups.
Work: Add an FTS5 table for the message text and the chat titles, with triggers that keep the table in step. Add a search box in the sidebar and the shortcut `Ctrl+K`. A hit opens the chat at the correct message. Add folders, tags, and pins. Drag a chat onto a folder to move the chat into the folder. Drag a chat onto another chat to make a folder with the two chats. Drag a chat out of a folder to keep the chat in the list of chats. A pinned chat stays at the top of the list. Each drag action has a keyboard equivalent, because a drag alone is not accessible.
Files: `src/lib/server/db.ts`, `src/lib/server/store.ts`, `src/routes/api/conversations/+server.ts`, `src/routes/api/search/chats/+server.ts` (new), `src/lib/components/Sidebar.svelte`, `src/lib/components/ChatSearch.svelte` (new).
Test: A test for the triggers of the FTS table. A test for the move to a folder. Component tests for the drag handlers. An accessibility test for the keyboard path.

## Step 10. Add the installable app
Goal: the app runs from the home screen of a telephone.
Work: Add a manifest with the pig icons (192 and 512 pixels, and one maskable icon). Set `theme-color` from the accent color, as the tab icon does. Add a service worker that caches the shell only, so the event stream and the turns keep the normal behavior. Add an offline page and a message when a new version is ready.
Files: `static/manifest.webmanifest` (new), `static/sw.js` (new), `static/icon-192.png`, `static/icon-512.png`, `src/app.html`, `src/routes/+layout.svelte`.
Test: A test for the manifest. A test that the list of cached routes holds the shell paths only. A manual check on a telephone and on the desktop.

## Step 11. Update the documents and close the work
Goal: the documents agree with the code.
Work: Update the feature list in `README.md` and `specs/overview.md`. Make one commit for each step. Run the full suite, the e2e tests, and a check in the browser with pictures in the light mode, the dark mode, and the narrow layout.
Files: `README.md`, `specs/overview.md`.
Test: `svelte-check` reports no error, all unit tests pass, and all e2e checks pass.

## Risks
- The MCP protocol is young, and the servers differ. I keep the surface small: `initialize`, `tools/list`, and `tools/call`.
- A message tree changes the data model of the messages. The migration must keep each old chat in the same order.
- Drag and drop is not accessible alone. Each action needs a menu entry too.
- The token endpoints differ between the backends. A probe at the first turn tells the app which endpoint to use.

## Decisions I need from you
1. Is the tools menu global and persisted? That choice removes the web tools switch of the single chat.
2. Step 8 comes before step 9, because the search and the folders of step 9 use the message tree. Do you agree with the order above?
