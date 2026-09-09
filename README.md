# iii Kanban E2E fixture

This repository is the versioned reference application for Kanban engineering scenarios.
Each task starts from a recorded commit and asks the subject to reproduce the next
product change in a disposable checkout.

The initial commit intentionally contains no application. The first change creates
the `kanban/` Node application and its iii-backed configuration surface.

## Development

Install and validate the application from `kanban/`:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

`worker-compose.yaml` starts the local application with `scripts.run`.
The application serves its own web interface and does not require the Console
or `iii.worker.yaml`. With a running iii engine
providing `configuration`, run `iii compose --up --file worker-compose.yaml` from
this repository. Open http://127.0.0.1:3000 after startup; `PORT` selects another
HTTP port. For direct development, run `pnpm dev` from `kanban/` with `III_URL`
pointing at that engine. Its `kanban`
configuration entry controls the ticket-data directory and defaults to `./data`
relative to this repository.

The current foundation provides storage settings through `GET /api/config` and
`PUT /api/config`. The browser uses these application endpoints; the backend
uses iii for configuration registration, persistence and reactive reload.
The home page displays the five board columns, their counts, and persisted
tickets with their key, title, priority and assignee. **Refresh board** fetches
the latest tickets through `GET /api/tickets`, which invokes
`kanban::tickets::list` over iii. **Settings** retains the storage form; returning
to the board reloads the selected store.

**New ticket** opens a creation modal. After saving, the modal closes and the
ticket opens in its own detail panel in the same browser tab. Board cards also
open this panel, with a URL hash that supports direct links and browser history.
The detail panel shows the ticket fields and offers **Delete ticket**. Deletion
returns to the board and hides the ticket without removing its record from disk.
The detail panel also supports editing title, description, status, priority and
assignee. Save persists the changes; cancel discards the draft. Drag a card to
another board column to change its status. The card moves after the server
confirms the update. Keyboard and touch users can change status in the detail
editor.

Open sessions update automatically when tickets are created, edited, moved,
deleted or commented on, including changes made directly through iii functions.
`GET /api/events` sends SSE `change` notifications after successful persistence;
the browser reloads the visible board or ticket from the API. Reconnection
refreshes the latest state, so missed notifications do not require page reload.
Live updates preserve edit and comment drafts. Saving an edit sends only the
fields changed locally; simultaneous edits to the same field use the last
successful write. Switching the configured store clears drafts from the old
store. Files edited outside the application and multiple application processes
sharing a store are not supported by this notification mechanism.

The activity timeline shows comments and replies in posting order. Enter a name
and a comment, or reply to an existing entry. Replies identify their parent
comment. Names are user-entered labels, not authenticated identities. Comments
survive ticket edits and soft deletion. This stage does not record field-change
history or support editing/deleting comments.

## Tickets

Tickets are stored in `tickets.json` inside the configured data directory.
Each ticket has a UUID `id`, a readable `key` (`KAN-1`, `KAN-2`, ...), title,
description, status, priority, assignee, and creation/update timestamps.

The application exposes these iii functions:

| Function | Input | Result |
| --- | --- | --- |
| `kanban::tickets::create` | Required `title`; optional `description`, `status`, `priority`, `assignee` | Persisted ticket |
| `kanban::tickets::list` | `{}` | `{ "tickets": [...] }` in creation order |
| `kanban::tickets::get` | `{ "id": "KAN-1" }` or a UUID | Matching ticket; error if absent |
| `kanban::tickets::delete` | `{ "id": "KAN-1" }` or a UUID | Ticket marked with `deleted_at`; error if absent |
| `kanban::tickets::update` | `{ "id": "KAN-1", "changes": { "status": "done" } }` or a UUID | Updated ticket; omitted fields are preserved |
| `kanban::tickets::comment` | `{ "id": "KAN-1", "comment": { "author": "Ana", "body": "Ready for review" } }` or a UUID | Ticket including the appended comment |

The browser uses `POST /api/tickets` to create, and `GET` / `DELETE`
`/api/tickets/:id` to open or delete a ticket. These endpoints invoke the iii
functions and return `{ "ticket": ... }`. Both UUIDs and readable keys work.
Deleted tickets are excluded from list and get; their identifiers are never reused.
`PATCH /api/tickets/:id` accepts a JSON object of editable fields and returns
`{ "ticket": ... }`. IDs and creation/deletion timestamps cannot be edited,
and deleted tickets cannot be updated.
`POST /api/tickets/:id/comments` accepts `{ "author": "Ana", "body": "..." }`
and an optional `parent_id` identifying a comment on the same ticket. It returns
`201 { "ticket": ... }`. `GET /api/tickets/:id` includes the optional `comments`
array; tickets from earlier commits do not need migration. Comments cannot be
added to deleted tickets.

Statuses are `backlog`, `todo`, `in_progress`, `in_review`, and `done`.
Priorities are `low`, `medium`, `high`, and `urgent`. New tickets default to
`backlog`, `medium`, an empty description, and no assignee.

Changes are written atomically before returning a ticket. A malformed store
causes an error rather than replacement with an empty store. The store supports
one application process per data directory. Changing `data_dir` selects another
store for subsequent calls; existing files are retained and are not migrated.
