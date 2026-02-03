# 📁 Configuration Examples

Example configuration files for the WOPR Slack Plugin.

---

## Files

| File | Description | Use Case |
|------|-------------|----------|
| [socket-mode-config.json](./socket-mode-config.json) | Socket Mode configuration | Development, local deployments |
| [http-mode-config.json](./http-mode-config.json) | HTTP webhook configuration | Production servers |

---

## Quick Start

### Socket Mode (Recommended)

1. Copy the example:
   ```bash
   cp socket-mode-config.json ~/.wopr/config.json
   ```

2. Edit and update:
   - Replace tokens with your actual tokens
   - Replace channel IDs (`C1234567890`, etc.) with your actual Slack channel IDs

   ```json
   {
     "botToken": "xoxb-your-actual-token",
     "appToken": "xapp-your-actual-token"
   }
   ```

3. Restart WOPR:
   ```bash
   wopr restart
   ```

**Finding Channel IDs:** Right-click a channel in Slack -> "View channel details" -> scroll to the bottom.

### HTTP Mode

1. Copy the example:
   ```bash
   cp http-mode-config.json ~/.wopr/config.json
   ```

2. Edit with your credentials:
   ```json
   {
     "botToken": "xoxb-your-actual-token",
     "signingSecret": "your-actual-signing-secret"
   }
   ```

3. Ensure WOPR is accessible from the internet

4. Set the Request URL in Slack:
   ```
   https://your-domain.com/slack/events
   ```

---

## Configuration Modes

### Socket Mode

- ✅ Works through firewalls
- ✅ No public URL needed
- ✅ Simple setup
- ✅ Auto-reconnect

**Best for:** Development, home servers, VPN deployments

### HTTP Mode

- ✅ Better for high traffic
- ✅ Works with load balancers
- ✅ Traditional webhook security
- ❌ Requires public URL

**Best for:** Production servers, enterprise deployments

---

## Environment Variables

Instead of embedding tokens in config files, you can use:

```bash
# Socket Mode
export SLACK_BOT_TOKEN="xoxb-..."
export SLACK_APP_TOKEN="xapp-..."

# HTTP Mode
export SLACK_BOT_TOKEN="xoxb-..."
export SLACK_SIGNING_SECRET="..."
```

Then use minimal config:

```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "mode": "socket"
    }
  }
}
```

---

## More Examples

### DM-Only Bot

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
      "groupPolicy": "disabled"
    }
  }
}
```

### Public Channel Bot (Mention-Gated)

```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "mode": "socket",
      "botToken": "xoxb-...",
      "appToken": "xapp-...",
      "dm": {
        "policy": "closed"
      },
      "groupPolicy": "open",
      "channels": {}
    }
  }
}
```

### Multi-Channel with Different Policies

**Important:** Channel keys must be Slack channel IDs (e.g., `C1234567890`), not channel names like `#general`.

To find a channel's ID: Right-click the channel in Slack -> "View channel details" -> scroll to the bottom.

```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "mode": "socket",
      "botToken": "xoxb-...",
      "appToken": "xapp-...",
      "replyToMode": "all",
      "dm": {
        "policy": "pairing",
        "allowFrom": ["U1234567890"]
      },
      "groupPolicy": "allowlist",
      "channels": {
        "C1234567890": {
          "allow": true,
          "requireMention": true
        },
        "C0987654321": {
          "allow": true,
          "requireMention": false
        },
        "C1122334455": {
          "allow": true,
          "requireMention": false
        }
      }
    }
  }
}
```

---

## Documentation

- [📖 Configuration Reference](../docs/CONFIGURATION.md)
- [🔧 Troubleshooting](../docs/TROUBLESHOOTING.md)
- [🚀 Setup Guide](../docs/SETUP.md)
