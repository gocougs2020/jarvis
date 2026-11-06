"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PencilIcon, PlusIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { InstructionPrompt } from "@/components/instruction-prompt";
import { MarkdownDocumentEditor } from "@/components/markdown-document-editor";
import { InboundMailSettings, type InboundMailInfo } from "@/components/inbound-mail-settings";
import { MemorySettings } from "@/components/memory-settings";
import { ScheduleRow } from "@/components/schedule-row";
import { SkillEditorDialog, type SkillDraft } from "@/components/skill-editor-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BuiltinSkillDoc } from "@/lib/app-config";
import { markdownToSafeHtml } from "@/lib/markdown-document";
import { isInAppSetupEnabled } from "@/lib/in-app-setup";
import { parseSettingsTab, type SettingsTab } from "@/lib/settings-tab";
import { skillDisplayName } from "@/lib/skill-display-name";
import type { ScheduledJob, UserSettings, UserSkill } from "@/lib/types";
import type { HostSchedulePlanInfo } from "@/lib/vercel-plan";
import { cn, fetchJson } from "@/lib/utils";

const SAVE_DEBOUNCE_MS = 500;
const settingsTabTriggerClassName = "flex-none rounded-none border-none px-0 shadow-none";

function isHostSchedulePlan(value: unknown): value is HostSchedulePlanInfo {
  if (!value || typeof value !== "object") return false;
  const info = value as Partial<HostSchedulePlanInfo>;
  return (
    (info.plan === "hobby" || info.plan === "pro") &&
    (info.source === "api" || info.source === "default") &&
    typeof info.allowsSubDaily === "boolean"
  );
}

