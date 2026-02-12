/**
 * WOPR Slack Plugin
 *
 * Supports both Socket Mode (default) and HTTP webhook mode.
 * Uses @slack/bolt for robust event handling.
 */

import { App, LogLevel } from "@slack/bolt";
import winston from "winston";
import path from "node:path";
import type {
	WOPRPlugin,
	WOPRPluginContext,
	ConfigSchema,
	StreamMessage,
	SlackConfig,
	AgentIdentity,
} from "./types.js";
import {
	createPairingRequest,
	checkRequestRateLimit,
	buildPairingMessage,
	isUserAllowed,
	approveUser,
	claimPairingCode,
	cleanupExpiredPairings,
} from "./pairing.js";

const logger = winston.createLogger({
	level: "debug",
	format: winston.format.combine(
		winston.format.timestamp(),
		winston.format.errors({ stack: true }),
		winston.format.json(),
	),
	defaultMeta: { service: "wopr-plugin-slack" },
	transports: [
		new winston.transports.File({
			filename: path.join(
				process.env.WOPR_HOME || "/tmp/wopr-test",
				"logs",
				"slack-plugin-error.log",
			),
			level: "error",
		}),
		new winston.transports.File({
			filename: path.join(
				process.env.WOPR_HOME || "/tmp/wopr-test",
				"logs",
				"slack-plugin.log",
			),
			level: "debug",
		}),
		new winston.transports.Console({
			format: winston.format.combine(
				winston.format.colorize(),
				winston.format.simple(),
			),
			level: "warn",
		}),
	],
});

let app: App | null = null;
let ctx: WOPRPluginContext | null = null;
let agentIdentity: AgentIdentity = { name: "WOPR", emoji: "👀" };
let cleanupTimer: NodeJS.Timeout | null = null;

// Track active streaming sessions
interface StreamState {
	channelId: string;
	threadTs?: string;
	messageTs: string;
	buffer: string;
	lastEdit: number;
	isFinalized: boolean;
}

const activeStreams = new Map<string, StreamState>();

// Config schema for WebUI
const configSchema: ConfigSchema = {
	title: "Slack Integration",
	description: "Configure Slack bot integration",
	fields: [
		{
			name: "mode",
			type: "select",
			label: "Connection Mode",
			options: [
				{ value: "socket", label: "Socket Mode (recommended)" },
				{ value: "http", label: "HTTP Webhooks" },
			],
			default: "socket",
			description:
				"Socket Mode works through firewalls, HTTP requires public URL",
		},
		{
			name: "botToken",
			type: "password",
			label: "Bot Token",
			placeholder: "xoxb-...",
			required: true,
			description: "Bot User OAuth Token from Slack",
		},
		{
			name: "appToken",
			type: "password",
			label: "App Token",
			placeholder: "xapp-...",
			description:
				"Required for Socket Mode (App-Level Token with connections:write)",
		},
		{
			name: "signingSecret",
			type: "password",
			label: "Signing Secret",
			placeholder: "...",
			description: "Required for HTTP mode (from Slack App Basic Info)",
		},
		{
			name: "ackReaction",
			type: "text",
			label: "Ack Reaction Emoji",
			placeholder: "👀",
			default: "👀",
			description: "Emoji to react with while processing",
		},
		{
			name: "replyToMode",
			type: "select",
			label: "Reply Threading",
			options: [
				{ value: "off", label: "Reply in channel" },
				{ value: "first", label: "First reply in thread" },
				{ value: "all", label: "All replies in thread" },
			],
			default: "off",
			description: "Control automatic threading of replies",
		},
		{
			name: "dmPolicy",
			type: "select",
			label: "DM Policy",
			options: [
				{ value: "pairing", label: "Pairing (approve unknown users)" },
				{ value: "open", label: "Open (accept all DMs)" },
				{ value: "closed", label: "Closed (ignore DMs)" },
			],
			default: "pairing",
			description: "How to handle direct messages from unknown users",
		},
		{
			name: "enabled",
			type: "checkbox",
			label: "Enabled",
			default: true,
		},
	],
};

// Discord limit is 2000, Slack is 4000
const SLACK_LIMIT = 4000;
const EDIT_THRESHOLD = 1500; // Edit after 1500 new chars
const IDLE_SPLIT_MS = 1000; // New message after 1s idle

/**
 * Refresh agent identity from workspace
 */
async function refreshIdentity() {
	if (!ctx) return;
	try {
		const identity = await ctx.getAgentIdentity();
		if (identity) {
			agentIdentity = { ...agentIdentity, ...identity };
			logger.info({ msg: "Identity refreshed", identity: agentIdentity });
		}
	} catch (e) {
		logger.warn({ msg: "Failed to refresh identity", error: String(e) });
	}
}

