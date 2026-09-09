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
The board interface follows in a subsequent reference commit.

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

Statuses are `backlog`, `todo`, `in_progress`, `in_review`, and `done`.
Priorities are `low`, `medium`, `high`, and `urgent`. New tickets default to
`backlog`, `medium`, an empty description, and no assignee.

Changes are written atomically before returning a ticket. A malformed store
causes an error rather than replacement with an empty store. The store supports
one application process per data directory. Changing `data_dir` selects another
store for subsequent calls; existing files are retained and are not migrated.
