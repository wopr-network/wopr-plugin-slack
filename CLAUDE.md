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
