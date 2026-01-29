# 🔧 Troubleshooting Guide

Common issues and solutions for the WOPR Slack Plugin.

---

## Table of Contents

- [Quick Diagnostics](#quick-diagnostics)
- [Connection Issues](#connection-issues)
- [Authentication Errors](#authentication-errors)
- [Message Handling](#message-handling)
- [Reaction Issues](#reaction-issues)
- [Performance Issues](#performance-issues)
- [Getting Help](#getting-help)

---

## Quick Diagnostics

### Check Plugin Status

```bash
# Check if plugin is loaded
wopr plugin list

# View recent logs
tail -f ~/.wopr/logs/slack-plugin.log

# Check for errors
tail -f ~/.wopr/logs/slack-plugin-error.log
```

### Verify Configuration

```bash
# Validate JSON syntax
wopr config validate

# Check environment variables
echo $SLACK_BOT_TOKEN
echo $SLACK_APP_TOKEN
```

---

## Connection Issues

### Socket Mode Not Connecting

**Symptoms:**
- Plugin loads but doesn't respond to messages
- Logs show connection errors
- No "Socket Mode started" message

**Solutions:**

1. **Verify App Token**
   ```bash
   # Check token format (should start with xapp-)
   echo $SLACK_APP_TOKEN
   ```
   
   - Go to [api.slack.com/apps](https://api.slack.com/apps)
   - Select your app → **Basic Information**
   - Scroll to **App-Level Tokens**
   - Ensure token has `connections:write` scope

2. **Check Network**
   ```bash
   # Test WebSocket connectivity
   curl -I https://slack.com
   ```
   
   - Ensure outbound WebSocket connections allowed
   - Check firewall rules (port 443)
   - Verify no proxy blocking WebSockets

3. **Enable Socket Mode in Slack**
   - Go to **Socket Mode** in left sidebar
   - Toggle **Enable Socket Mode** to On
   - Generate new token if needed

---

### HTTP Mode 401/403 Errors

**Symptoms:**
- Webhook requests return 401 or 403
- Slack shows "request failed" in app logs

**Solutions:**

1. **Verify Signing Secret**
   ```json
   {
     "channels": {
       "slack": {
         "signingSecret": "your-actual-signing-secret"
       }
     }
   }
   ```
   
   - Get from **Basic Information** → **Signing Secret**
   - Do not confuse with Client Secret

2. **Check Webhook Path**
   ```json
   {
     "channels": {
       "slack": {
         "webhookPath": "/slack/events"
       }
     }
   }
   ```
   
   - Ensure path matches Slack Event Subscriptions URL
   - Include leading slash

3. **Verify Request URL**
   - In Slack app, go to **Event Subscriptions**
   - Ensure Request URL shows ✅ **Verified**
   - Re-verify if URL changed

---

### Connection Drops / Reconnects

**Symptoms:**
- Bot intermittently stops responding
- Logs show frequent disconnect/reconnect

**Solutions:**

1. **Check Token Expiration**
   - App tokens expire after long periods
   - Regenerate at **Basic Information** → **App-Level Tokens**

2. **Review Rate Limits**
   - Slack has rate limits for connections
   - Check [Slack Rate Limits](https://api.slack.com/docs/rate-limits)

3. **Enable Debug Logging**
   ```json
   {
     "logging": {
       "level": "debug"
     }
   }
   ```

---

## Authentication Errors

### "not_authed" Error

**Symptoms:**
```
Error: not_authed
```

**Solutions:**

1. **Check Bot Token**
   - Ensure `botToken` is set (starts with `xoxb-`)
   - Verify token hasn't been revoked
   - Regenerate at **OAuth & Permissions**

2. **Reinstall App**
   - Go to **Install App** → **Reinstall to Workspace**
   - Copy new Bot User OAuth Token

---

### "invalid_auth" Error

**Symptoms:**
```
Error: invalid_auth
```

**Solutions:**

1. **Verify Token Format**
   - Bot Token: `xoxb-` prefix
   - App Token: `xapp-` prefix
   - No extra spaces or newlines

2. **Check Workspace**
   - Ensure app is installed to correct workspace
   - Token is workspace-specific

---

### "account_inactive" Error

**Symptoms:**
```
Error: account_inactive
```

**Solutions:**

1. **Reinstall App**
   - Go to **Install App** in Slack
   - Click **Reinstall to Workspace**

2. **Check App Status**
   - Ensure app isn't disabled by workspace admin
   - Verify workspace hasn't been deactivated

---

## Message Handling

### Bot Not Responding to Messages

**Symptoms:**
- Connection successful
- No response to messages
- No reactions added

**Solutions:**

1. **Invite Bot to Channel**
   ```
   /invite @YourBotName
   ```
   
   - Bot must be in channel to read messages
   - Check with `@YourBotName` mention

2. **Check Channel Configuration**
   ```json
   {
     "channels": {
       "slack": {
         "groupPolicy": "allowlist",
         "channels": {
           "#your-channel": {
             "allow": true
           }
         }
       }
     }
   }
   ```
   
   - Verify channel name matches exactly
   - Include `#` prefix
   - Check if `enabled: false` set

3. **Verify Bot Scopes**
   Required scopes:
   - `app_mentions:read`
   - `channels:history`
   - `chat:write`
   - `groups:history` (private channels)
   - `im:history` (DMs)

4. **Check DM Policy**
   ```json
   {
     "dm": {
       "policy": "open"
     }
   }
   ```
   
   - `pairing` mode requires user in `allowFrom`
   - `closed` mode ignores all DMs

---

### Bot Responding to Everything

**Symptoms:**
- Bot replies to all messages
- Ignores mention requirements

**Solutions:**

1. **Set Mention Requirement**
   ```json
   {
     "channels": {
       "#general": {
         "requireMention": true
       }
     }
   }
   ```

2. **Check Group Policy**
   ```json
   {
     "groupPolicy": "allowlist"
   }
   ```
   
   - `open` policy with `requireMention: false` responds to all

---

### Messages Being Ignored

**Symptoms:**
- Some messages processed, others ignored
- Inconsistent behavior

**Solutions:**

1. **Check for Bot Messages**
   - Bot ignores other bot messages by default
   - Prevents infinite loops

2. **Verify Message Content**
   - Empty messages ignored
   - Message edits ignored (`message_changed` subtype)

3. **Review Rate Limiting**
   - Check if hitting Slack rate limits
   - Implement delays between messages

---

## Reaction Issues

### Reactions Not Appearing

**Symptoms:**
- Bot responds but no 👀 reaction
- No success/error indicators

**Solutions:**

1. **Add Reaction Scope**
   - Go to **OAuth & Permissions**
   - Add `reactions:write` scope
   - Reinstall app

2. **Check Reaction Emoji**
   ```json
   {
     "ackReaction": "👀"
   }
   ```
   
   - Use actual emoji, not `:name:`
   - Ensure emoji is valid

3. **Verify Permissions**
   - Bot must have permission to add reactions
   - Some channels may restrict reactions

---

### Wrong Emoji Showing

**Symptoms:**
- Reaction appears as ⬜ or ?

**Solutions:**

1. **Use Unicode Emoji**
   ```json
   {
     "ackReaction": "🤖"
   }
   ```
   
   - Avoid custom emoji names
   - Use standard Unicode emojis

---

## Performance Issues

### Slow Response Times

**Symptoms:**
- Long delay between message and response
- Timeouts occurring

**Solutions:**

1. **Check WOPR Performance**
   - Response time depends on WOPR processing
   - Monitor WOPR resource usage

2. **Adjust Streaming Settings**
   ```json
   {
     "replyToMode": "off"
   }
   ```
   
   - `all` threading adds overhead
   - Consider `off` or `first` for speed

3. **Review Network Latency**
   - Check connection to Slack servers
   - Consider region-based deployment

---

### High Memory Usage

**Symptoms:**
- Memory usage grows over time
- Process eventually crashes

**Solutions:**

1. **Check Log Rotation**
   ```bash
   # Check log sizes
   ls -lh ~/.wopr/logs/slack-plugin*.log
   ```

2. **Reduce Log Level**
   ```json
   {
     "logging": {
       "level": "info"
     }
   }
   ```

3. **Monitor Active Streams**
   - Streaming sessions are cleaned up automatically
   - Report if streams accumulate

---

## Common Error Messages

### "channel_not_found"

**Cause:** Bot not in channel or channel doesn't exist

**Fix:**
```
/invite @YourBotName
```

---

### "is_archived"

**Cause:** Channel is archived

**Fix:** Unarchive channel or remove from config

---

### "msg_too_long"

**Cause:** Message exceeds 4000 characters

**Fix:** Plugin auto-truncates, but check for excessive output

---

### "rate_limited"

**Cause:** Hitting Slack API rate limits

**Fix:** Reduce message frequency, implement backoff

---

## Debug Mode

Enable detailed logging:

```bash
# Set debug environment
export DEBUG=slack:*

# Or in config
{
  "logging": {
    "level": "debug",
    "slack": true
  }
}
```

### Log Locations

| Log File | Contents |
|----------|----------|
| `~/.wopr/logs/slack-plugin.log` | General activity |
| `~/.wopr/logs/slack-plugin-error.log` | Errors only |

---

## Getting Help

### Before Asking

1. **Check logs first**
   ```bash
   tail -n 100 ~/.wopr/logs/slack-plugin-error.log
   ```

2. **Verify configuration**
   ```bash
   cat ~/.wopr/config.json | jq '.channels.slack'
   ```

3. **Test with minimal config**
   - Use basic Socket Mode config
   - Disable all policies
   - Test in DM first

### Where to Get Help

- 🐛 [GitHub Issues](https://github.com/TSavo/wopr-plugin-slack/issues)
- 💬 [WOPR Discussions](https://github.com/TSavo/wopr/discussions)
- 📖 [WOPR Documentation](https://github.com/TSavo/wopr/tree/main/docs)

### Information to Include

When reporting issues:

1. WOPR version: `wopr --version`
2. Plugin version from `package.json`
3. Relevant log excerpts
4. Configuration (redact tokens!)
5. Slack app configuration summary

---

## Quick Fix Checklist

- [ ] Bot token valid and starts with `xoxb-`
- [ ] App token valid and starts with `xapp-` (Socket Mode)
- [ ] App installed to workspace
- [ ] Bot invited to channel
- [ ] Required scopes granted
- [ ] Socket Mode enabled (if using)
- [ ] Event subscriptions configured (if using HTTP)
- [ ] JSON config is valid
- [ ] Environment variables set correctly
- [ ] No firewall blocking connections
