/**
 * WOPR Slack Plugin
 *
 * Supports both Socket Mode (default) and HTTP webhook mode.
 * Uses @slack/bolt for robust event handling.
 */

import crypto from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { App, FileInstallationStore, LogLevel } from "@slack/bolt";
import winston from "winston";
import {
	getEffectiveSessionKey,
	incrementMessageCount,
	registerSlashCommands,
} from "./commands.js";
import {
	approveUser,
	buildPairingMessage,
	checkRequestRateLimit,
	claimPairingCode,
	cleanupExpiredPairings,
	createPairingRequest,
	isUserAllowed,
} from "./pairing.js";
import { withRetry } from "./retry.js";
import { startTyping, stopTyping, stopAllTyping } from "./typing.js";
import type {
	AgentIdentity,
	ChannelCommand,
	ChannelCommandContext,
	ChannelMessageContext,
	ChannelMessageParser,
	ChannelProvider,
	ConfigSchema,
	RetryConfig,
	SlackConfig,
	StreamMessage,
	WOPRPlugin,
	WOPRPluginContext,
} from "./types.js";

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
let retryConfig: RetryConfig = {};

/**
 * Build retry options with logging for a Slack API call
 */
function retryOpts(label: string) {
	return {
		...retryConfig,
		onRetry: (attempt: number, delay: number, error: unknown) => {
			logger.warn({
				msg: `Retrying Slack API call: ${label}`,
				attempt,
				delay,
				error: String(error),
			});
		},
	};
}

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

// ============================================================================
// Channel Provider (cross-plugin command/parser registration)
// ============================================================================

const registeredCommands: Map<string, ChannelCommand> = new Map();
const registeredParsers: Map<string, ChannelMessageParser> = new Map();

const slackChannelProvider: ChannelProvider = {
	id: "slack",

	registerCommand(cmd: ChannelCommand): void {
		registeredCommands.set(cmd.name, cmd);
		logger.info({ msg: "Channel command registered", name: cmd.name });
	},

	unregisterCommand(name: string): void {
		registeredCommands.delete(name);
	},

	getCommands(): ChannelCommand[] {
		return Array.from(registeredCommands.values());
	},

	addMessageParser(parser: ChannelMessageParser): void {
		registeredParsers.set(parser.id, parser);
		logger.info({ msg: "Message parser registered", id: parser.id });
	},

	removeMessageParser(id: string): void {
		registeredParsers.delete(id);
	},

	getMessageParsers(): ChannelMessageParser[] {
		return Array.from(registeredParsers.values());
	},

	async send(channelId: string, content: string): Promise<void> {
		if (!app) throw new Error("Slack app not initialized");
		// Split content into chunks of SLACK_LIMIT chars
		const chunks: string[] = [];
		let remaining = content;
		while (remaining.length > 0) {
			if (remaining.length <= SLACK_LIMIT) {
				chunks.push(remaining);
				break;
			}
			let splitAt = remaining.lastIndexOf("\n", SLACK_LIMIT);
			if (splitAt < SLACK_LIMIT - 500)
				splitAt = remaining.lastIndexOf(" ", SLACK_LIMIT);
			if (splitAt < SLACK_LIMIT - 500) splitAt = SLACK_LIMIT;
			chunks.push(remaining.slice(0, splitAt));
			remaining = remaining.slice(splitAt).trimStart();
		}
		for (const chunk of chunks) {
			if (chunk.trim()) {
				await withRetry(
					() =>
						app!.client.chat.postMessage({ channel: channelId, text: chunk }),
					retryOpts("chat.postMessage:channelProvider"),
				);
			}
		}
	},

	getBotUsername(): string {
		return botUsername || "unknown";
	},
};

// ============================================================================
// Extension API (for cross-plugin and CLI access)
// ============================================================================

const slackExtension = {
	getBotUsername: () => botUsername || "unknown",

	claimOwnership: async (
		code: string,
		sourceId?: string,
		claimingUserId?: string,
	): Promise<{
		success: boolean;
		userId?: string;
		username?: string;
		error?: string;
	}> => {
		if (!ctx) return { success: false, error: "Slack plugin not initialized" };

		const result = claimPairingCode(code, sourceId, claimingUserId);
		if (!result.request) {
			return {
				success: false,
				error: result.error || "Invalid or expired pairing code",
			};
		}

		try {
			await approveUser(ctx, result.request.slackUserId);
		} catch (e) {
			return {
				success: false,
				error: `Failed to approve user: ${e instanceof Error ? e.message : String(e)}`,
			};
		}

		return {
			success: true,
			userId: result.request.slackUserId,
			username: result.request.slackUsername,
		};
	},
};

