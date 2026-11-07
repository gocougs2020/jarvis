/**
 * Deployer configuration.
 *
 * These are the defaults every deployment starts from. Two ways to change them:
 *
 * 1. Without touching code (recommended for forks and for running several
 *    deployments from one repo): set `NEXT_PUBLIC_APP_CONFIG` to a JSON object
 *    with only the keys you want to change, for example
 *    `{"brand":{"name":"Friday"},"theme":{"brandColor":"#2f629f"}}`.
 *    `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_TAGLINE`, and
 *    `NEXT_PUBLIC_BRAND_COLOR` are shortcuts for the common ones. Unknown keys
 *    and wrong types fail the build. See `lib/config-overrides.ts`.
 * 2. Edit this file, then restart `npm run dev` or redeploy.
 *
 * Secrets, host URLs, and access allowlists stay in `.env.local` / Vercel env —
 * this file (and `NEXT_PUBLIC_APP_CONFIG`) is for product defaults that ship
 * with the UI and are visible in the browser. Never put emails or domains here.
 *
 * See README.md for install, environment variables, and deployment.
 */

import {
  applyConfigOverrides,
  REASONING_EFFORTS,
  SANDBOX_NETWORK_MODES,
  TRIAGE_ACTIONS,
  TRIAGE_TONES,
} from "./lib/config-overrides";

export type AppSkillConfig = {
  /** When false, the skill is hidden from the home page and Settings, and the agent is told not to load it. */
  enabled: boolean;
  /** When true, show a suggestion chip on the home page. */
  suggest: boolean;
  title: string;
  emoji: string;
};

/** AI SDK reasoning levels. Which ones a model honors depends on the provider. */
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/**
 * Color tokens from `app/globals.css`. Values are any CSS color
 * (`#2f629f`, `oklch(0.55 0.15 250)`, `rgb(47 98 159)`).
 */
export type ThemeToken =
  | "background"
  | "foreground"
  | "card"
  | "card-foreground"
  | "popover"
  | "popover-foreground"
  | "primary"
  | "primary-foreground"
  | "secondary"
  | "secondary-foreground"
  | "muted"
  | "muted-foreground"
  | "accent"
  | "accent-foreground"
  | "destructive"
  | "border"
  | "input"
  | "ring";

