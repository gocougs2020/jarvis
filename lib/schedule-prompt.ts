import { SKILL_NAME_PATTERN } from "@/lib/skill-document";
import { canonicalSkillSlug, skillMention, skillOnlySlug } from "@/lib/skill-mention";

export const SCHEDULE_BRIEF_MAX = 1500;
export const SCHEDULE_UNATTENDED = "Run now. Do not ask questions.";

const LEADING_SKILL_PATTERN = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)\b/i;

export type SchedulePromptParts = {
  brief: string;
  skill?: string;
};

export function schedulePreviewText(prompt: string): string {
  const { brief, skill } = parseSchedulePrompt(prompt);
  const text = brief.replace(/\s+/g, " ").trim() || "Scheduled run";
  return skill ? `/${skill} · ${text}` : text;
}

export function parseSchedulePrompt(prompt: string): SchedulePromptParts {
  const trimmed = prompt.trim();
  const match = trimmed.match(LEADING_SKILL_PATTERN);
  if (!match?.[1]) {
    return { brief: stripUnattendedLine(trimmed) };
  }
  return {
    skill: canonicalSkillSlug(match[1].toLowerCase()),
    brief: stripUnattendedLine(trimmed.slice(match[0].length).trim()),
  };
}

export function composeSchedulePrompt(input: {
  brief: string;
  skill?: string | null;
}): string {
  const fromBrief = parseSchedulePrompt(input.brief);
  const skill = normalizeSkillSlug(input.skill) ?? fromBrief.skill;
  const brief = fromBrief.brief.trim();
  if (!brief) {
    throw new Error(
      "Add this-run facts to the brief (who, what, which file, deadline). A schedule cannot be only a skill mention.",
    );
  }
  if (looksLikeSkillBody(brief)) {
    throw new Error(
      "Put the procedure in a skill. The schedule brief should only have this-run facts.",
    );
  }
  if (skill && !SKILL_NAME_PATTERN.test(skill)) {
    throw new Error("Use a skill slug like weekly-review.");
  }
  return skill
    ? `${skillMention(skill)}\n\n${SCHEDULE_UNATTENDED}\n\n${brief}`
    : `${SCHEDULE_UNATTENDED}\n\n${brief}`;
}

export function normalizeSchedulePrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) {
    throw new Error("Schedule prompt is required.");
  }
  const slug = skillOnlySlug(trimmed);
  if (slug) {
    throw new Error(
      "Add this-run facts to the brief (who, what, which file, deadline). A schedule cannot be only a skill mention.",
    );
  }
  const parsed = parseSchedulePrompt(trimmed);
  return composeSchedulePrompt(parsed);
}

export const REMIND_SKILL_SLUG = "remind";

/**
 * A `/remind` follow-through job for work that could not start right away
 * (for example an emailed request when the session start timed out). At fire
 * time the agent checks prior sessions first, so a request that did start
 * after all is not done twice.
 */
export function remindFollowThroughPrompt(brief: string): string {
  return `${skillMention(REMIND_SKILL_SLUG)}\n\n${SCHEDULE_UNATTENDED}\n\n${brief.trim()}`;
}

export function isNudgeReminderSchedule(prompt: string): boolean {
  return !parseSchedulePrompt(prompt).skill;
}

export function isRemindDoSchedule(prompt: string): boolean {
  return parseSchedulePrompt(prompt).skill === REMIND_SKILL_SLUG;
}

export function isReminderSchedule(prompt: string): boolean {
  return isNudgeReminderSchedule(prompt) || isRemindDoSchedule(prompt);
}

export function scheduleSessionUrl(chatId: string, origin: string): string {
  return `${origin.replace(/\/$/, "")}/s/${chatId}`;
}

function reminderSessionLink(options?: { chatId?: string; origin?: string }): string | null {
  if (options?.chatId && options.origin) {
    return scheduleSessionUrl(options.chatId, options.origin);
  }
  return options?.chatId ? `/s/${options.chatId}` : null;
}

export function scheduleDispatchMessage(
  job: { id: string; prompt: string },
  options?: { chatId?: string; context?: string; origin?: string },
): string {
  const link = reminderSessionLink(options);
  const emailLines = [
    "Omit `to` on send_email so it goes to the signed-in user's account email. It is sent from their agent address.",
    "Do not email anyone else. Do not ask questions.",
    link
      ? `Include this session link in the email so they can continue: ${link}`
      : "Include a link to this chat session in the email.",
  ];
  if (isNudgeReminderSchedule(job.prompt)) {
    const context = options?.context?.trim();
    return [
      `Personal reminder job ${job.id}.`,
      "This is an unattended nudge. Write a short reminder in this chat, then call send_email.",
      "Do not try to complete a physical task. Do not search sessions or files for more context.",
      context
        ? `These snippets already passed a tight embedding match. Include only these as optional context in the email. Do not invent related notes.\n\n${context}`
        : "No prior session or file cleared the reminder match floor. Do not invent related notes.",
      ...emailLines,
      job.prompt,
    ].join("\n\n");
  }
  if (isRemindDoSchedule(job.prompt)) {
    return [
      `Personal follow-through job ${job.id}.`,
      "This is an unattended /remind run. Load /remind, search prior sessions and files for this brief, and finish the work only if it is not already done.",
      "Then call send_email with a short status.",
      ...emailLines,
      job.prompt,
    ].join("\n\n");
  }
  return [
    `Run scheduled job ${job.id} for this user.`,
    "This is an unattended scheduled run. Load any /skill named in the brief, follow that skill, and complete the work. Do not ask questions.",
    job.prompt,
  ].join("\n\n");
}

function normalizeSkillSlug(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return canonicalSkillSlug(trimmed.replace(/^\//, "").toLowerCase());
}

function stripUnattendedLine(text: string): string {
  return text
    .replace(new RegExp(`^${escapeRegExp(SCHEDULE_UNATTENDED)}\\s*`, "i"), "")
    .replace(new RegExp(`\\n{2,}${escapeRegExp(SCHEDULE_UNATTENDED)}\\s*`, "i"), "\n\n")
    .trim();
}

function looksLikeSkillBody(text: string): boolean {
  return /^---\s*\n/.test(text) || /^##\s+Quick start\b/im.test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
