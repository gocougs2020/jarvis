import { generateText, Output } from "ai";
import { outputTokenBudget } from "@/lib/reasoning";
import { z } from "zod";
import { appConfig } from "@/app.config";
import {
  defaultTimeZone,
  jobCadenceSchema,
  normalizeJobCadence,
  type JobCadence,
} from "@/lib/job-cadence";
import { recordGenerateTextUsage } from "@/lib/record-usage";
import { SCHEDULE_BRIEF_MAX, parseSchedulePrompt } from "@/lib/schedule-prompt";

const scheduleModel = appConfig.models.instructions;
const scheduleReasoning = appConfig.models.reasoning.instructions;

const generatedScheduleSchema = z.object({
  brief: z
    .string()
    .min(1)
    .max(SCHEDULE_BRIEF_MAX)
    .describe(
      "This-run facts only: who, what, which file, deadline. No skill slug, no procedure, no 'Run now' line.",
    ),
  cadence: jobCadenceSchema.describe(
    "Clock-aligned schedule. Use weekdayOfMonth for first/second/third/fourth/last weekday of a month, including every other month.",
  ),
});

export type GeneratedSchedule = {
  brief: string;
  cadence: JobCadence;
};

function scheduleSystemPrompt(allowsSubDaily: boolean): string {
  return [
    "You update a user's scheduled job: the this-run brief and the clock cadence.",
    "brief is this-run facts only. Do not include a skill slug, YAML, a procedure, or the line 'Run now. Do not ask questions.'",
    "If the user only changes timing, keep the current brief. If they change the task, revise the brief and keep useful facts.",
    "cadence must be a valid structured schedule. Prefer the simplest kind that matches the request.",
    allowsSubDaily
      ? "Kinds: once (YYYY-MM-DDTHH:mm wall time), hourly (minute past the hour), daily, weekly (weekdays 0=Sun..6=Sat), monthly (calendar days 1-31), weekdayOfMonth (nth weekday of a month), interval (every N minutes)."
      : "This host only allows jobs that fire at most once a day. Kinds: once (YYYY-MM-DDTHH:mm wall time), daily, weekly (weekdays 0=Sun..6=Sat), monthly (calendar days 1-31), weekdayOfMonth (nth weekday of a month). Do not use hourly. If they ask for an interval, use everyMinutes of 1440 or more, or switch to daily.",
    "Examples: every Tuesday → weekly weekdays [2]. First Tuesday of every month → weekdayOfMonth nth 1 weekday 2 intervalMonths 1. First Tuesday of every other month → weekdayOfMonth nth 1 weekday 2 intervalMonths 2. Last Friday every month → weekdayOfMonth nth -1 weekday 5 intervalMonths 1.",
    "nth is 1, 2, 3, 4, or -1 for last. Omit monthMod; the app fills it.",
    "Keep the current IANA timezone unless the user names a different one. Use 24-hour hour 0-23.",
    "Never invent a new task when they only asked to change when it runs.",
  ].join(" ");
}

export async function generateScheduleUpdate({
  allowsSubDaily = false,
  currentCadence,
  currentPrompt,
  prompt,
  timezone,
}: {
  allowsSubDaily?: boolean;
  currentCadence: JobCadence;
  currentPrompt: string;
  prompt: string;
  timezone?: string;
}): Promise<GeneratedSchedule> {
  const parsed = parseSchedulePrompt(currentPrompt);
  const zone = timezone?.trim() || currentCadence.timezone || defaultTimeZone();
  const result = await generateText({
    maxOutputTokens: outputTokenBudget(scheduleReasoning, 1200),
    model: scheduleModel,
    output: Output.object({
      description: "Updated schedule brief and cadence.",
      name: "schedule",
      schema: generatedScheduleSchema,
    }),
    prompt: [
      `Timezone: ${zone}`,
      parsed.skill ? `Existing skill slug (do not put this in brief): ${parsed.skill}` : null,
      `Current brief:\n${parsed.brief || "(empty)"}`,
      `Current cadence JSON:\n${JSON.stringify(currentCadence)}`,
      `User request:\n${prompt.trim()}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    reasoning: scheduleReasoning,
    system: scheduleSystemPrompt(allowsSubDaily),
  });
  void recordGenerateTextUsage("instructions", scheduleModel, result);
  const brief = result.output.brief.trim();
  if (!brief) {
    throw new Error("The model returned an empty schedule brief.");
  }
  return {
    brief,
    cadence: normalizeJobCadence({
      ...result.output.cadence,
      timezone: result.output.cadence.timezone || zone,
    }),
  };
}
