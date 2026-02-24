/**
 * Message Handler
 *
 * Core message processing: shouldRespond logic, handleMessage orchestration,
 * and streaming message update/finalize helpers.
 */

import type { App } from "@slack/bolt";
import type { Logger } from "winston";
import { type SlackFile, saveAttachments } from "./attachments.js";
import { getEffectiveSessionKey, incrementMessageCount } from "./commands.js";
import {
	approveUser,
	buildPairingMessage,
	checkRequestRateLimit,
	claimPairingCode,
	createPairingRequest,
	isUserAllowed,
} from "./pairing.js";
import { withRetry } from "./retry.js";
import type {
	AgentIdentity,
	SlackConfig,
	StreamMessage,
	WOPRPluginContext,
} from "./types.js";
import { startTyping, stopTyping } from "./typing.js";

// Constants
/** Maximum characters Slack accepts per message (chat.update / chat.postMessage) */
export const SLACK_LIMIT = 4000;
const EDIT_THRESHOLD = 1500;
const IDLE_SPLIT_MS = 1000;

/** Track active streaming sessions */
export interface StreamState {
	channelId: string;
	threadTs?: string;
	messageTs: string;
	buffer: string;
	lastEdit: number;
	isFinalized: boolean;
}

export const activeStreams = new Map<string, StreamState>();

/** Dependencies injected from index.ts */
export interface MessageHandlerDeps {
	getApp: () => App | null;
	getCtx: () => WOPRPluginContext | null;
	getStoredBotToken: () => string;
	retryOpts: (label: string) => Record<string, unknown>;
	logger: Logger;
	agentIdentity: AgentIdentity;
}

/**
 * Update a Slack message with new content
 */
async function updateMessage(
	state: StreamState,
	content: string,
	deps: MessageHandlerDeps,
): Promise<void> {
	const app = deps.getApp();
	if (!app || state.isFinalized) return;

	let text = content;
	if (text.length > SLACK_LIMIT) {
		text = `${text.substring(0, SLACK_LIMIT - 3)}...`;
	}

	try {
		await withRetry(
			() =>
				app.client.chat.update({
					channel: state.channelId,
					ts: state.messageTs,
					text,
				}),
			deps.retryOpts("chat.update:stream"),
		);
		state.lastEdit = Date.now();
	} catch (e) {
		deps.logger.warn({ msg: "Failed to update message", error: String(e) });
	}
}

/**
 * Finalize a Slack message
 */
async function finalizeMessage(
	state: StreamState,
	content: string,
	deps: MessageHandlerDeps,
): Promise<void> {
	const app = deps.getApp();
	if (!app || state.isFinalized) return;
	state.isFinalized = true;

	let text = content;
	if (text.length > SLACK_LIMIT) {
		text = `${text.substring(0, SLACK_LIMIT - 3)}...`;
	}

	try {
		await withRetry(
			() =>
				app.client.chat.update({
					channel: state.channelId,
					ts: state.messageTs,
					text,
				}),
			deps.retryOpts("chat.update:finalize"),
		);
	} catch (e) {
		deps.logger.warn({ msg: "Failed to finalize message", error: String(e) });
	}
}

/**
 * Get the reaction emoji (from identity or default)
 */
function getAckReaction(
	config: SlackConfig,
	agentIdentity: AgentIdentity,
): string {
	return config.ackReaction?.trim() || agentIdentity.emoji?.trim() || "👀";
}

/**
 * Determine if we should respond to this message
 */