// Store bot username and token for ChannelProvider and file downloads
let botUsername = "";
let storedBotToken = "";

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
			name: "clientId",
			type: "password",
			label: "Client ID",
			placeholder: "...",
			description:
				"OAuth Client ID for automatic token rotation (granular permissions)",
		},
		{
			name: "clientSecret",
			type: "password",
			label: "Client Secret",
			placeholder: "...",
			description:
				"OAuth Client Secret for automatic token rotation (granular permissions)",
		},
		{
			name: "stateSecret",
			type: "password",
			label: "State Secret",
			placeholder: "...",
			description: "Secret for OAuth state verification (any random string)",
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
		{
			name: "retryMaxRetries",
			type: "text",
			label: "Max Retries",
			placeholder: "3",
			default: "3",
			description: "Maximum number of retries for rate-limited API calls",
		},
		{
			name: "retryBaseDelay",
			type: "text",
			label: "Retry Base Delay (ms)",
			placeholder: "1000",
			default: "1000",
			description: "Base delay in milliseconds for exponential backoff",
		},
		{
			name: "retryMaxDelay",
			type: "text",
			label: "Retry Max Delay (ms)",
			placeholder: "30000",
			default: "30000",
			description: "Maximum delay in milliseconds between retries",
		},
	],
};

// Discord limit is 2000, Slack is 4000
const SLACK_LIMIT = 4000;
const EDIT_THRESHOLD = 1500; // Edit after 1500 new chars
const IDLE_SPLIT_MS = 1000; // New message after 1s idle

// Attachments directory (same convention as Discord plugin)
const ATTACHMENTS_DIR = existsSync("/data")
	? "/data/attachments"
	: path.join(process.env.WOPR_HOME || "/tmp/wopr-test", "data", "attachments");

/** Slack file object shape (subset of fields we use) */
interface SlackFile {
	id: string;
	name?: string;
	url_private_download?: string;
	url_private?: string;
	size?: number;
	mimetype?: string;
}

/**
 * Download Slack file attachments to disk.
 * Slack files require the bot token in the Authorization header.
 * Returns an array of saved file paths.
 */
