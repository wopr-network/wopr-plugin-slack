# WOPR Slack Plugin

[![npm version](https://img.shields.io/npm/v/wopr-plugin-slack.svg)](https://www.npmjs.com/package/wopr-plugin-slack)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![WOPR](https://img.shields.io/badge/WOPR-Plugin-blue)](https://github.com/TSavo/wopr)

Slack integration for [WOPR](https://github.com/TSavo/wopr) with Socket Mode and HTTP webhook support.

> Part of the [WOPR](https://github.com/TSavo/wopr) ecosystem - Self-sovereign AI session management over P2P.

## Features

- **Socket Mode** (default) - Works through firewalls, no public URL needed
- **HTTP Webhooks** - For server deployments with public URLs
- **DM Support** - Direct messages with pairing/allowlist security
- **Channel Support** - Group channels with mention gating
- **Threading** - Automatic reply threading options
- **Streaming** - Real-time response streaming with chunking
- **Reactions** - Ack reactions (👀) and success/error indicators

## Installation

```bash
wopr plugin install wopr-plugin-slack
```

Or manually:

```bash
cd ~/.wopr/plugins
npm install wopr-plugin-slack
```

## Configuration

### Socket Mode (Recommended)

1. Create a Slack app at https://api.slack.com/apps
2. Enable **Socket Mode**
3. Generate an **App-Level Token** with `connections:write` scope (starts with `xapp-`)
4. Install app to workspace, copy **Bot User OAuth Token** (starts with `xoxb-`)
5. Configure WOPR:

```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "mode": "socket",
      "botToken": "xoxb-...",
      "appToken": "xapp-...",
      "dm": {
        "policy": "pairing",
        "allowFrom": []
      },
      "groupPolicy": "allowlist",
      "channels": {
        "#general": { "allow": true, "requireMention": false }
      }
    }
  }
}
```

### Environment Variables

```bash
export SLACK_BOT_TOKEN="xoxb-..."
export SLACK_APP_TOKEN="xapp-..."
```

### HTTP Mode

For server deployments:

```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "mode": "http",
      "botToken": "xoxb-...",
      "signingSecret": "...",
      "webhookPath": "/slack/events"
    }
  }
}
```

## Security

### DM Policies

- **pairing** (default) - Unknown users must be approved
- **open** - Accept all DMs
- **closed** - Ignore all DMs

### Channel Policies

- **allowlist** (default) - Only respond in configured channels
- **open** - Respond in any channel (mention-gated)
- **disabled** - Ignore all channels

### Mention Gating

Set `requireMention: true` on channels to only respond when @mentioned.

## Reply Threading

Control with `replyToMode`:

- **off** (default) - Reply in main channel
- **first** - First reply in thread, then main
- **all** - All replies in thread

## Development

```bash
npm install
npm run build
npm run watch
```

## License

MIT