/**
 * Get the reaction emoji (from identity or default)
 */
function getAckReaction(config: SlackConfig): string {
	return config.ackReaction?.trim() || agentIdentity.emoji?.trim() || "👀";
}

/**
 * Build session key from Slack context
 */
function buildSessionKey(
	channelId: string,
	userId: string,
	isDM: boolean,
): string {
	if (isDM) {
		return `slack-dm-${userId}`;
	}
	return `slack-channel-${channelId}`;
}

/**
 * Determine if we should respond to this message
 */
async function shouldRespond(
	message: any,
	context: any,
	config: SlackConfig,
): Promise<boolean> {
	// Ignore bot messages
	if (message.subtype === "bot_message" || message.bot_id) {
		return false;
	}

	// Ignore message_changed (edits)
	if (message.subtype === "message_changed") {
		return false;
	}

	const isDM = context.channel?.startsWith("D") || false;

	// DM handling
	if (isDM) {
		if (config.dm?.enabled === false) return false;

		const policy = config.dm?.policy || "pairing";
		if (policy === "closed") return false;
		if (policy === "open") return true;

		// Pairing mode - check if user is already approved
		if (ctx && isUserAllowed(ctx, message.user)) return true;

		// Check if this is a claim attempt (user typing a pairing code)
		const trimmed = (message.text || "").trim().toUpperCase();
		if (/^[A-Z2-9]{8}$/.test(trimmed)) {
			// Looks like a pairing code — try to claim it
			const { request, error } = claimPairingCode(
				trimmed,
				message.user,
				message.user,
			);
			if (request && ctx) {
				await approveUser(ctx, request.slackUserId);
				logger.info({ msg: "Pairing claimed via DM", user: message.user });
				// Send confirmation — we'll respond via the say callback if available
				// Store the approval message in a special field so handleMessage can send it
				(message as any).__pairingApproved = true;
				return true;
			}
			// If it failed, fall through to the pairing prompt below
			if (error) {
				logger.debug({
					msg: "Pairing claim failed",
					user: message.user,
					error,
				});
			}
		}

		// Rate-limit pairing requests
		if (!checkRequestRateLimit(message.user)) {
			logger.info({ msg: "Pairing request rate-limited", user: message.user });
			return false;
		}

		// Generate pairing code and send it to the user
		const username =
			message.user_profile?.display_name || message.user || "unknown";
		const code = createPairingRequest(message.user, username);
		const pairingMsg = buildPairingMessage(code);

		logger.info({
			msg: "Pairing code issued",
			user: message.user,
			code,
		});

		// Send the pairing message directly via the Slack API
		try {
			await app?.client.chat.postMessage({
				channel: context.channel,
				text: pairingMsg,
			});
		} catch (e) {
			logger.warn({ msg: "Failed to send pairing message", error: String(e) });
		}

		return false;
	}

	// Channel handling
	const groupPolicy = config.groupPolicy || "allowlist";
	if (groupPolicy === "disabled") return false;
	if (groupPolicy === "open") {
		// In open mode, only respond to mentions
		return message.text?.includes(`<@${context.botUserId}>`) || false;
	}

	// Allowlist mode
	const channelConfig = config.channels?.[context.channel];
	if (
		!channelConfig ||
		channelConfig.enabled === false ||
		channelConfig.allow === false
	) {
		return false;
	}

	// Check if mention required
	if (channelConfig.requireMention) {
		return message.text?.includes(`<@${context.botUserId}>`) || false;
	}

	return true;
}

/**
 * Handle incoming Slack message
 */
