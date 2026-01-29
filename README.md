# 🔌 WOPR Slack Plugin

[![npm version](https://img.shields.io/npm/v/wopr-plugin-slack.svg)](https://www.npmjs.com/package/wopr-plugin-slack)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![WOPR](https://img.shields.io/badge/WOPR-Plugin-blue)](https://github.com/TSavo/wopr)
[![Socket Mode](https://img.shields.io/badge/Socket%20Mode-Supported-green)](https://api.slack.com/apis/connections/socket)
[![Bolt](https://img.shields.io/badge/Bolt-v3-purple)](https://slack.dev/bolt-js/)

> 🤖 **Slack integration for [WOPR](https://github.com/TSavo/wopr)** - Self-sovereign AI session management over P2P
>
> Bring your WOPR agent to Slack with real-time streaming, smart threading, and secure access controls.

---

## ✨ Features

| Feature | Description | Status |
|---------|-------------|--------|
| 🔌 **Socket Mode** | WebSocket-based connection, works through firewalls | ✅ Default |
| 🌐 **HTTP Webhooks** | Traditional webhook mode for server deployments | ✅ Supported |
| 💬 **DM Support** | Direct messages with pairing/allowlist security | ✅ With pairing |
| #️⃣ **Channel Support** | Group channels with mention gating | ✅ Configurable |
| 🧵 **Threading** | Automatic reply threading options | ✅ 3 modes |
| ⚡ **Streaming** | Real-time response streaming with chunking | ✅ Live updates |
| 👀 **Reactions** | Ack reactions and success/error indicators | ✅ Customizable |
| 🎨 **Block Kit** | Rich Slack Block Kit responses | ✅ Supported |
| 🔒 **Security** | Multiple DM and channel policies | ✅ Flexible |
| 📝 **Logging** | Comprehensive Winston-based logging | ✅ Debug ready |

---

## 🚀 Quick Start

### Installation

```bash
# Via WOPR CLI
wopr plugin install wopr-plugin-slack

# Or manually
cd ~/.wopr/plugins
npm install wopr-plugin-slack
```

### Minimal Configuration

Create or edit your WOPR config file (`~/.wopr/config.json`):

```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "mode": "socket",
      "botToken": "xoxb-your-bot-token",
      "appToken": "xapp-your-app-token"
    }
  }
}
```

That's it! Start WOPR and your bot will connect to Slack.

---

## 📋 Setup Guide

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App**
3. Choose **From scratch**
4. Name your app (e.g., "WOPR Bot") and select your workspace

### 2. Configure Socket Mode (Recommended)

1. In the left sidebar, click **Socket Mode**
2. Toggle **Enable Socket Mode** to On
3. Generate an **App-Level Token**:
   - Click **Generate Token and Scopes**
   - Add scope: `connections:write`
   - Copy the token (starts with `xapp-`)

### 3. Add Bot Token Scopes

1. Go to **OAuth & Permissions** in the left sidebar
2. Scroll to **Scopes** → **Bot Token Scopes**
3. Add the following scopes:
   - `app_mentions:read` - Read mention events
   - `channels:history` - Read channel messages
   - `channels:join` - Join channels automatically
   - `chat:write` - Send messages
   - `groups:history` - Read private channel messages
   - `im:history` - Read DM history
   - `im:write` - Send DMs
   - `mpim:history` - Read group DM history
   - `reactions:write` - Add reactions
   - `users:read` - Read user info

### 4. Install to Workspace

1. Go to **Install App** in the left sidebar
2. Click **Install to Workspace**
3. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

### 5. Configure WOPR

Add the tokens to your WOPR configuration:

```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "mode": "socket",
      "botToken": "xoxb-your-bot-token",
      "appToken": "xapp-your-app-token"
    }
  }
}
```

---

## ⚙️ Configuration Options

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `enabled` | boolean | No | `true` | Enable/disable the plugin |
| `mode` | string | No | `"socket"` | Connection mode: `"socket"` or `"http"` |
| `botToken` | string | **Yes** | - | Bot User OAuth Token (`xoxb-...`) |
| `appToken` | string | For socket | - | App-Level Token (`xapp-...`) |
| `signingSecret` | string | For HTTP | - | Signing secret for HTTP mode |
| `webhookPath` | string | No | `/slack/events` | Webhook endpoint path |
| `ackReaction` | string | No | `"👀"` | Reaction emoji while processing |
| `replyToMode` | string | No | `"off"` | Threading: `"off"`, `"first"`, `"all"` |
| `dm.policy` | string | No | `"pairing"` | DM policy: `"pairing"`, `"open"`, `"closed"` |
| `dm.allowFrom` | array | No | `[]` | Allowed user IDs for DMs |
| `groupPolicy` | string | No | `"allowlist"` | Channel policy: `"allowlist"`, `"open"`, `"disabled"` |

### Full Configuration Example

```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "mode": "socket",
      "botToken": "xoxb-...",
      "appToken": "xapp-...",
      "ackReaction": "👀",
      "replyToMode": "all",
      "dm": {
        "enabled": true,
        "policy": "pairing",
        "allowFrom": ["U1234567890"]
      },
      "groupPolicy": "allowlist",
      "channels": {
        "#general": {
          "allow": true,
          "requireMention": false
        },
        "#wopr-chat": {
          "allow": true,
          "requireMention": true
        }
      }
    }
  }
}
```

---

## 🔌 Socket Mode vs HTTP Mode

| Feature | Socket Mode | HTTP Mode |
|---------|-------------|-----------|
| **Firewall** | ✅ Works through firewalls | ❌ Requires public URL |
| **Setup** | Simple, no server needed | Requires web server |
| **Scaling** | Good for most use cases | Better for high-load |
| **Security** | WebSocket TLS | Request signing |
| **Hosting** | Local, VPN, anywhere | Server with public IP |
| **Reconnect** | Automatic | Depends on server |

### When to Use Socket Mode

- 🔧 Development and testing
- 🏠 Local or home deployments
- 🔒 Behind corporate firewalls
- ☁️ Cloud VMs without domain setup

### When to Use HTTP Mode

- 🌐 Production server deployments
- 📊 High-traffic scenarios
- 🏢 Enterprise with strict WebSocket policies
- 🔄 Load balancing across multiple instances

---

## 🔐 Environment Variables

You can configure the plugin using environment variables:

```bash
# Required tokens
export SLACK_BOT_TOKEN="xoxb-your-bot-token"
export SLACK_APP_TOKEN="xapp-your-app-token"

# Optional: HTTP mode
export SLACK_SIGNING_SECRET="your-signing-secret"

# Optional: WOPR home directory for logs
export WOPR_HOME="/home/user/.wopr"
```

Environment variables override config file values.

---

## 🔒 Security Policies

### DM Policies

Control how the bot handles direct messages:

| Policy | Behavior | Use Case |
|--------|----------|----------|
| `pairing` (default) | Unknown users must be approved | 🔒 Secure deployments |
| `open` | Accept all DMs | 🌐 Public bots |
| `closed` | Ignore all DMs | #️⃣ Channel-only mode |

### Channel Policies

Control bot behavior in channels:

| Policy | Behavior | Use Case |
|--------|----------|----------|
| `allowlist` (default) | Only respond in configured channels | 🔒 Controlled access |
| `open` | Respond in any channel (mention-gated) | 🌐 Organization-wide |
| `disabled` | Ignore all channels | 💬 DM-only mode |

### Mention Gating

Require `@mention` for responses:

```json
{
  "channels": {
    "#general": {
      "allow": true,
      "requireMention": true
    }
  }
}
```

---

## 🧵 Reply Threading

Control how replies are organized:

| Mode | Behavior | Best For |
|------|----------|----------|
| `off` (default) | Reply in main channel | 💬 General chat |
| `first` | First reply in thread, then main | 📋 Single response |
| `all` | All replies in thread | 🧵 Organized conversations |

---

## 📚 Documentation

- [📖 Configuration Reference](./docs/CONFIGURATION.md) - Detailed configuration options
- [🔧 Troubleshooting](./docs/TROUBLESHOOTING.md) - Common issues and solutions
- [🚀 Setup Guide](./docs/SETUP.md) - Step-by-step Slack app creation
- [💡 Examples](./examples/) - Sample configuration files

---

## 💻 Development

```bash
# Clone the repository
git clone https://github.com/TSavo/wopr-plugin-slack.git
cd wopr-plugin-slack

# Install dependencies
npm install

# Build the plugin
npm run build

# Watch for changes
npm run watch

# Run in development mode
npm run dev
```

---

## 🧪 Testing

```bash
# Run tests
npm test

# Run with debug logging
DEBUG=slack:* npm run dev
```

---

## 🐛 Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| Bot not responding | Check tokens, ensure app is installed to workspace |
| Socket Mode fails | Verify `appToken` has `connections:write` scope |
| HTTP mode 401 errors | Check `signingSecret` matches Slack app |
| Missing messages | Ensure bot is invited to channel |
| Reactions not working | Add `reactions:write` scope |

See [TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) for detailed solutions.

---

## 🔗 Related Projects

- 🧠 [WOPR Core](https://github.com/TSavo/wopr) - Self-sovereign AI session management
- 🔌 [WOPR Plugin Router](https://github.com/TSavo/wopr-plugin-router) - Message routing
- 💬 [WOPR Plugin Discord](https://github.com/TSavo/wopr-plugin-discord) - Discord integration
- 🌐 [WOPR Plugin WebUI](https://github.com/TSavo/wopr-plugin-webui) - Web interface

---

## 🤝 Contributing

Contributions are welcome! Please read the [WOPR Contributing Guide](https://github.com/TSavo/wopr/blob/main/CONTRIBUTING.md) for details.

---

## 📄 License

MIT © [TSavo](https://github.com/TSavo)

---

<p align="center">
  <a href="https://github.com/TSavo/wopr">🧠 WOPR</a> •
  <a href="https://github.com/TSavo/wopr-plugin-slack">🔌 Slack Plugin</a> •
  <a href="https://www.npmjs.com/package/wopr-plugin-slack">📦 NPM</a>
</p>