export async function shouldRespond(
	message: any,
	context: any,
	config: SlackConfig,
	deps: MessageHandlerDeps,
): Promise<boolean> {
	const { getApp, getCtx, retryOpts, logger } = deps;
	const app = getApp();
	const ctx = getCtx();

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
			const { request, error } = claimPairingCode(
				trimmed,
				message.user,
				message.user,
			);
			if (request && ctx) {
				try {
					await approveUser(ctx, request.slackUserId);
					logger.info({ msg: "Pairing claimed via DM", user: message.user });
					(message as any).__pairingApproved = true;
					return true;
				} catch (e) {
					logger.error({
						msg: "Failed to approve user after pairing claim",
						user: message.user,
						error: String(e),
					});
					return false;
				}
			}
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

		logger.info({ msg: "Pairing code issued", user: message.user, code });

		try {
			await withRetry(
				// biome-ignore lint/style/noNonNullAssertion: app is checked non-null above via getApp()
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

	if (channelConfig.requireMention) {
		return message.text?.includes(`<@${context.botUserId}>`) || false;
	}

	return true;
}

/**
 * Handle incoming Slack message
 */
export async function handleMessage(
	message: any,
	context: any,
	say: any,
	config: SlackConfig,
	deps: MessageHandlerDeps,
) {
	const {
		getApp,
		getCtx,
		getStoredBotToken,
		retryOpts,
		logger,
		agentIdentity,
	} = deps;
	const app = getApp();
	const ctx = getCtx();

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
	if (!(await shouldRespond(message, context, config, deps))) {
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
		} catch (_e) {}
		return;
	}

	// If user was just approved via pairing, send confirmation and return early
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
	const ackEmoji = getAckReaction(config, agentIdentity);
	try {
		await withRetry(
			// biome-ignore lint/style/noNonNullAssertion: app non-null guaranteed by handleMessage entry guard
			() =>
				app!.client.reactions.add({
					channel: context.channel,
					timestamp: message.ts,
					name: ackEmoji.replace(/:/g, ""),
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

	const streamState: StreamState = {
		channelId: context.channel,
		threadTs: shouldThread ? message.thread_ts || message.ts : undefined,
		messageTs: "",
		buffer: "",
		lastEdit: 0,
		isFinalized: false,
	};

	activeStreams.set(sessionKey, streamState);

	try {
		const initialResponse = await say({
			text: "_Thinking..._",
			thread_ts: streamState.threadTs,
		});

		streamState.messageTs = initialResponse.ts;

		startTyping(sessionKey, context.channel, streamState.messageTs, {
			// biome-ignore lint/style/noNonNullAssertion: app non-null guaranteed by handleMessage entry guard
			chatUpdate: (params) => app!.client.chat.update(params),
			retryOpts: retryOpts("chat.update:typing"),
			logger,
		});

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

			stopTyping(sessionKey);

			buffer += textContent;
			const now = Date.now();

			if (now - lastFlush > IDLE_SPLIT_MS && buffer.length > 0) {
				await updateMessage(streamState, buffer, deps);
				buffer = "";
			}

			lastFlush = now;

			if (buffer.length >= EDIT_THRESHOLD) {
				await updateMessage(streamState, buffer, deps);
			}

			if (finalizeTimer) clearTimeout(finalizeTimer);
			finalizeTimer = setTimeout(async () => {
				if (buffer.length > 0 && !streamState.isFinalized) {
					await finalizeMessage(streamState, buffer, deps);
				}
			}, 2000);
		};

		// Handle file attachments
		let messageContent: string = message.text || "";
		const effectiveBotToken = context.botToken || getStoredBotToken();
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
				logger,
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

		if (!messageContent.trim()) {
			logger.warn({
				msg: "Skipping inject — message content is empty after attachment handling",
				user: message.user,
				channel: context.channel,
			});
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

		const response = await ctx.inject(sessionKey, messageContent, {
			from: message.user,
			channel: { type: "slack", id: context.channel },
			onStream: handleChunk,
		});

		stopTyping(sessionKey);
		if (finalizeTimer) clearTimeout(finalizeTimer);
		if (!streamState.isFinalized) {
			const finalText = buffer || response;
			await finalizeMessage(streamState, finalText, deps);
		}

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
		} catch (_e) {}
	} catch (error: any) {
		stopTyping(sessionKey);
		logger.error({ msg: "Inject failed", error: String(error) });

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
		} catch (_e) {}

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
		} catch (_e) {}
	} finally {
		activeStreams.delete(sessionKey);
	}
}