async function handleMessage(
	message: any,
	context: any,
	say: any,
	config: SlackConfig,
) {
	logger.debug({
		msg: "RECEIVED MESSAGE",
		text: message.text?.substring(0, 100),
		user: message.user,
		channel: context.channel,
		isDM: context.channel?.startsWith("D"),
	});

	if (!ctx) return;

	const isDM = context.channel?.startsWith("D") || false;

	// Check if we should respond
	if (!(await shouldRespond(message, context, config))) {
		// Still log to session for context
		const sessionKey = buildSessionKey(context.channel, message.user, isDM);
		try {
			ctx.logMessage(sessionKey, message.text, {
				from: message.user,
				channel: { type: "slack", id: context.channel },
			});
		} catch (e) {}
		return;
	}

	// If user was just approved via pairing, send confirmation before processing
	if ((message as any).__pairingApproved) {
		try {
			await say({
				text: "Your account has been paired. I'll respond to your messages from now on.",
			});
		} catch (e) {
			logger.warn({
				msg: "Failed to send pairing confirmation",
				error: String(e),
			});
		}
	}

	// Add ack reaction
	const ackEmoji = getAckReaction(config);
	try {
		await app?.client.reactions.add({
			channel: context.channel,
			timestamp: message.ts,
			name: ackEmoji.replace(/:/g, ""), // Remove colons if present
		});
	} catch (e) {
		logger.warn({ msg: "Failed to add reaction", error: String(e) });
	}

	const sessionKey = buildSessionKey(context.channel, message.user, isDM);

	// Determine reply threading
	const replyToMode = config.replyToMode || "off";
	const shouldThread =
		replyToMode === "all" ||
		(replyToMode === "first" && message.thread_ts) ||
		message.thread_ts;

	// Create stream state
	const streamState: StreamState = {
		channelId: context.channel,
		threadTs: shouldThread ? message.thread_ts || message.ts : undefined,
		messageTs: "", // Will be set on first send
		buffer: "",
		lastEdit: 0,
		isFinalized: false,
	};

	activeStreams.set(sessionKey, streamState);

	try {
		// Send initial message
		const initialResponse = await say({
			text: "_Thinking..._",
			thread_ts: streamState.threadTs,
		});

		streamState.messageTs = initialResponse.ts;

		// Stream handling
		let buffer = "";
		let lastFlush = Date.now();
		let finalizeTimer: NodeJS.Timeout | null = null;

		const handleChunk = async (msg: StreamMessage) => {
			if (streamState.isFinalized) return;

			let textContent = "";
			if (msg.type === "text" && msg.content) {
				textContent = msg.content;
			} else if (msg.type === "assistant" && (msg as any).message?.content) {
				const content = (msg as any).message.content;
				if (Array.isArray(content)) {
					textContent = content.map((c: any) => c.text || "").join("");
				} else if (typeof content === "string") {
					textContent = content;
				}
			}

			if (!textContent) return;

			buffer += textContent;
			const now = Date.now();

			// Check for idle gap
			if (now - lastFlush > IDLE_SPLIT_MS && buffer.length > 0) {
				// Finalize current and start new
				await updateMessage(streamState, buffer);
				buffer = "";
			}

			lastFlush = now;

			// Update message if we have enough content
			if (buffer.length >= EDIT_THRESHOLD) {
				await updateMessage(streamState, buffer);
			}

			// Reset finalize timer
			if (finalizeTimer) clearTimeout(finalizeTimer);
			finalizeTimer = setTimeout(async () => {
				if (buffer.length > 0 && !streamState.isFinalized) {
					await finalizeMessage(streamState, buffer);
				}
			}, 2000);
		};

		// Inject to WOPR
		const response = await ctx.inject(sessionKey, message.text, {
			from: message.user,
			channel: { type: "slack", id: context.channel },
			onStream: handleChunk,
		});

		// Finalize
		if (finalizeTimer) clearTimeout(finalizeTimer);
		if (!streamState.isFinalized) {
			const finalText = buffer || response;
			await finalizeMessage(streamState, finalText);
		}

		// Remove ack reaction and add success
		try {
			await app?.client.reactions.remove({
				channel: context.channel,
				timestamp: message.ts,
				name: ackEmoji.replace(/:/g, ""),
			});
			await app?.client.reactions.add({
				channel: context.channel,
				timestamp: message.ts,
				name: "white_check_mark",
			});
		} catch (e) {}
	} catch (error: any) {
		logger.error({ msg: "Inject failed", error: String(error) });

		// Update message with error
		try {
			await app?.client.chat.update({
				channel: streamState.channelId,
				ts: streamState.messageTs,
				text: "❌ Error processing your request. Please try again.",
			});
		} catch (e) {}

		// Remove ack and add error reaction
		try {
			await app?.client.reactions.remove({
				channel: context.channel,
				timestamp: message.ts,
				name: ackEmoji.replace(/:/g, ""),
			});
			await app?.client.reactions.add({
				channel: context.channel,
				timestamp: message.ts,
				name: "x",
			});
		} catch (e) {}
	} finally {
		activeStreams.delete(sessionKey);
	}
}

/**
 * Update a Slack message with new content
 */
