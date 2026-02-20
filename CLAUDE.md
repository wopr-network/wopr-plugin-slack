# wopr-plugin-slack

Slack channel plugin for WOPR. Supports both Socket Mode (no public URL needed) and HTTP webhook mode.

## Commands

```bash
npm run build     # tsc
npm run check     # biome check + tsc --noEmit (run before committing)
npm run lint:fix  # biome check --fix src/
npm run format    # biome format --write src/
npm test          # vitest run
```

## Architecture

```
src/
  index.ts   # Plugin entry — Socket Mode + HTTP webhook support
  types.ts   # Plugin-local types
```

## Key Details

- **Socket Mode**: preferred for local/dev — no public URL required, uses `SLACK_APP_TOKEN`
- **HTTP webhook mode**: for production with public URL, uses `SLACK_SIGNING_SECRET` for request verification
- Implements `ChannelProvider` from `@wopr-network/plugin-types`
- Uses Slack Bolt SDK (`@slack/bolt`)
- **Gotcha**: Socket Mode and webhook mode are mutually exclusive — check config at init

## Plugin Contract

Imports only from `@wopr-network/plugin-types`. Never import from `@wopr-network/wopr` core.

## Issue Tracking

All issues in **Linear** (team: WOPR). Issue descriptions start with `**Repo:** wopr-network/wopr-plugin-slack`.

## Session Memory

At the start of every WOPR session, **read `~/.wopr-memory.md` if it exists.** It contains recent session context: which repos were active, what branches are in flight, and how many uncommitted changes exist. Use it to orient quickly without re-investigating.

The `Stop` hook writes to this file automatically at session end. Only non-main branches are recorded — if everything is on `main`, nothing is written for that repo.