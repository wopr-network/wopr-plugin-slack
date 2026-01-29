# 📖 Configuration Reference

Complete reference for configuring the WOPR Slack Plugin.

---

## Table of Contents

- [Configuration Structure](#configuration-structure)
- [Core Settings](#core-settings)
- [Connection Modes](#connection-modes)
- [DM Configuration](#dm-configuration)
- [Channel Configuration](#channel-configuration)
- [Reaction Settings](#reaction-settings)
- [Threading Options](#threading-options)
- [Environment Variables](#environment-variables)
- [Complete Examples](#complete-examples)

---

## Configuration Structure

The Slack plugin configuration is nested under `channels.slack` in your WOPR config:

```json
{
  "channels": {
    "slack": {
      // Plugin configuration here
    }
  }
}
```

---

## Core Settings

### `enabled`

| Property | Value |
|----------|-------|
| Type | `boolean` |
| Required | No |
| Default | `true` |

Enable or disable the Slack plugin.

```json
{
  "channels": {
    "slack": {
      "enabled": true
    }
  }
}
```

---

### `mode`

| Property | Value |
|----------|-------|
| Type | `string` |
| Required | No |
| Default | `"socket"` |
| Options | `"socket"`, `"http"` |

Connection mode for the Slack bot.

```json
{
  "channels": {
    "slack": {
      "mode": "socket"
    }
  }
}
```

---

### `botToken`

| Property | Value |
|----------|-------|
| Type | `string` |
| Required | **Yes** |
| Format | `xoxb-...` |

Bot User OAuth Token from Slack. Get this from **OAuth & Permissions** → **Bot User OAuth Token**.

```json
{
  "channels": {
    "slack": {
      "botToken": "xoxb-YOUR-BOT-TOKEN-HERE"
    }
  }
}
```

**Security Note:** Keep this token secret. It grants access to your Slack workspace.

---

### `appToken`

| Property | Value |
|----------|-------|
| Type | `string` |
| Required | For Socket Mode |
| Format | `xapp-...` |

App-Level Token for Socket Mode. Get this from **Basic Information** → **App-Level Tokens**.

Required scopes:
- `connections:write`

```json
{
  "channels": {
    "slack": {
      "appToken": "xapp-YOUR-APP-TOKEN-HERE"
    }
  }
}
```

---

### `signingSecret`

| Property | Value |
|----------|-------|
| Type | `string` |
| Required | For HTTP Mode |

Request signing secret for HTTP webhook mode. Get this from **Basic Information** → **Signing Secret**.

```json
{
  "channels": {
    "slack": {
      "signingSecret": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
    }
  }
}
```

---

### `webhookPath`

| Property | Value |
|----------|-------|
| Type | `string` |
| Required | No |
| Default | `"/slack/events"` |

URL path for HTTP webhook endpoint.

```json
{
  "channels": {
    "slack": {
      "webhookPath": "/slack/events"
    }
  }
}
```

---

## Connection Modes

### Socket Mode

Socket Mode uses WebSockets for real-time communication. Recommended for most deployments.

**Required settings:**
- `botToken`
- `appToken`

```json
{
  "channels": {
    "slack": {
      "mode": "socket",
      "botToken": "xoxb-...",
      "appToken": "xapp-..."
    }
  }
}
```

**Advantages:**
- ✅ Works through firewalls
- ✅ No public URL required
- ✅ Automatic reconnection
- ✅ Simple setup

---

### HTTP Mode

HTTP Mode uses traditional webhooks. Best for server deployments.

**Required settings:**
- `botToken`
- `signingSecret`
- `webhookPath` (optional)

```json
{
  "channels": {
    "slack": {
      "mode": "http",
      "botToken": "xoxb-...",
      "signingSecret": "...",
      "webhookPath": "/slack/events"
    }
  }
}
```

**Advantages:**
- ✅ Better for high-traffic
- ✅ Works with load balancers
- ✅ Traditional webhook security

**Note:** When using HTTP mode, your WOPR instance must be accessible from the internet.

---

## DM Configuration

Configure how the bot handles direct messages.

### `dm.enabled`

| Property | Value |
|----------|-------|
| Type | `boolean` |
| Required | No |
| Default | `true` |

Enable or disable DM handling.

```json
{
  "channels": {
    "slack": {
      "dm": {
        "enabled": true
      }
    }
  }
}
```

---

### `dm.policy`

| Property | Value |
|----------|-------|
| Type | `string` |
| Required | No |
| Default | `"pairing"` |
| Options | `"pairing"`, `"open"`, `"closed"` |

DM security policy.

| Policy | Description |
|--------|-------------|
| `pairing` | Unknown users must be approved |
| `open` | Accept all DMs |
| `closed` | Ignore all DMs |

```json
{
  "channels": {
    "slack": {
      "dm": {
        "policy": "pairing"
      }
    }
  }
}
```

---

### `dm.allowFrom`

| Property | Value |
|----------|-------|
| Type | `string[]` |
| Required | No |
| Default | `[]` |

Array of Slack user IDs allowed to DM the bot. Use `"*"` to allow all users (same as `open` policy).

```json
{
  "channels": {
    "slack": {
      "dm": {
        "allowFrom": [
          "U1234567890",
          "U0987654321"
        ]
      }
    }
  }
}
```

**Finding User IDs:**
1. In Slack, click the user's profile
2. Click the three dots menu
3. Select **Copy member ID**

---

## Channel Configuration

### `groupPolicy`

| Property | Value |
|----------|-------|
| Type | `string` |
| Required | No |
| Default | `"allowlist"` |
| Options | `"allowlist"`, `"open"`, `"disabled"` |

Default policy for channel participation.

| Policy | Description |
|--------|-------------|
| `allowlist` | Only respond in configured channels |
| `open` | Respond in any channel (mention-gated) |
| `disabled` | Ignore all channels |

```json
{
  "channels": {
    "slack": {
      "groupPolicy": "allowlist"
    }
  }
}
```

---

### `channels`

| Property | Value |
|----------|-------|
| Type | `object` |
| Required | No |

Per-channel configuration. Keys are channel names with `#` prefix.

```json
{
  "channels": {
    "slack": {
      "channels": {
        "#general": {
          "allow": true,
          "requireMention": false
        },
        "#wopr-chat": {
          "allow": true,
          "requireMention": true,
          "enabled": true
        }
      }
    }
  }
}
```

---

#### Channel Options

##### `allow`

| Property | Value |
|----------|-------|
| Type | `boolean` |
| Required | No |
| Default | `false` |

Allow the bot to respond in this channel.

##### `requireMention`

| Property | Value |
|----------|-------|
| Type | `boolean` |
| Required | No |
| Default | `false` |

Require `@botname` mention to trigger responses.

##### `enabled`

| Property | Value |
|----------|-------|
| Type | `boolean` |
| Required | No |
| Default | `true` |

Enable/disable this specific channel configuration.

---

## Reaction Settings

### `ackReaction`

| Property | Value |
|----------|-------|
| Type | `string` |
| Required | No |
| Default | `"👀"` |

Emoji to react with while processing a message. Can be any Slack-compatible emoji.

```json
{
  "channels": {
    "slack": {
      "ackReaction": "🤖"
    }
  }
}
```

**Note:** Do not include colons (e.g., use `👀` not `:eyes:`).

---

### `removeAckAfterReply`

| Property | Value |
|----------|-------|
| Type | `boolean` |
| Required | No |
| Default | `true` (implied) |

Whether to remove the acknowledgment reaction after replying. Currently always removes and replaces with ✅ or ❌.

---

## Threading Options

### `replyToMode`

| Property | Value |
|----------|-------|
| Type | `string` |
| Required | No |
| Default | `"off"` |
| Options | `"off"`, `"first"`, `"all"` |

Control how replies are threaded.

| Mode | Behavior |
|------|----------|
| `off` | Reply in main channel |
| `first` | First reply in thread, subsequent in main |
| `all` | All replies in thread |

```json
{
  "channels": {
    "slack": {
      "replyToMode": "all"
    }
  }
}
```

---

## Environment Variables

Environment variables override config file values.

| Variable | Description | Example |
|----------|-------------|---------|
| `SLACK_BOT_TOKEN` | Bot User OAuth Token | `xoxb-...` |
| `SLACK_APP_TOKEN` | App-Level Token (Socket Mode) | `xapp-...` |
| `SLACK_SIGNING_SECRET` | Signing Secret (HTTP Mode) | `a1b2c3...` |
| `WOPR_HOME` | WOPR home directory for logs | `/home/user/.wopr` |

```bash
# Required
export SLACK_BOT_TOKEN="xoxb-YOUR-BOT-TOKEN-HERE"
export SLACK_APP_TOKEN="xapp-YOUR-APP-TOKEN-HERE"

# For HTTP mode
export SLACK_SIGNING_SECRET="YOUR-SIGNING-SECRET-HERE"
```

---

## Complete Examples

### Socket Mode - Development

```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "mode": "socket",
      "botToken": "xoxb-...",
      "appToken": "xapp-...",
      "dm": {
        "policy": "open"
      },
      "groupPolicy": "allowlist",
      "channels": {
        "#dev-chat": {
          "allow": true,
          "requireMention": false
        }
      }
    }
  }
}
```

### Socket Mode - Production

```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "mode": "socket",
      "botToken": "xoxb-...",
      "appToken": "xapp-...",
      "ackReaction": "🤖",
      "replyToMode": "all",
      "dm": {
        "policy": "pairing",
        "allowFrom": [
          "U1234567890",
          "U0987654321"
        ]
      },
      "groupPolicy": "allowlist",
      "channels": {
        "#wopr-general": {
          "allow": true,
          "requireMention": false
        },
        "#wopr-support": {
          "allow": true,
          "requireMention": true
        }
      }
    }
  }
}
```

### HTTP Mode

```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "mode": "http",
      "botToken": "xoxb-...",
      "signingSecret": "...",
      "webhookPath": "/slack/events",
      "dm": {
        "policy": "closed"
      },
      "groupPolicy": "open"
    }
  }
}
```

### DM-Only Mode

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

---

## Configuration Validation

The plugin validates configuration on startup and logs warnings for:

- Missing required tokens
- Invalid mode selection
- Missing `appToken` in Socket Mode
- Missing `signingSecret` in HTTP Mode
- Invalid channel configurations

Check logs at `~/.wopr/logs/slack-plugin.log` for validation details.