export type AppConfig = {
  brand: {
    name: string;
    tagline: string;
  };
  /**
   * Look and feel. The defaults are the neutral palette in `app/globals.css`;
   * anything set here is layered on top at render time, so a deployment can
   * rebrand without a code change.
   */
  theme: {
    /**
     * One brand color for primary buttons, the send button, and focus rings,
     * in light and dark mode. `null` keeps the neutral default.
     */
    brandColor: string | null;
    /** Text and icons on `brandColor`. Pick one with at least 4.5:1 contrast. */
    brandForeground: string;
    /** Corner radius for cards, inputs, and buttons, e.g. `"0.5rem"`. `null` keeps the default (0.625rem). */
    radius: string | null;
    /** Per-token overrides for light mode. Applied after `brandColor`. */
    light: Partial<Record<ThemeToken, string>>;
    /** Per-token overrides for dark mode. Applied after `brandColor`. */
    dark: Partial<Record<ThemeToken, string>>;
    /** Browser toolbar / installed-app title bar color. Match `--background`. */
    browserColor: { light: string; dark: string };
    /** Home-screen and favicon icon colors. */
    icon: { background: string; foreground: string };
  };
  home: {
    promptPlaceholder: string;
    followUpPlaceholder: string;
  };
  /**
   * Instant first reply. Before an agent session starts, one fast model call
   * reads the first prompt and either answers it directly (greetings, the
   * date, simple facts) or hands it to the agent with a one-line
   * acknowledgment and a model route, so text shows up right away and the
   * agent skips its own routing call.
   */
  quickReply: {
    /** When false, every prompt goes straight to the agent. */
    enabled: boolean;
    /** Give up waiting for the answer-or-hand-off decision after this long and start the agent. */
    decisionTimeoutMs: number;
    /** Cap on a direct answer. Longer work belongs to the agent. */
    maxAnswerTokens: number;
  };
  /**
   * Resend Inboxes (https://resend.com/docs/dashboard/inboxes/introduction).
   * Turn on a hosted inbox for the agent address (`RESEND_FROM_EMAIL`) from
   * Settings. Resend then stores threads, labels, and drafts, its built-in
   * inbox agent triages new mail, and the agent works the inbox with the
   * `inbox_*` tools. Nothing is created until you turn it on. Needs a
   * receiving domain (see README).
   */
  resendInbox: {
    /** When false, Settings hides the option and the `inbox_*` tools report it is off. */
    enabled: boolean;
    /**
     * Instructions for Resend's inbox agent, which acts on each new email.
     * It never sends: replies are saved as drafts for review. Empty turns it off.
     */
    triageInstructions: string;
    /** What Resend's inbox agent may do. It never sends mail on its own. */
    triageActions: readonly (typeof TRIAGE_ACTIONS)[number][];
    triageTone: (typeof TRIAGE_TONES)[number];
  };
  models: {
    /** Chat model for simple first prompts; also first-prompt routing, email triage, and web search. */
    chatFast: string;
    /** Instant first reply (`quickReply`). Pick a low-latency model. */
    quickReply: string;
    /** Chat model when the first prompt needs analysis or thinking. */
    chatLow: string;
    /** Chat model when the first prompt is unusually complex. */
    chatHigh: string;
    instructions: string;
    sessionTitle: string;
    sessionMemory: string;
    /** Model used only for compaction checkpoints (provider-default reasoning; eve has no setting for it here). */
    compaction: string;
    embeddings: string;
    imageGeneration: string;
    /** AI Gateway transcription model for voice input (same credentials as chat). */
    transcription: string;
    /** AI Gateway speech (text-to-speech) model for spoken replies in voice mode. */
    speech: string;
    contextWindows: Readonly<Record<string, number>>;
    /** Reasoning effort per feature. Chat routes are locked per session with their model. */
    reasoning: {
      /** `fast` chat route. */
      chatFast: ReasoningEffort;
      /** `reason` chat route. */
      chatLow: ReasoningEffort;
      /** `complex` chat route. */
      chatHigh: ReasoningEffort;
      /** First-prompt route classification (runs on `chatFast`). */
      routing: ReasoningEffort;
      /** Instant first reply. Keep it at `none` or `minimal`: reasoning delays the first token. */
      quickReply: ReasoningEffort;
      /** Inbound email action-item classification (runs on `chatFast`). */
      emailClassification: ReasoningEffort;
      /** `web_search` query call (runs on `chatFast`). */
      webSearch: ReasoningEffort;
      sessionTitle: ReasoningEffort;
      /** HyDE draft for related-session recall. Keep `memory.hydeTimeoutMs` long enough for it. */
      sessionMemory: ReasoningEffort;
      /** Instruction overlays, custom skills, and schedules. */
      instructions: ReasoningEffort;
    };
  };
  memory: {
    relatedSessionLimit: number;
    relatedSessionMinScore: number;
    /** Abort HyDE (hypothetical reply) if it exceeds this; recall continues with the prompt embedding. */
    hydeTimeoutMs: number;
    /** Cosine floor for nudge-email context. Higher than related-session recall on purpose. */
    reminderContextMinScore: number;
    /** Extra floor for body-only hits (session prompt or file content). */
    reminderContextBodyMinScore: number;
    /** Max characters of a matched snippet in the nudge email. */
    reminderContextSnippetChars: number;
  };
  skills: Record<string, AppSkillConfig>;
  security: {
    /**
     * Outbound network for the agent's sandbox (the `bash` tool).
     * `"deny-all"` (default) blocks egress, so text injected through an email,
     * web page, or shared file cannot make the sandbox send your data out with
     * curl. Web access still works through the `web_search` and `web_fetch`
     * tools, which run in the app. Use `"allow-all"`, or a hostname list such as
     * `["pypi.org", "files.pythonhosted.org"]`, if your skills need packages or
     * APIs from inside the sandbox. Docker (local) only supports allow-all or
     * deny-all, so a hostname list means deny-all there.
     */
    sandboxNetwork: (typeof SANDBOX_NETWORK_MODES)[number] | readonly string[];
    /**
     * Mail to the agent address starts an unattended session only when it
     * comes from an account's own email. The address is not secret and From
     * is easy to forge, so by default the message must also pass DMARC for
     * that domain (per the receiving server's Authentication-Results). Turn
     * this off only if your mail never carries that header, and accept that
     * anyone who forges your From can then run the agent.
     */
    emailSessionsRequireDmarc: boolean;
    /**
     * `send_email` to the signed-in user only (no other recipient, no CC)
     * skips the approval prompt by default, so a research brief, schedule, or
     * emailed request can mail you its result without waiting on a click.
     * Turn this on to approve those too (reminder runs still send unattended).
     * Mail to anyone else always needs approval.
     */
    selfEmailRequiresApproval: boolean;
  };
  voice: {
    /** Voice for `models.speech`. Grok TTS voices: ara, eve, leo, rex, sal. */
    speechVoice: string;
    /** Longer replies are trimmed to this many characters before they are spoken. */
    maxSpeechChars: number;
  };
  setup: {
    /**
     * Signed-in checklist at `/settings/setup`. Set to `false` to hide the
     * page and its nav links. To remove it from the repo, delete
     * `app/settings/setup/` and `components/workspace-setup.tsx`, then drop
     * this block and the Setup links (see README).
     */
    inAppPage: boolean;
  };
};

