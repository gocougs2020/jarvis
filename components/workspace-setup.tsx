"use client";

import { useState } from "react";
import Link from "next/link";
import { RefreshCwIcon } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { OutLink, SetupStep } from "@/components/setup-step";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  shouldShowRequiredSetupStep,
  visibleRequiredSetupSteps,
  type RequiredSetupStepId,
} from "@/lib/setup-steps";
import type { SetupStatus } from "@/lib/setup-status";
import { cn } from "@/lib/utils";

const AI_GATEWAY_KEYS_URL =
  "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys&title=Get%20your%20AI%20Gateway%20key";
const NEON_MARKETPLACE_URL = "https://vercel.com/marketplace/neon";
const BLOB_DOCS_URL = "https://vercel.com/docs/storage/vercel-blob";
const RESEND_KEYS_URL = "https://resend.com/api-keys";

type SetupItemId =
  | "authSecret"
  | "aiGateway"
  | "hosted"
  | "authUrl"
  | "database"
  | "blob"
  | "owner"
  | "voice"
  | "inbox";

const optionalItems: readonly SetupItemId[] = ["voice", "inbox"];

export function WorkspaceSetup({
  initialStatus,
}: {
  readonly initialStatus: SetupStatus;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const visibleRequired = visibleRequiredSetupSteps(status);
  const visibleItems: readonly SetupItemId[] = [...visibleRequired, ...optionalItems];
  const firstOpen = visibleItems.find((id) => !status[id]) ?? visibleItems[0];
  const [openId, setOpenId] = useState<SetupItemId>(firstOpen);
  const show = (id: RequiredSetupStepId) => shouldShowRequiredSetupStep(id, status);

  const remaining = visibleItems.filter((id) => !status[id]).length;
  const progress = Math.round(((visibleItems.length - remaining) / visibleItems.length) * 100);

  async function refreshStatus() {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/api/setup");
      if (!response.ok) throw new Error("Could not refresh the checklist.");
      const payload = (await response.json()) as { status: SetupStatus };
      setStatus(payload.status);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not refresh the checklist.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background pb-[env(safe-area-inset-bottom)]">
      <AppHeader backHref="/settings" backLabel="Settings" />
      <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-8" id="main" tabIndex={-1}>
        <div>
          <h1 className="text-pretty font-medium text-2xl tracking-tight">Workspace setup</h1>
          <p className="text-muted-foreground text-sm">
            Remaining environment settings. This page never shows secret values — only whether
            each one is configured.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 text-muted-foreground text-sm">
            <p>
              {remaining === 0
                ? "Every item on this list is configured"
                : `${remaining} ${remaining === 1 ? "item" : "items"} left`}
            </p>
            <Button disabled={busy} onClick={() => void refreshStatus()} size="sm" type="button" variant="ghost">
              <RefreshCwIcon className={cn(busy && "animate-spin")} />
              Refresh
            </Button>
          </div>
          <Progress value={progress} />
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Something went wrong</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <p className="text-muted-foreground text-sm leading-relaxed">
          {status.hosted ? (
            <>
              This list is the environment variables on this Vercel deployment. Add missing names
              under Settings → Environment Variables, then redeploy. The page never prints secret
              values.
            </>
          ) : (
            <>
              This list is the values in <code className="font-mono">.env.local</code> on this
              computer. Put missing names there, restart <code className="font-mono">npm run
              dev</code>, then Refresh.
            </>
          )}
        </p>

        <section className="space-y-3">
          <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
            Required
          </h2>
          <ol className="overflow-hidden rounded-xl border bg-card">
            {show("authSecret") ? (
              <SetupStep
                done={status.authSecret}
                id="authSecret"
                last={visibleRequired.at(-1) === "authSecret"}
                open={openId === "authSecret"}
                onOpen={() => setOpenId("authSecret")}
                title="Sign-in secret"
              >
                <p>
                  <code className="font-mono">BETTER_AUTH_SECRET</code> — a 32+ character random
                  string that signs auth cookies.
                  {status.hosted
                    ? " Add it on this Vercel project if it is missing."
                    : " Generate one from the first-run checklist, or paste it into .env.local."}
                </p>
              </SetupStep>
            ) : null}
            {show("aiGateway") ? (
              <SetupStep
                done={status.aiGateway}
                id="aiGateway"
                last={visibleRequired.at(-1) === "aiGateway"}
                open={openId === "aiGateway"}
                onOpen={() => setOpenId("aiGateway")}
                title="AI Gateway"
              >
                <p>
                  <code className="font-mono">AI_GATEWAY_API_KEY</code> in{" "}
                  <code className="font-mono">.env.local</code>. Create a key at{" "}
                  <OutLink href={AI_GATEWAY_KEYS_URL}>AI Gateway API keys</OutLink>.
                </p>
              </SetupStep>
            ) : null}
            {show("authUrl") ? (
              <SetupStep
                done={status.authUrl}
                id="authUrl"
                last={visibleRequired.at(-1) === "authUrl"}
                open={openId === "authUrl"}
                onOpen={() => setOpenId("authUrl")}
                title="Public website address"
              >
                <p>
                  <code className="font-mono">BETTER_AUTH_URL</code> on this Vercel project must be
                  your live origin, including <code className="font-mono">https://</code>.
                </p>
              </SetupStep>
            ) : null}
            {show("database") ? (
              <SetupStep
                done={status.database}
                id="database"
                last={visibleRequired.at(-1) === "database"}
                open={openId === "database"}
                onOpen={() => setOpenId("database")}
                title="Neon database"
              >
                <p>
                  <code className="font-mono">DATABASE_URL</code> — required on the live site so
                  accounts and chats survive deploys. Add Neon from Vercel → Storage, or the{" "}
                  <OutLink href={NEON_MARKETPLACE_URL}>Marketplace</OutLink>.
                </p>
              </SetupStep>
            ) : null}
            {show("blob") ? (
              <SetupStep
                done={status.blob}
                id="blob"
                last={visibleRequired.at(-1) === "blob"}
                open={openId === "blob"}
                onOpen={() => setOpenId("blob")}
                title="File storage"
              >
                <p>
                  <code className="font-mono">BLOB_READ_WRITE_TOKEN</code> — Vercel Blob for
                  uploads and some memory notes. See the{" "}
                  <OutLink href={BLOB_DOCS_URL}>Blob guide</OutLink>.
                </p>
              </SetupStep>
            ) : null}
            {show("owner") ? (
              <SetupStep
                done={status.owner}
                id="owner"
                last={visibleRequired.at(-1) === "owner"}
                open={openId === "owner"}
                onOpen={() => setOpenId("owner")}
                title="Owner"
              >
                <p>
                  <code className="font-mono">OWNER_EMAIL</code> — the one account that can sign
                  in. Until it is set, the home page stays a public checklist and nobody can create
                  an account.
                </p>
              </SetupStep>
            ) : null}
          </ol>
        </section>

        <section className="space-y-3">
          <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
            Optional
          </h2>
          <ol className="overflow-hidden rounded-xl border bg-card">
            <SetupStep
              done={status.voice}
              id="voice"
              open={openId === "voice"}
              onOpen={() => setOpenId("voice")}
              title="Voice input"
            >
              <p>
                Voice input runs through AI Gateway with the same access as chat, so there is no
                extra key. Change the model with{" "}
                <code className="font-mono">models.transcription</code> in{" "}
                <code className="font-mono">app.config.ts</code>.
              </p>
            </SetupStep>
            <SetupStep
              done={status.inbox}
              id="inbox"
              last
              open={openId === "inbox"}
              onOpen={() => setOpenId("inbox")}
              title="Email inbox"
            >
              <p>
                <code className="font-mono">RESEND_API_KEY</code> and{" "}
                <code className="font-mono">RESEND_FROM_EMAIL</code>
                {status.hosted ? " on this Vercel project" : <> in <code className="font-mono">.env.local</code></>}
                {" "}so signup can send a verification link and the agent can send and receive mail.
                Get a key at <OutLink href={RESEND_KEYS_URL}>Resend</OutLink>. Inbound also needs{" "}
                <code className="font-mono">RESEND_WEBHOOK_SECRET</code> — the README has the
                webhook steps.
              </p>
            </SetupStep>
          </ol>
        </section>

        <p className="text-muted-foreground text-xs leading-relaxed">
          Done with this page? Set <code className="font-mono">setup.inAppPage</code> to{" "}
          <code className="font-mono">false</code> in{" "}
          <code className="font-mono">app.config.ts</code>, or delete{" "}
          <code className="font-mono">app/settings/setup/</code> and{" "}
          <code className="font-mono">components/workspace-setup.tsx</code>. The README lists the
          leftover links. The first-run checklist on <code className="font-mono">/</code> stays
          until <code className="font-mono">OWNER_EMAIL</code> is set.
        </p>

        <p>
          <Link className="text-muted-foreground text-sm underline hover:text-foreground" href="/settings">
            Back to Settings
          </Link>
        </p>
      </main>
    </div>
  );
}
