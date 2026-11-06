import { generateText, Output } from "ai";
import { outputTokenBudget } from "@/lib/reasoning";
import { z } from "zod";
import { appConfig } from "@/app.config";
import { recordGenerateTextUsage } from "@/lib/record-usage";
import {
  SKILL_DISPLAY_NAME_MAX,
  ensureSkillDisplayNameEmoji,
  sanitizeSkillDisplayName,
} from "@/lib/skill-display-name";
import {
  SKILL_DESCRIPTION_MAX,
  SKILL_NAME_MAX,
  parseSkillDocument,
  toSkillDocument,
} from "@/lib/skill-document";

const instructionModel = appConfig.models.instructions;
const instructionReasoning = appConfig.models.reasoning.instructions;
const instructionMaxOutputTokens = outputTokenBudget(instructionReasoning, 2500);

export type InstructionKind = "overlay" | "skill";

export type GeneratedInstructions = {
  markdown: string;
  name?: string;
  slug?: string;
  description?: string;
};

const skillContentSchema = z.object({
  description: z
    .string()
    .min(1)
    .max(SKILL_DESCRIPTION_MAX)
    .describe("What the skill does and when to use it, with concrete trigger phrases."),
  markdown: z
    .string()
    .min(1)
    .describe("Skill body only. No YAML frontmatter."),
});

const skillCreateOutputSchema = skillContentSchema.extend({
  name: z
    .string()
    .min(1)
    .max(SKILL_DISPLAY_NAME_MAX)
    .describe(
      "Chip label: one leading emoji plus at most three words. Example: 👋 Client intake",
    ),
  slug: z
    .string()
    .min(1)
    .max(SKILL_NAME_MAX)
    .describe("Lowercase letters, numbers, and single hyphens. No leading, trailing, or consecutive hyphens."),
});

function lockedSkillIdentity(skillName?: string, skillSlug?: string): {
  name: string;
  slug: string;
} | undefined {
  const name = skillName?.trim() ?? "";
  const slug = skillSlug?.trim() ?? "";
  return name && slug ? { name, slug } : undefined;
}

function stripFences(value: string): string {
  return value
    .trim()
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function overlaySystemPrompt(): string {
  return [
    "You write user-specific overlay instructions for a general-purpose AI agent.",
    "These are eve system-role instructions: short, stable standing rules added on every turn.",
    "Output only Markdown. No code fences, no commentary, no YAML front matter.",
    "Do not restate the agent's identity or persona. Do not write long procedures — those belong in skills.",
    "Capture working style, tone, audience, and process preferences as bullets and explicit do/don't rules.",
    "Write in second person to the agent. Never include secrets or credentials.",
    "If current instructions exist, revise them to include the user's request. Keep useful existing rules.",
    "If they are empty, write a complete overlay from the request using those best practices.",
  ].join(" ");
}

function skillBodyGuidance(): string[] {
  return [
    "description must say what the skill does AND when to use it, with specific trigger phrases, max 1024 characters.",
    "markdown is the skill body only — no YAML front matter, no code fences, no commentary.",
    "Keep the body one coherent procedure. Use a short title heading, then numbered steps the agent can follow.",
    "Always include a ## Quick start section: if the user invoked this skill with /slug and no extra context, ask 2–4 focused questions and guide the session.",
    "Add a short gotchas section only when it prevents a real mistake. Name tools when a step should call one.",
    "Write in second person to the agent. Prefer checklists over prose. Omit what the agent already knows.",
  ];
}

function skillCreateSystemPrompt(): string {
  return [
    "You write reusable Agent Skills for a general-purpose AI agent.",
    "Follow the Agent Skills SKILL.md convention: slug (the skill name), description, and a concise procedure body.",
    "slug must be lowercase letters, numbers, and single hyphens, max 64 characters.",
    "name is the chip label shown in the UI: start with one relevant emoji, then at most three short words. Example: 👋 Client intake.",
    ...skillBodyGuidance(),
    "Write a complete skill from the request.",
  ].join(" ");
}

function skillUpdateSystemPrompt(): string {
  return [
    "You revise an existing Agent Skill for a general-purpose AI agent.",
    "Change only the description and the procedure body.",
    "Do not change the skill display name or slug. Ignore any request to rename the skill or change its ID.",
    ...skillBodyGuidance(),
    "Revise the current instructions to include the user's request. Keep useful existing rules.",
  ].join(" ");
}

function requestParts({
  current,
  prompt,
  skillDescription,
  skillName,
  skillSlug,
}: {
  current?: string;
  prompt: string;
  skillDescription?: string;
  skillName?: string;
  skillSlug?: string;
}): string {
  return [
    skillName ? `Skill display name: ${skillName}` : null,
    skillSlug ? `Skill slug: ${skillSlug}` : null,
    skillName && skillSlug
      ? "The display name and slug are fixed. Revise only the description and markdown."
      : null,
    skillDescription ? `Skill description: ${skillDescription}` : null,
    current?.trim()
      ? `Current Markdown:\n${parseSkillDocument(current).body}`
      : "Current Markdown: (empty)",
    `User request:\n${prompt.trim()}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function generateInstructionMarkdown({
  current,
  kind,
  prompt,
  skillDescription,
  skillName,
  skillSlug,
}: {
  current?: string;
  kind: InstructionKind;
  prompt: string;
  skillDescription?: string;
  skillName?: string;
  skillSlug?: string;
}): Promise<GeneratedInstructions> {
  const request = requestParts({ current, prompt, skillDescription, skillName, skillSlug });

  if (kind === "skill") {
    const identity = lockedSkillIdentity(skillName, skillSlug);
    if (identity) {
      const result = await generateText({
        maxOutputTokens: instructionMaxOutputTokens,
        model: instructionModel,
        output: Output.object({
          description: "Revised Agent Skill description and procedure body. Do not include name or slug.",
          name: "skill",
          schema: skillContentSchema,
        }),
        prompt: request,
        reasoning: instructionReasoning,
        system: skillUpdateSystemPrompt(),
      });
      void recordGenerateTextUsage("instructions", instructionModel, result);
      const document = toSkillDocument(
        {
          description: result.output.description,
          markdown: result.output.markdown,
          slug: identity.slug,
        },
        { loose: true },
      );
      return {
        description: document.description,
        markdown: document.body,
        name: identity.name,
        slug: identity.slug,
      };
    }

    const result = await generateText({
      maxOutputTokens: instructionMaxOutputTokens,
      model: instructionModel,
      output: Output.object({
        description: "An Agent Skills SKILL.md: name, routing description, and procedure body.",
        name: "skill",
        schema: skillCreateOutputSchema,
      }),
      prompt: request,
      reasoning: instructionReasoning,
      system: skillCreateSystemPrompt(),
    });
    void recordGenerateTextUsage("instructions", instructionModel, result);
    const document = toSkillDocument(
      {
        description: result.output.description,
        markdown: result.output.markdown,
        slug: result.output.slug,
      },
      { loose: true },
    );
    return {
      description: document.description,
      markdown: document.body,
      name: sanitizeSkillDisplayName(
        ensureSkillDisplayNameEmoji(result.output.name),
        document.name,
      ),
      slug: document.name,
    };
  }

  const result = await generateText({
    maxOutputTokens: instructionMaxOutputTokens,
    model: instructionModel,
    prompt: request,
    reasoning: instructionReasoning,
    system: overlaySystemPrompt(),
  });
  void recordGenerateTextUsage("instructions", instructionModel, result);

  return {
    markdown: parseSkillDocument(stripFences(result.text)).body,
  };
}