export async function saveAttachments(
	files: SlackFile[],
	userId: string,
	botToken: string,
): Promise<string[]> {
	if (!files || files.length === 0) return [];

	try {
		if (!existsSync(ATTACHMENTS_DIR)) {
			mkdirSync(ATTACHMENTS_DIR, { recursive: true });
		}
	} catch (err) {
		logger.error({
			msg: "Failed to create attachments directory",
			dir: ATTACHMENTS_DIR,
			error: String(err),
		});
		return [];
	}

	const savedPaths: string[] = [];

	for (const file of files) {
		const downloadUrl = file.url_private_download || file.url_private;
		if (!downloadUrl) {
			logger.warn({ msg: "Slack file has no download URL", fileId: file.id });
			continue;
		}

		try {
			const timestamp = Date.now();
			const safeName =
				file.name?.replace(/[^a-zA-Z0-9._-]/g, "_") || "attachment";
			const filename = `${timestamp}-${userId}-${safeName}`;
			const filepath = path.join(ATTACHMENTS_DIR, filename);

			const response = await fetch(downloadUrl, {
				headers: { Authorization: `Bearer ${botToken}` },
			});

			if (!response.ok) {
				logger.warn({
					msg: "Failed to download Slack file",
					fileId: file.id,
					url: downloadUrl,
					status: response.status,
				});
				continue;
			}

			const arrayBuf = await response.arrayBuffer();
			writeFileSync(filepath, Buffer.from(arrayBuf));

			savedPaths.push(filepath);
			logger.info({
				msg: "Slack attachment saved",
				filename,
				size: file.size,
				mimetype: file.mimetype,
			});
		} catch (err) {
			logger.error({
				msg: "Error saving Slack attachment",
				fileId: file.id,
				name: file.name,
				error: String(err),
			});
		}
	}

	return savedPaths;
}

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
				try {
					await approveUser(ctx, request.slackUserId);
				} catch (e) {
					logger.error({
						msg: "Failed to approve user after pairing claim",
						user: message.user,
						error: String(e),
					});
				}
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
			await withRetry(
				() =>
					app!.client.chat.postMessage({
						channel: context.channel,
						text: pairingMsg,
					}),
				retryOpts("chat.postMessage:pairing"),
			);
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
		const sessionKey = getEffectiveSessionKey(
			context.channel,
			message.user,
			isDM,
		);
		try {
			ctx.logMessage(sessionKey, message.text, {
				from: message.user,
				channel: { type: "slack", id: context.channel },
			});
		} catch (e) {}
		return;
	}

	// If user was just approved via pairing, send confirmation and return early
	// so the original code string doesn't get processed as regular input
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
		return;
	}

	// Add ack reaction
	const ackEmoji = getAckReaction(config);
	try {
		await withRetry(
			() =>
				app!.client.reactions.add({
					channel: context.channel,
					timestamp: message.ts,
					name: ackEmoji.replace(/:/g, ""), // Remove colons if present
				}),
			retryOpts("reactions.add:ack"),
		);
	} catch (e) {
		logger.warn({ msg: "Failed to add reaction", error: String(e) });
	}

	const sessionKey = getEffectiveSessionKey(
		context.channel,
		message.user,
		isDM,
	);
	incrementMessageCount(sessionKey);

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

		// Start typing indicator (animates the placeholder until content arrives)
		startTyping(sessionKey, context.channel, streamState.messageTs, {
			chatUpdate: (params) => app!.client.chat.update(params),
			retryOpts: retryOpts("chat.update:typing"),
			logger,
		});

		// Stream handling
		let buffer = "";
		let lastFlush = Date.now();
		let finalizeTimer: NodeJS.Timeout | null = null;

		const handleChunk = async (msg: StreamMessage) => {
			if (streamState.isFinalized) return;

			let textContent = "";
			if (msg.type === "text" && msg.content) {
				textContent = msg.content;
			} else if (
				(msg.type as string) === "assistant" &&
				(msg as any).message?.content
			) {
				const content = (msg as any).message.content;
				if (Array.isArray(content)) {
					textContent = content.map((c: any) => c.text || "").join("");
				} else if (typeof content === "string") {
					textContent = content;
				}
			}

			if (!textContent) return;

			// Stop typing animation once real content starts flowing
			stopTyping(sessionKey);

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

		// Handle file attachments
		let messageContent: string = message.text || "";
		const effectiveBotToken = context.botToken || storedBotToken;
		if (
			message.files &&
			Array.isArray(message.files) &&
			message.files.length > 0 &&
			effectiveBotToken
		) {
			const attachmentPaths = await saveAttachments(
				message.files as SlackFile[],
				message.user,
				effectiveBotToken,
			);
			if (attachmentPaths.length > 0) {
				const attachmentInfo = attachmentPaths
					.map((p: string) => `[Attachment: ${p}]`)
					.join("\n");
				messageContent = messageContent
					? `${messageContent}\n\n${attachmentInfo}`
					: attachmentInfo;
				logger.info({
					msg: "Attachments appended to message",
					count: attachmentPaths.length,
					channel: context.channel,
				});
			}
		}

		// Skip injection if content is empty (e.g., file-only message where all downloads failed)
		if (!messageContent.trim()) {
			logger.warn({
				msg: "Skipping inject — message content is empty after attachment handling",
				user: message.user,
				channel: context.channel,
			});
			// Clean up the "Thinking..." placeholder
			try {
				await withRetry(
					() =>
						app!.client.chat.delete({
							channel: streamState.channelId,
							ts: streamState.messageTs,
						}),
					retryOpts("chat.delete:empty"),
				);
			} catch (_e) {}
			return;
		}

		// Inject to WOPR
		const response = await ctx.inject(sessionKey, messageContent, {
			from: message.user,
			channel: { type: "slack", id: context.channel },
			onStream: handleChunk,
		});

		// Finalize — stop typing indicator before final message update
		stopTyping(sessionKey);
		if (finalizeTimer) clearTimeout(finalizeTimer);
		if (!streamState.isFinalized) {
			const finalText = buffer || response;
			await finalizeMessage(streamState, finalText);
		}

		// Remove ack reaction and add success
		try {
			await withRetry(
				() =>
					app!.client.reactions.remove({
						channel: context.channel,
						timestamp: message.ts,
						name: ackEmoji.replace(/:/g, ""),
					}),
				retryOpts("reactions.remove:ack"),
			);
			await withRetry(
				() =>
					app!.client.reactions.add({
						channel: context.channel,
						timestamp: message.ts,
						name: "white_check_mark",
					}),
				retryOpts("reactions.add:success"),
			);
		} catch (e) {}
	} catch (error: any) {
		stopTyping(sessionKey);
		logger.error({ msg: "Inject failed", error: String(error) });

		// Update message with error
		try {
			await withRetry(
				() =>
					app!.client.chat.update({
						channel: streamState.channelId,
						ts: streamState.messageTs,
						text: "❌ Error processing your request. Please try again.",
					}),
				retryOpts("chat.update:error"),
			);
		} catch (e) {}

		// Remove ack and add error reaction
		try {
			await withRetry(
				() =>
					app!.client.reactions.remove({
						channel: context.channel,
						timestamp: message.ts,
						name: ackEmoji.replace(/:/g, ""),
					}),
				retryOpts("reactions.remove:ack-error"),
			);
			await withRetry(
				() =>
					app!.client.reactions.add({
						channel: context.channel,
						timestamp: message.ts,
						name: "x",
					}),
				retryOpts("reactions.add:error"),
			);
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
		await withRetry(
			() =>
				app!.client.chat.update({
					channel: state.channelId,
					ts: state.messageTs,
					text,
				}),
			retryOpts("chat.update:stream"),
		);
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
		await withRetry(
			() =>
				app!.client.chat.update({
					channel: state.channelId,
					ts: state.messageTs,
					text,
				}),
			retryOpts("chat.update:finalize"),
		);
	} catch (e) {
		logger.warn({ msg: "Failed to finalize message", error: String(e) });
	}
}

