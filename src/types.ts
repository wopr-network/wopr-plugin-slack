/**
 * Type definitions for WOPR Slack Plugin
 *
 * Shared types are re-exported from @wopr-network/plugin-types.
 * Plugin-specific types are defined locally below.
 */

// Re-export shared types used by this plugin
export type {
	AgentIdentity,
	ChannelCommand,
	ChannelCommandContext,
	ChannelMessageContext,
	ChannelMessageParser,
	ChannelProvider,
	ChannelRef,
	ConfigField,
	ConfigSchema,
	PluginCommand,
	PluginLogger,
	PluginManifest,
	StreamMessage,
	UserProfile,
	WOPRPlugin,
	WOPRPluginContext,
} from "@wopr-network/plugin-types";

// ---------------------------------------------------------------------------
// Plugin-specific types (not in the shared package)
// ---------------------------------------------------------------------------

export interface ProviderInfo {
	id: string;
	name: string;
	supportedModels?: string[];
}

// Retry configuration
export interface RetryConfig {
	maxRetries?: number; // Default: 3
	baseDelay?: number; // Default: 1000ms
	maxDelay?: number; // Default: 30000ms
}

// Slack-specific types
export interface SlackConfig {
	enabled?: boolean;
	mode?: "socket" | "http";
	botToken?: string;
	appToken?: string; // Required for socket mode
	signingSecret?: string; // Required for HTTP mode
	webhookPath?: string; // For HTTP mode (default: /slack/events)

	// OAuth / token rotation (for granular permissions with 90-day token expiry)
	clientId?: string;
	clientSecret?: string;
	stateSecret?: string;

	// DM settings
	dm?: {
		enabled?: boolean;
		policy?: "pairing" | "open" | "closed";
		allowFrom?: string[];
	};

	// Channel settings
	groupPolicy?: "allowlist" | "open" | "disabled";
	channels?: Record<
		string,
		{
			allow?: boolean;
			requireMention?: boolean;
			enabled?: boolean;
		}
	>;

	// Reaction settings
	ackReaction?: string;
	removeAckAfterReply?: boolean;

	// Threading
	replyToMode?: "off" | "first" | "all";

	// Retry settings
	retry?: RetryConfig;
}