export function SettingsPanel({
  builtinSkills,
  tab,
}: {
  readonly builtinSkills: readonly BuiltinSkillDoc[];
  readonly tab: SettingsTab;
}) {
  const [activeTab, setActiveTab] = useState(tab);
  const [skills, setSkills] = useState<UserSkill[]>([]);
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [schedulePlan, setSchedulePlan] = useState<HostSchedulePlanInfo>({
    plan: "hobby",
    source: "default",
    allowsSubDaily: false,
  });
  const [inboundMail, setInboundMail] = useState<InboundMailInfo>();
  const [overlay, setOverlay] = useState("");
  const [savedOverlay, setSavedOverlay] = useState("");
  const [overlayPrompt, setOverlayPrompt] = useState("");
  const [showOverlayAi, setShowOverlayAi] = useState(false);
  const [generatingOverlay, setGeneratingOverlay] = useState(false);
  const [overlayError, setOverlayError] = useState<string>();
  const [skillEditorOpen, setSkillEditorOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<UserSkill>();

  const refresh = async () => {
    try {
      const [settingsRes, skillsRes, jobsRes] = await Promise.all([
        fetch("/api/settings").then((response) =>
          response.ok ? response.json() : { settings: undefined },
        ),
        fetch("/api/skills").then((response) => (response.ok ? response.json() : { skills: [] })),
        fetch("/api/jobs").then((response) =>
          response.ok ? response.json() : { jobs: [], schedulePlan: undefined },
        ),
      ]);
      const nextOverlay = settingsRes.settings?.instructionOverlay ?? "";
      setOverlay(nextOverlay);
      setSavedOverlay(nextOverlay);
      if (settingsRes.inboundMail && typeof settingsRes.inboundMail === "object") {
        setInboundMail(settingsRes.inboundMail as InboundMailInfo);
      }
      setSkills(skillsRes.skills ?? []);
      setJobs(jobsRes.jobs ?? []);
      if (isHostSchedulePlan(jobsRes.schedulePlan)) setSchedulePlan(jobsRes.schedulePlan);
    } catch {
      setSkills([]);
      setJobs([]);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync tab from the URL
    setActiveTab(tab);
  }, [tab]);

  useEffect(() => {
    // Fetch settings after mount; setState happens in the async continuation.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- server refresh on mount
    void refresh();
  }, []);

  const saveSettings = async (patch: Partial<UserSettings>) => {
    const response = await fetchJson("/api/settings", "PATCH", patch);
    if (!response.ok) return;
    const payload = (await response.json()) as { settings: UserSettings };
    setSavedOverlay(payload.settings.instructionOverlay);
  };

  useEffect(() => {
    if (overlay === savedOverlay || generatingOverlay) return;
    const handle = window.setTimeout(() => {
      void saveSettings({ instructionOverlay: overlay });
    }, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [generatingOverlay, overlay, savedOverlay]);

  const generateOverlay = async () => {
    const trimmed = overlayPrompt.trim();
    if (!trimmed || generatingOverlay) return;
    setGeneratingOverlay(true);
    setOverlayError(undefined);
    try {
      const response = await fetchJson("/api/instructions/generate", "POST", {
        current: overlay,
        kind: "overlay",
        prompt: trimmed,
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        markdown?: string;
      };
      if (!response.ok || !payload.markdown) {
        throw new Error(payload.error || "Unable to generate instructions.");
      }
      setOverlay(payload.markdown);
      setOverlayPrompt("");
      setShowOverlayAi(false);
    } catch (error) {
      setOverlayError(error instanceof Error ? error.message : "Unable to generate instructions.");
    } finally {
      setGeneratingOverlay(false);
    }
  };

  const openCreateSkill = () => {
    setEditingSkill(undefined);
    setSkillEditorOpen(true);
  };

  const openEditSkill = (skill: UserSkill) => {
    setEditingSkill(skill);
    setSkillEditorOpen(true);
  };

  const saveSkill = async (draft: SkillDraft, skillId?: string) => {
    const response = await fetchJson(
      "/api/skills",
      skillId ? "PATCH" : "POST",
      skillId ? { id: skillId, ...draft } : draft,
    );
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      skill?: UserSkill;
    };
    if (!response.ok || !payload.skill) {
      throw new Error(payload.error || "Unable to save this skill.");
    }
    setEditingSkill(payload.skill);
    await refresh();
    return payload.skill;
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background pb-[env(safe-area-inset-bottom)]">
      <AppHeader />
      <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-8" id="main" tabIndex={-1}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-pretty font-medium text-2xl tracking-tight">Settings</h1>
            <p className="text-muted-foreground text-sm">
              Configure instructions, skills, memory, inbox, schedules, and view connections.
            </p>
          </div>
          {isInAppSetupEnabled() ? (
            <Link
              className="text-muted-foreground text-sm underline hover:text-foreground"
              href="/settings/setup"
              prefetch={false}
            >
              Workspace setup
            </Link>
          ) : null}
        </div>
        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            setActiveTab(parseSettingsTab(value));
          }}
        >
          <TabsList className="h-auto flex-wrap gap-5 p-0" variant="line">
            <TabsTrigger className={settingsTabTriggerClassName} value="instructions">
              Instructions
            </TabsTrigger>
            <TabsTrigger className={settingsTabTriggerClassName} value="skills">
              Skills
            </TabsTrigger>
            <TabsTrigger className={settingsTabTriggerClassName} value="memory">
              Memory
            </TabsTrigger>
            <TabsTrigger className={settingsTabTriggerClassName} value="inbox">
              Inbox
            </TabsTrigger>
            <TabsTrigger className={settingsTabTriggerClassName} value="schedules">
              Schedules
            </TabsTrigger>
            <TabsTrigger className={settingsTabTriggerClassName} value="connections">
              Connections
            </TabsTrigger>
          </TabsList>
          <TabsContent value="instructions">
            <InstructionCard
              description="Standing rules for your sessions. Keep them short — longer procedures belong in skills."
              generating={generatingOverlay}
              placeholder="How should the agent work with you?"
              promptId="instruction-ai-prompt"
              showAi={showOverlayAi}
              title="Your instructions"
              value={overlay}
              overlayPrompt={overlayPrompt}
              overlayError={overlayError}
              onChange={setOverlay}
              onPromptChange={setOverlayPrompt}
              onToggleAi={() => {
                setShowOverlayAi((open) => !open);
                setOverlayError(undefined);
              }}
              onGenerate={() => {
                void generateOverlay();
              }}
            />
          </TabsContent>
          <TabsContent value="memory">
            <MemorySettings active={activeTab === "memory"} />
          </TabsContent>
          <TabsContent value="inbox">
            <InboundMailSettings inboundMail={inboundMail} onChanged={setInboundMail} />
          </TabsContent>
          <TabsContent className="space-y-4" value="skills">
            <Card>
              <CardHeader>
                <CardTitle>Built-in skills</CardTitle>
                <CardDescription>
                  Enabled in <code>app.config.ts</code>. Click a skill to read its procedure.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {builtinSkills.map((skill) => (
                  <BuiltinSkillChip key={skill.slug} skill={skill} />
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="w-3/4 space-y-1.5">
                    <CardTitle>Custom skills</CardTitle>
                    <CardDescription>
                      Skills are procedures for things like tasks, techniques, and processes.
                      They give the agent more context to help it respond more effectively.
                    </CardDescription>
                  </div>
                  <div className="flex w-1/4 justify-end">
                    <Button
                      className="shrink-0"
                      size="sm"
                      type="button"
                      variant={skillEditorOpen ? "secondary" : "outline"}
                      onClick={openCreateSkill}
                    >
                      <PlusIcon />
                      New Skill
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {skills.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No custom skills yet.</p>
                ) : (
                  skills.map((skill) => (
                    <SkillRow
                      key={skill.id}
                      skill={skill}
                      onEdit={() => openEditSkill(skill)}
                      onRefresh={() => void refresh()}
                    />
                  ))
                )}
              </CardContent>
            </Card>
            <SkillEditorDialog
              open={skillEditorOpen}
              skill={editingSkill}
              onOpenChange={setSkillEditorOpen}
              onSave={saveSkill}
            />
          </TabsContent>
          <TabsContent value="connections">
            <Card>
              <CardHeader>
                <CardTitle>Connections</CardTitle>
                <CardDescription>
                  Connections let the agent use outside services — email, calendars, or anything
                  else you wire up. Add or configure connections directly in the app codebase
                  under the <code>agent/connections/</code> directory, then restart or redeploy.
                </CardDescription>
              </CardHeader>
            </Card>
          </TabsContent>
          <TabsContent value="schedules">
            {/* Reminders are one-off jobs that email the user. Later: push
                notifications, and a dedicated reminders page. */}
            <Card>
              <CardHeader>
                <CardTitle>Schedules</CardTitle>
                <CardDescription>
                  Each run opens a session, hidden from Sessions until you include scheduled
                  runs. Ask the agent or use /remind: a nudge emails you (and may attach one
                  prior session or file if a tight match is found), a do-job tries the work
                  first, then the one-off job is deleted. Edit timing — including AI cadences
                  like the first Tuesday of every other month.
                  {schedulePlan.allowsSubDaily
                    ? " This host is on Vercel Pro, so hourly and custom intervals are available."
                    : schedulePlan.plan === "pro"
                      ? " Vercel reports Pro, but this deploy still ticks once a day — redeploy to unlock hourly jobs."
                      : " This host is treated as Vercel Hobby, so jobs may fire at most once a day."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {jobs.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    Ask the agent to create a follow-up or reminder.
                  </p>
                ) : (
                  jobs.map((job) => (
                    <ScheduleRow
                      key={job.id}
                      allowsSubDaily={schedulePlan.allowsSubDaily}
                      job={job}
                      onJobChange={(next) => {
                        setJobs((current) =>
                          current.map((item) => (item.id === next.id ? next : item)),
                        );
                      }}
                      onRefresh={() => void refresh()}
                    />
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function BuiltinSkillChip({ skill }: { readonly skill: BuiltinSkillDoc }) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            badgeVariants({ variant: "secondary" }),
            "h-5 cursor-pointer px-3 py-1 text-[11px] leading-none",
          )}
          type="button"
        >
          {skill.title}
        </button>
      </PopoverTrigger>
      {open ? (
        <PopoverContent
          align="start"
          className="flex max-h-[var(--radix-popover-content-available-height)] w-[min(36rem,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0"
          collisionPadding={16}
        >
          <PopoverHeader className="shrink-0 border-b px-4 py-3">
            <PopoverTitle>{skill.title}</PopoverTitle>
            <PopoverDescription>/{skill.slug}</PopoverDescription>
          </PopoverHeader>
          <div className="min-h-0 overflow-y-auto overscroll-contain">
            {skill.markdown ? (
              <div
                className="markdown-document-editor px-4 py-3 text-sm"
                dangerouslySetInnerHTML={{ __html: markdownToSafeHtml(skill.markdown) }}
              />
            ) : (
              <p className="px-4 py-3 text-muted-foreground text-sm">
                Skill procedure is not available.
              </p>
            )}
          </div>
        </PopoverContent>
      ) : null}
    </Popover>
  );
}

function InstructionCard({
  description,
  generating,
  overlayError,
  overlayPrompt,
  placeholder,
  promptId,
  showAi,
  title,
  value,
  onChange,
  onGenerate,
  onPromptChange,
  onToggleAi,
}: {
  readonly description: string;
  readonly generating: boolean;
  readonly overlayError?: string;
  readonly overlayPrompt: string;
  readonly placeholder: string;
  readonly promptId: string;
  readonly showAi: boolean;
  readonly title: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onGenerate: () => void;
  readonly onPromptChange: (value: string) => void;
  readonly onToggleAi: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5 w-3/4">
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <div className="w-1/4 flex justify-end">
            <Button
              aria-controls={promptId}
              aria-expanded={showAi}
              className="shrink-0"
              size="sm"
              type="button"
              variant={showAi ? "secondary" : "outline"}
              onClick={onToggleAi}
            >
              <SparklesIcon />
              Update with AI
            </Button>
          </div>
        </div>
   
      </CardHeader>
      <CardContent className="space-y-4">
        {showAi ? (
          <div className="space-y-2" id={promptId}>
            <InstructionPrompt
              generating={generating}
              placeholder="Shorter replies, prefer checklists, warmer sign-off…"
              prompt={overlayPrompt}
              onGenerate={onGenerate}
              onPromptChange={onPromptChange}
            />
            {overlayError ? (
              <p className="text-destructive text-sm" role="alert">
                {overlayError}
              </p>
            ) : null}
          </div>
        ) : null}
        <MarkdownDocumentEditor
          disabled={generating}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
        />
      </CardContent>
    </Card>
  );
}

function SkillRow({
  onEdit,
  onRefresh,
  skill,
}: {
  readonly onEdit: () => void;
  readonly onRefresh: () => void;
  readonly skill: UserSkill;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
      <button className="min-w-0 flex-1 rounded-sm text-left" type="button" onClick={onEdit}>
        <p className="font-medium text-sm">{skillDisplayName(skill)}</p>
        <p className="text-muted-foreground text-xs">
          /{skill.slug}
          {skill.description ? ` · ${skill.description}` : ""}
        </p>
      </button>
      <div className="flex items-center gap-2">
        <Button
          aria-label={`Edit ${skill.slug}`}
          size="icon-sm"
          type="button"
          variant="ghost"
          onClick={onEdit}
        >
          <PencilIcon />
        </Button>
        <Switch
          checked={skill.enabled}
          onCheckedChange={(enabled) => {
            void fetchJson("/api/skills", "PATCH", { id: skill.id, enabled }).then(() => onRefresh());
          }}
        />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              aria-label={`Delete ${skill.slug}`}
              className="text-muted-foreground hover:text-muted-foreground"
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <Trash2Icon />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this skill?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes the skill. Sessions will stop loading it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  void fetchJson("/api/skills", "DELETE", { id: skill.id }).then(() => onRefresh());
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