/**
 * Build OAuth / token rotation options when credentials are provided.
 * Bolt 4 uses these to auto-refresh granular bot tokens (90-day expiry).
 */
function buildOAuthOptions(config: SlackConfig) {
	if (!config.clientId || !config.clientSecret) return {};

	const installDir = path.join(
		process.env.WOPR_HOME || "/tmp/wopr-test",
		"data",
		"slack-installations",
	);

	let stateSecret = config.stateSecret;
	if (!stateSecret) {
		stateSecret = crypto.randomBytes(32).toString("hex");
		logger.warn(
			"No stateSecret configured for OAuth. Generated a random one — it will not persist across restarts. Set SLACK_STATE_SECRET or config.channels.slack.stateSecret for stable CSRF protection.",
		);
	}

	return {
		clientId: config.clientId,
		clientSecret: config.clientSecret,
		stateSecret,
		installationStore: new FileInstallationStore({
			baseDir: installDir,
		}),
		tokenVerificationEnabled: true,
	};
}

/**
 * Initialize the Slack app
 */
async function initSlackApp(config: SlackConfig): Promise<App> {
	const mode = config.mode || "socket";
	const oauthOpts = buildOAuthOptions(config);
	const hasOAuth = "installationStore" in oauthOpts;

	if (mode === "socket") {
		if (!config.appToken) {
			throw new Error(
				"App Token required for Socket Mode. Set channels.slack.appToken",
			);
		}

		return new App({
			...(hasOAuth ? {} : { token: config.botToken }),
			appToken: config.appToken,
			socketMode: true,
			logLevel: LogLevel.INFO,
			...oauthOpts,
		});
	} else {
		// HTTP mode
		if (!config.signingSecret) {
			throw new Error(
				"Signing Secret required for HTTP mode. Set channels.slack.signingSecret",
			);
		}

		return new App({
			...(hasOAuth ? {} : { token: config.botToken }),
			signingSecret: config.signingSecret,
			endpoints: config.webhookPath || "/slack/events",
			logLevel: LogLevel.INFO,
			...oauthOpts,
		});
	}
}