async function updateMessage(
	state: StreamState,
	content: string,
): Promise<void> {
	if (!app || state.isFinalized) return;

	// Chunk if over limit
	let text = content;
	if (text.length > SLACK_LIMIT) {
		text = text.substring(0, SLACK_LIMIT - 3) + "...";
	}

	try {
		await app.client.chat.update({
			channel: state.channelId,
			ts: state.messageTs,
			text,
		});
		state.lastEdit = Date.now();
	} catch (e) {
		logger.warn({ msg: "Failed to update message", error: String(e) });
	}
}

/**
 * Finalize a Slack message
 */
async function finalizeMessage(
	state: StreamState,
	content: string,
): Promise<void> {
	if (!app || state.isFinalized) return;
	state.isFinalized = true;

	// Chunk if over limit
	let text = content;
	if (text.length > SLACK_LIMIT) {
		text = text.substring(0, SLACK_LIMIT - 3) + "...";
	}

	try {
		await app.client.chat.update({
			channel: state.channelId,
			ts: state.messageTs,
			text,
		});
	} catch (e) {
		logger.warn({ msg: "Failed to finalize message", error: String(e) });
	}
}

/**
 * Initialize the Slack app
 */
async function initSlackApp(config: SlackConfig): Promise<App> {
	const mode = config.mode || "socket";

	if (mode === "socket") {
		if (!config.appToken) {
			throw new Error(
				"App Token required for Socket Mode. Set channels.slack.appToken",
			);
		}

		return new App({
			token: config.botToken,
			appToken: config.appToken,
			socketMode: true,
			logLevel: LogLevel.INFO,
		});
	} else {
		// HTTP mode
		if (!config.signingSecret) {
			throw new Error(
				"Signing Secret required for HTTP mode. Set channels.slack.signingSecret",
			);
		}

		return new App({
			token: config.botToken,
			signingSecret: config.signingSecret,
			endpoints: config.webhookPath || "/slack/events",
			logLevel: LogLevel.INFO,
		});
	}
}

const plugin: WOPRPlugin = {
	name: "wopr-plugin-slack",
	version: "1.0.0",
	description: "Slack integration with Socket Mode and HTTP webhook support",

	async init(context: WOPRPluginContext) {
		ctx = context;
		ctx.registerConfigSchema("wopr-plugin-slack", configSchema);

		// Load agent identity
		await refreshIdentity();

		// Get config - config is stored directly on the plugin, not nested under channels
		let fullConfig = ctx.getConfig<{ channels?: { slack?: SlackConfig } }>();
		let config: SlackConfig = fullConfig?.channels?.slack || {};

		// Check env vars as fallback
		if (!config.botToken && process.env.SLACK_BOT_TOKEN) {
			config = {
				...config,
				botToken: process.env.SLACK_BOT_TOKEN,
			};
		}
		if (!config.appToken && process.env.SLACK_APP_TOKEN) {
			config = {
				...config,
				appToken: process.env.SLACK_APP_TOKEN,
			};
		}

		if (!config.enabled) {
			logger.info("Slack plugin disabled in config");
			return;
		}

		if (!config.botToken) {
			logger.warn(
				"Slack bot token not configured. Set SLACK_BOT_TOKEN or config.channels.slack.botToken",
			);
			return;
		}

		// Initialize Slack app
		try {
			app = await initSlackApp(config);

			// Store bot user ID for mention detection
			const authTest = await app.client.auth.test();
			const botUserId = authTest.user_id;

			// Message handler
			app.message(async ({ message, context, say }) => {
				// Skip messages without text or subtyped messages (like edits)
				if (!("text" in message) || !message.text) return;

				// Add bot user ID to context
				(context as any).botUserId = botUserId;

				await handleMessage(message as any, context, say, config);
			});

			// App mention handler
			app.event("app_mention", async ({ event, context, say }) => {
				await handleMessage(
					event,
					{ ...context, channel: event.channel },
					say,
					config,
				);
			});

			// Start periodic cleanup of expired pairing codes
			cleanupTimer = setInterval(() => cleanupExpiredPairings(), 5 * 60 * 1000);

			// Start the app
			const mode = config.mode || "socket";
			if (mode === "socket") {
				await app.start();
				logger.info("Slack Socket Mode started");
			} else {
				// HTTP mode - app is started by Express/Hono server elsewhere
				logger.info("Slack HTTP mode configured");
			}
		} catch (error: any) {
			logger.error({
				msg: "Failed to initialize Slack app",
				error: error.message,
			});
			throw error;
		}
	},

	async shutdown() {
		if (cleanupTimer) {
			clearInterval(cleanupTimer);
			cleanupTimer = null;
		}
		if (app) {
			await app.stop();
			logger.info("Slack plugin stopped");
		}
	},
};

export default plugin;
