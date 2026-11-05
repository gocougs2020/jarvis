import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireEnabledSkillSlug } from "../../lib/available-skills";
import {
  jobCadenceSchema,
  onceCadenceFromInstant,
  scheduleFieldsFromCadence,
} from "../../lib/job-cadence";
import {
  composeSchedulePrompt,
  parseSchedulePrompt,
  REMIND_SKILL_SLUG,
  SCHEDULE_BRIEF_MAX,
} from "../../lib/schedule-prompt";
import { SKILL_NAME_MAX, SKILL_NAME_PATTERN } from "../../lib/skill-document";
import { canonicalSkillSlug } from "../../lib/skill-mention";
import { createJob, listUserSkills } from "../../lib/store";
import {
  cadenceFiresMoreThanOncePerDay,
  resolveHostSchedulePlan,
  SUB_DAILY_SCHEDULE_MESSAGE,
} from "../../lib/vercel-plan";
import { requireUser } from "../lib/identity";

const skillSlugSchema = z
  .string()
  .min(1)
  .max(SKILL_NAME_MAX)
  .transform((value) => canonicalSkillSlug(value.replace(/^\//, "").toLowerCase()))
  .refine((value) => SKILL_NAME_PATTERN.test(value), "Use a skill slug like weekly-review.");

export default defineTool({
  description:
    "Create a one-time or repeating scheduled job. Pass a configured skill plus a short this-run brief — never the skill procedure, and never a bare /slug. For a personal nudge (ping the user), omit skill. For agent follow-through, pass skill remind. Both need cadence once and a date and time — ask if the user did not give one. On Hobby hosts (the default), cadence must be once, daily, weekly, monthly, or weekdayOfMonth — not hourly or an interval under 24 hours.",
  inputSchema: z.object({
    skill: skillSlugSchema
      .optional()
      .describe(
        "Enabled skill to invoke each fire (remind, weekly-review, meeting-prep, or a custom slug). Omit for a personal nudge. Pass remind when the agent should do the work at fire time.",
      ),
    brief: z
      .string()
      .min(1)
      .max(SCHEDULE_BRIEF_MAX)
      .describe(
        "This-run facts only: who, what, which file, deadline, who to email. Do not paste skill steps or SKILL.md.",
      ),
    firstRunAt: z.iso
      .datetime({ offset: true })
      .describe("ISO 8601 datetime with offset, e.g. 2026-11-06T09:00:00-08:00"),
    everyMinutes: z.number().int().min(1).max(525600).nullable().default(null),
    cadence: jobCadenceSchema
      .optional()
      .describe(
        "Clock-aligned repeat: once, hourly, daily, weekly, monthly, weekdayOfMonth (first Tuesday, every other month, …), or interval. Prefer this over everyMinutes for weekdays or monthly days.",
      ),
  }),
  async execute(input, ctx) {
    const user = requireUser(ctx);
    const parsed = parseSchedulePrompt(input.brief);
    const skillSlug = input.skill ?? parsed.skill;
    const skill = skillSlug
      ? requireEnabledSkillSlug(
          skillSlug,
          await listUserSkills(user.userId),
          "Enable or create it first, or omit skill for a one-off reminder.",
        )
      : undefined;
    const prompt = composeSchedulePrompt({
      skill,
      brief: parsed.brief || input.brief,
    });
    // A repeating cadence fires on its own clock, so start from its first
    // occurrence at or after firstRunAt (or now, if firstRunAt has passed).
    const cadenceFrom = new Date(Math.max(Date.now(), Date.parse(input.firstRunAt)));
    const fields = input.cadence
      ? scheduleFieldsFromCadence(input.cadence, new Date(cadenceFrom.getTime() - 1_000))
      : (!skill || skill === REMIND_SKILL_SLUG) && input.everyMinutes == null
        ? scheduleFieldsFromCadence(onceCadenceFromInstant(input.firstRunAt))
        : null;
    const plan = await resolveHostSchedulePlan();
    if (
      !plan.allowsSubDaily &&
      cadenceFiresMoreThanOncePerDay(fields?.cadence ?? input.cadence, fields?.everyMinutes ?? input.everyMinutes)
    ) {
      throw new Error(SUB_DAILY_SCHEDULE_MESSAGE);
    }
    // An interval has no clock to align to: its first run is firstRunAt itself
    // (or now, if that has passed), not one interval after it.
    const firstRunAt =
      fields?.cadence.kind === "interval"
        ? cadenceFrom.toISOString()
        : (fields?.nextRunAt ?? input.firstRunAt);
    return await createJob(user.userId, {
      prompt,
      firstRunAt,
      everyMinutes: fields?.everyMinutes ?? input.everyMinutes,
      cadence: fields?.cadence ?? null,
      authenticator: user.authenticator ?? "better-auth",
      issuer: user.issuer,
      visibility: "private",
    });
  },
});
