# 🚀 Step-by-Step Setup Guide

Complete walkthrough for creating and configuring a Slack app for WOPR.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Step 1: Create Slack App](#step-1-create-slack-app)
- [Step 2: Configure Socket Mode](#step-2-configure-socket-mode)
- [Step 3: Set Permissions](#step-3-set-permissions)
- [Step 4: Install to Workspace](#step-4-install-to-workspace)
- [Step 5: Configure WOPR](#step-5-configure-wopr)
- [HTTP Mode Setup (Alternative)](#http-mode-setup-alternative)
- [Next Steps](#next-steps)

---

## Prerequisites

Before starting:

- [ ] Slack workspace admin access (or ability to install apps)
- [ ] WOPR installed and running
- [ ] Basic understanding of JSON configuration

---

## Step 1: Create Slack App

### 1.1 Navigate to Slack API

1. Open [api.slack.com/apps](https://api.slack.com/apps) in your browser
2. Sign in to your Slack account if needed

### 1.2 Create New App

1. Click the green **Create New App** button
   
   ![Create New App](https://platform.slack-edge.com/img/tutorials/slack-apps/create_new_app.png)

2. Choose **From scratch**
   
   > ⚠️ Don't use "From an app manifest" unless you know what you're doing

3. Fill in the app details:
   
   | Field | Value | Example |
   |-------|-------|---------|
   | App Name | Your bot's display name | `WOPR Bot` |
   | Development Slack Workspace | Select your workspace | `MyTeam` |

4. Click **Create App**

### 1.3 Note Your App Credentials

After creation, you'll see the **Basic Information** page:

1. Scroll to **App Credentials**
2. Note down:
   - **Client ID** (for reference)
   - **Client Secret** (keep secret!)
   - **Signing Secret** (needed for HTTP mode)

---

## Step 2: Configure Socket Mode

Socket Mode is the recommended way to connect your bot.

### 2.1 Enable Socket Mode

1. In the left sidebar, click **Socket Mode**
   
   > 💡 If you don't see it, click **Basic Information** first

2. Toggle **Enable Socket Mode** to **On**

3. When prompted, click **Generate Token and Scopes**

### 2.2 Generate App-Level Token

1. Enter a token name: `wopr-socket-token`

2. Add the required scope:
   - Click **Add Scope**
   - Select `connections:write`
   - Click **Generate**

3. **Copy the token immediately!**
   
   > ⚠️ This token starts with `xapp-` and is shown only once!
   
   ```
   xapp-YOUR-APP-TOKEN-HERE
   ```

4. Store it securely - you'll need it for WOPR config

### 2.3 Enable Event Subscriptions

1. In the left sidebar, click **Event Subscriptions**

2. Toggle **Enable Events** to **On**

3. Under **Subscribe to bot events**, click **Add Bot User Event**

4. Add these events:
   
   | Event | Description |
   |-------|-------------|
   | `app_mention` | When bot is @mentioned |
   | `message.channels` | Messages in public channels |
   | `message.groups` | Messages in private channels |
   | `message.im` | Direct messages |
   | `message.mpim` | Group direct messages |

5. Click **Save Changes**

---

## Step 3: Set Permissions

### 3.1 Navigate to OAuth Settings

1. In the left sidebar, click **OAuth & Permissions**

### 3.2 Add Bot Token Scopes

Scroll to **Scopes** → **Bot Token Scopes**

Click **Add an OAuth Scope** and add each of these:

```
app_mentions:read
channels:history
channels:join
chat:write
groups:history
im:history
im:write
mpim:history
reactions:write
users:read
```

### 3.3 Scope Reference

| Scope | Purpose | Required |
|-------|---------|----------|
| `app_mentions:read` | Detect @mentions | ✅ Yes |
| `channels:history` | Read public messages | ✅ Yes |
| `channels:join` | Auto-join channels | ⚡ Recommended |
| `chat:write` | Send messages | ✅ Yes |
| `groups:history` | Read private channels | ⚡ Recommended |
| `im:history` | Read DMs | ✅ Yes |
| `im:write` | Send DMs | ✅ Yes |
| `mpim:history` | Read group DMs | ⚡ Recommended |
| `reactions:write` | Add emoji reactions | ⚡ Recommended |
| `users:read` | Get user info | ⚡ Recommended |

---

## Step 4: Install to Workspace

### 4.1 Install App

1. In the left sidebar, click **Install App**

2. Click the green **Install to Workspace** button

3. Review permissions and click **Allow**

### 4.2 Copy Bot Token

After installation, you'll see **OAuth Tokens for Your Workspace**:

1. Copy **Bot User OAuth Token**
   
   ```
   xoxb-YOUR-BOT-TOKEN-HERE
   ```

2. Store it securely - you'll need it for WOPR config

### 4.3 Configure App Display

1. Go to **App Home** in the left sidebar

2. Under **Your App's Presence in Slack**:
   
   - ✅ Check **Always show my bot as online**
   - ✅ Check **Show Tabs** → **Messages Tab** → **Allow users to send Slash commands and messages from the chat tab**

3. Click **Save**

---

## Step 5: Configure WOPR

### 5.1 Edit WOPR Configuration

Open your WOPR config file:

```bash
nano ~/.wopr/config.json
```

### 5.2 Add Slack Configuration

Add this to your config (replace tokens with yours):

```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "mode": "socket",
      "botToken": "xoxb-your-bot-token-here",
      "appToken": "xapp-your-app-token-here",
      "dm": {
        "policy": "pairing",
        "allowFrom": []
      },
      "groupPolicy": "allowlist",
      "channels": {
        "#general": {
          "allow": true,
          "requireMention": false
        }
      }
    }
  }
}
```

### 5.3 Or Use Environment Variables

Instead of config file, you can use:

```bash
export SLACK_BOT_TOKEN="xoxb-your-bot-token-here"
export SLACK_APP_TOKEN="xapp-your-app-token-here"
```

Add to `~/.bashrc` or `~/.zshrc` to persist.

### 5.4 Restart WOPR

```bash
wopr restart
```

### 5.5 Verify Connection

Check logs:

```bash
tail -f ~/.wopr/logs/slack-plugin.log
```

You should see:
```
Slack Socket Mode started
```

---

## HTTP Mode Setup (Alternative)

If you prefer HTTP webhooks over Socket Mode:

### Differences from Socket Mode

- ❌ No `appToken` needed
- ✅ `signingSecret` required
- ✅ Public URL required
- ✅ Web server setup needed

### Configuration Steps

1. **Skip Step 2** (Socket Mode configuration)

2. **Enable Event Subscriptions** with Request URL:
   - Go to **Event Subscriptions**
   - Enable **Events**
   - Enter your public URL: `https://your-domain.com/slack/events`
   - Click **Verify**
   - Add the same bot events as listed above

3. **Configure WOPR**:
   ```json
   {
     "channels": {
       "slack": {
         "enabled": true,
         "mode": "http",
         "botToken": "xoxb-...",
         "signingSecret": "your-signing-secret",
         "webhookPath": "/slack/events"
       }
     }
   }
   ```

4. **Set up HTTPS endpoint** - WOPR must be accessible from internet

---

## Next Steps

### Invite Bot to Channels

In Slack:

```
/invite @YourBotName
```

Or send a DM to the bot directly.

### Test the Bot

1. Send a message in an allowed channel
2. Or DM the bot directly
3. You should see the 👀 reaction, then a response

### Customize Configuration

See [CONFIGURATION.md](./CONFIGURATION.md) for:

- 🔒 Security policies
- 🧵 Threading options
- 👀 Custom reactions
- #️⃣ Channel-specific settings

### Add More Channels

Edit `~/.wopr/config.json`:

```json
{
  "channels": {
    "#general": { "allow": true },
    "#wopr-chat": { "allow": true, "requireMention": true },
    "#private-wopr": { "allow": true }
  }
}
```

Remember to invite the bot to each channel!

---

## Troubleshooting Setup

| Issue | Solution |
|-------|----------|
| "App not found" | Check you're signed into correct workspace |
| Can't install app | Need workspace admin approval |
| Token won't generate | Ensure you have app admin rights |
| Events won't save | Must add at least one bot event |
| WOPR won't start | Validate JSON syntax: `cat config.json \| jq` |

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for more help.

---

## Configuration Templates

### Minimal (Development)

```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "mode": "socket",
      "botToken": "xoxb-...",
      "appToken": "xapp-...",
      "dm": { "policy": "open" },
      "groupPolicy": "open"
    }
  }
}
```

### Secure (Production)

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
        "allowFrom": ["U1234567890"]
      },
      "groupPolicy": "allowlist",
      "channels": {
        "#wopr-general": { "allow": true },
        "#wopr-support": { "allow": true, "requireMention": true }
      }
    }
  }
}
```

---

## 🎉 You're Done!

Your WOPR bot is now connected to Slack. Try sending a message!

For advanced configuration options, see [CONFIGURATION.md](./CONFIGURATION.md).
