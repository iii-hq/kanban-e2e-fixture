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
Board and ticket features follow in subsequent reference commits.