const plugin: WOPRPlugin = {
	name: "wopr-plugin-slack",
	version: "1.0.0",
	description: "Slack integration with Socket Mode and HTTP webhook support",

	commands: [
		{
			name: "slack",
			description: "Slack plugin commands",
			usage: "wopr slack claim <code>",
			async handler(_context: WOPRPluginContext, args: string[]) {
				const [subcommand, ...rest] = args;

				if (subcommand === "claim") {
					const code = rest[0];
					if (!code) {
						console.log("Usage: wopr slack claim <code>");
						console.log("  Claim a pairing code to approve your Slack account");
						process.exit(1);
					}

					try {
						const response = await fetch(
							"http://localhost:7437/plugins/slack/claim",
							{
								method: "POST",
								headers: { "Content-Type": "application/json" },
								body: JSON.stringify({ code }),
							},
						);
						const result = (await response.json()) as {
							success?: boolean;
							userId?: string;
							username?: string;
							error?: string;
						};

						if (result.success) {
							console.log("Slack account paired successfully!");
							console.log(`  User: ${result.username} (${result.userId})`);
							process.exit(0);
						} else {
							console.log(
								`Failed to claim: ${result.error || "Unknown error"}`,
							);
							process.exit(1);
						}
					} catch (_err) {
						console.log(
							"Error: Could not connect to WOPR daemon. Is it running?",
						);
						console.log("  Start it with: wopr daemon start");
						process.exit(1);
					}
				} else {
					console.log("Slack plugin commands:");
					console.log(
						"  wopr slack claim <code>  - Claim a pairing code to approve your Slack account",
					);
					process.exit(subcommand ? 1 : 0);
				}
			},
		},
	],

	async init(context: WOPRPluginContext) {
		ctx = context;
		ctx.registerConfigSchema("wopr-plugin-slack", configSchema);

		// Register as a channel provider so other plugins can add commands/parsers
		ctx.registerChannelProvider(slackChannelProvider);
		logger.info("Registered Slack channel provider");

		// Register the Slack extension so other plugins can interact with Slack
		ctx.registerExtension("slack", slackExtension);
		logger.info("Registered Slack extension");

		// Load agent identity
		await refreshIdentity();

		// Get config - config is stored directly on the plugin, not nested under channels
		const fullConfig = ctx.getConfig<{ channels?: { slack?: SlackConfig } }>();
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
		if (!config.clientId && process.env.SLACK_CLIENT_ID) {
			config = { ...config, clientId: process.env.SLACK_CLIENT_ID };
		}
		if (!config.clientSecret && process.env.SLACK_CLIENT_SECRET) {
			config = { ...config, clientSecret: process.env.SLACK_CLIENT_SECRET };
		}
		if (!config.stateSecret && process.env.SLACK_STATE_SECRET) {
			config = { ...config, stateSecret: process.env.SLACK_STATE_SECRET };
		}

		// Load retry config — the WebUI schema exposes flat fields (retryMaxRetries,
		// retryBaseDelay, retryMaxDelay) while SlackConfig types them as a nested
		// `retry` object. Merge both so either config source works.
		const rawConfig = config as Record<string, unknown>;
		const flatRetry: RetryConfig = {
			...(rawConfig.retryMaxRetries != null && {
				maxRetries: Number(rawConfig.retryMaxRetries),
			}),
			...(rawConfig.retryBaseDelay != null && {
				baseDelay: Number(rawConfig.retryBaseDelay),
			}),
			...(rawConfig.retryMaxDelay != null && {
				maxDelay: Number(rawConfig.retryMaxDelay),
			}),
		};
		retryConfig = { ...flatRetry, ...config.retry };

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
			const authTest = await withRetry(
				() => app!.client.auth.test(),
				retryOpts("auth.test"),
			);
			const botUserId = authTest.user_id;
			botUsername = (authTest.user as string) || "";
			storedBotToken = config.botToken || "";

			// Message handler
			app.message(async ({ message, context, say }) => {
				const hasText = "text" in message && !!message.text;
				const hasFiles =
					"files" in message &&
					Array.isArray((message as any).files) &&
					(message as any).files.length > 0;

				// Skip messages with neither text nor files
				if (!hasText && !hasFiles) return;

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

			// Register slash commands
			registerSlashCommands(app, () => ctx);

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
		stopAllTyping();
		if (cleanupTimer) {
			clearInterval(cleanupTimer);
			cleanupTimer = null;
		}
		if (ctx) {
			ctx.unregisterChannelProvider("slack");
			ctx.unregisterExtension("slack");
		}
		if (app) {
			await app.stop();
			logger.info("Slack plugin stopped");
		}
	},
};

export default plugin;