const defaults = {
  brand: {
    name: "Jarvis",
    tagline: "An opinionated but flexible workspace for quickly building AI agents.",
  },

  theme: {
    brandColor: null,
    brandForeground: "#ffffff",
    radius: null,
    light: {},
    dark: {},
    browserColor: { light: "#f7f7f7", dark: "#171717" },
    icon: { background: "#000000", foreground: "#ffffff" },
  },

  home: {
    promptPlaceholder: "Ask anything…",
    followUpPlaceholder: "Ask a follow-up…",
  },

  quickReply: {
    enabled: true,
    decisionTimeoutMs: 5_000,
    maxAnswerTokens: 1_200,
  },

  resendInbox: {
    enabled: true,
    triageInstructions: [
      "This is a personal assistant's inbox. Label every new thread with exactly one of:",
      "Needs reply (a person is waiting on an answer), Action (a task, deadline, bill, or appointment),",
      "FYI (worth reading, nothing to do), Receipts (orders, invoices, confirmations), or Newsletter (bulk or marketing).",
      "Draft a short reply only for Needs reply threads, and only when the answer is clear from the thread.",
      "Archive Newsletter threads. Mark obvious scams and phishing as spam.",
    ].join(" "),
    triageActions: ["add_labels", "draft_reply", "archive", "mark_as_spam"],
    triageTone: "concise_casual",
  },

  models: {
    chatFast: "openai/gpt-6-luna",
    quickReply: "openai/gpt-6-luna",
    chatLow: "openai/gpt-6-luna",
    chatHigh: "openai/gpt-6.1-sol",
    instructions: "openai/gpt-6-luna",
    sessionTitle: "openai/gpt-6-luna",
    sessionMemory: "openai/gpt-6-luna",
    compaction: "openai/gpt-6-luna",
    embeddings: "openai/text-embedding-3-small",
    imageGeneration: "openai/gpt-image-2",
    transcription: "spacexai/grok-stt",
    speech: "spacexai/grok-tts",
    contextWindows: {
      "openai/gpt-6-luna": 1_050_000,
      "openai/gpt-6.1-sol": 1_050_000,
    },
    reasoning: {
      chatFast: "medium",
      chatLow: "high",
      chatHigh: "medium",
      routing: "low",
      quickReply: "none",
      emailClassification: "medium",
      webSearch: "medium",
      sessionTitle: "low",
      sessionMemory: "low",
      instructions: "high",
    },
  },

  memory: {
    relatedSessionLimit: 8,
    relatedSessionMinScore: 0.55,
    hydeTimeoutMs: 6000,
    reminderContextMinScore: 0.74,
    reminderContextBodyMinScore: 0.78,
    reminderContextSnippetChars: 200,
  },

  /**
   * Built-in skills under `agent/skills/<slug>/SKILL.md`.
   * Set `enabled: false` to hide one. Set `suggest: true` to show it on the home page.
   * Add a new folder under `agent/skills/` and an entry here to register another default.
   */
  skills: {
    brainstorming: {
      enabled: true,
      suggest: true,
      title: "Brainstorm",
      emoji: "💡",
    },
    write: {
      enabled: true,
      suggest: true,
      title: "Write",
      emoji: "✍️",
    },
    research: {
      enabled: true,
      suggest: true,
      title: "Research",
      emoji: "🔍",
    },
    "meeting-prep": {
      enabled: true,
      suggest: true,
      title: "Meeting prep",
      emoji: "📋",
    },
    plan: {
      enabled: true,
      suggest: true,
      title: "Plan",
      emoji: "🗺️",
    },
    image: {
      enabled: true,
      suggest: true,
      title: "Image",
      emoji: "🎨",
    },
    household: {
      enabled: true,
      suggest: true,
      title: "Household",
      emoji: "🏠",
    },
    story: {
      enabled: true,
      suggest: true,
      title: "Story",
      emoji: "📖",
    },
    decide: {
      enabled: true,
      suggest: true,
      title: "Decide",
      emoji: "⚖️",
    },
    "weekly-review": {
      enabled: true,
      suggest: true,
      title: "Weekly review",
      emoji: "📅",
    },
    intake: {
      enabled: true,
      suggest: false,
      title: "Intake",
      emoji: "👋",
    },
    files: {
      enabled: true,
      suggest: false,
      title: "Files",
      emoji: "📄",
    },
    memory: {
      enabled: true,
      suggest: false,
      title: "Memory",
      emoji: "🧠",
    },
    remind: {
      enabled: true,
      suggest: true,
      title: "Remind",
      emoji: "⏰",
    },
  },

  security: {
    sandboxNetwork: "deny-all",
    emailSessionsRequireDmarc: true,
    selfEmailRequiresApproval: false,
  },

  voice: {
    speechVoice: "ara",
    maxSpeechChars: 2_000,
  },

  setup: {
    inAppPage: true,
  },
} as const satisfies AppConfig;

/**
 * The config the app runs with: the defaults above plus this deployment's
 * `NEXT_PUBLIC_*` overrides. Each `process.env` read is spelled out so
 * Next.js can inline it into client bundles.
 */
export const appConfig = applyConfigOverrides(defaults, {
  json: process.env.NEXT_PUBLIC_APP_CONFIG,
  name: process.env.NEXT_PUBLIC_APP_NAME,
  tagline: process.env.NEXT_PUBLIC_APP_TAGLINE,
  brandColor: process.env.NEXT_PUBLIC_BRAND_COLOR,
});
