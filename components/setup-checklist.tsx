"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CopyIcon, RefreshCwIcon } from "lucide-react";
import { OutLink, SetupStep } from "@/components/setup-step";
import { ThemeAppearanceButton } from "@/components/theme-toggle";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { APP_NAME } from "@/lib/brand";
import {
  nextOpenRequiredSetupStep,
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

async function copyText(value: string): Promise<boolean> {
  if (!navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function SetupChecklist({
  initialStatus,
}: {
  readonly initialStatus: SetupStatus;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [secret, setSecret] = useState("");
  const [allowlistEmail, setAllowlistEmail] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<"generate" | "save-secret" | "save-email" | "refresh" | null>(
    null,
  );
  const [error, setError] = useState<string>();

  const visibleRequiredSteps = visibleRequiredSetupSteps(status);
  const doneCount = visibleRequiredSteps.filter((id) => status[id]).length;
  const progress = Math.round((doneCount / visibleRequiredSteps.length) * 100);
  const [openId, setOpenId] = useState<RequiredSetupStepId | "voice" | "inbox">(
    nextOpenRequiredSetupStep(status),
  );
  const show = (id: RequiredSetupStepId) => shouldShowRequiredSetupStep(id, status);

  async function refreshStatus() {
    setBusy("refresh");
    setError(undefined);
    try {
      const response = await fetch("/api/setup");
      if (!response.ok) throw new Error("Could not refresh the checklist.");
      const payload = (await response.json()) as { status: SetupStatus };
      setStatus(payload.status);
      if (payload.status.allowlist) {
        router.refresh();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not refresh the checklist.");
    } finally {
      setBusy(null);
    }
  }

  async function postSetup(body: Record<string, string>) {
    const response = await fetch("/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as {
      error?: string;
      secret?: string;
      status?: SetupStatus;
    };
    if (!response.ok) {
      throw new Error(payload.error || "That step did not work.");
    }
    if (payload.status) setStatus(payload.status);
    return payload;
  }

  const allowlistStep = (
    <SetupStep
      done={status.allowlist}
      id="allowlist"
      last
      open={openId === "allowlist"}
      onOpen={() => setOpenId("allowlist")}
      title="Lock who can sign in"
    >
      <p>
        Do this last. Until you add an email or domain, anyone who finds the site can create an
        account and spend your AI budget. After you add one, this setup page disappears.
      </p>
      {status.canWriteLocalEnv ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy("save-email");
            setError(undefined);
            void postSetup({
              action: "save-allowlist-email",
              email: allowlistEmail,
            })
              .then((payload) => {
                if (payload.status?.allowlist) {
                  router.refresh();
                }
              })
              .catch((caught: unknown) => {
                setError(
                  caught instanceof Error ? caught.message : "Could not save that email.",
                );
              })
              .finally(() => setBusy(null));
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="setup-allowlist-email">Your email</Label>
            <Input
              autoComplete="email"
              id="setup-allowlist-email"
              inputMode="email"
              onChange={(event) => setAllowlistEmail(event.target.value)}
              placeholder="you@example.com"
              required
              spellCheck={false}
              type="email"
              value={allowlistEmail}
            />
          </div>
          <Button disabled={busy !== null} type="submit">
            Save and hide this page
          </Button>
          <p className="text-muted-foreground text-xs">
            This writes <code className="font-mono">ALLOWED_SIGNUP_EMAILS</code> into{" "}
            <code className="font-mono">.env.local</code>. Add the same value on Vercel before you
            share the live URL.
          </p>
        </form>
      ) : (
        <ol className="list-decimal space-y-1 pl-5">
          <li>Open your Vercel project → Settings → Environment Variables.</li>
          <li>
            Add <code className="font-mono">ALLOWED_SIGNUP_EMAILS</code> with your email (or{" "}
            <code className="font-mono">ALLOWED_SIGNUP_DOMAINS</code> with{" "}
            <code className="font-mono">yourcompany.com</code>).
          </li>
          <li>Redeploy, then open the live site. This page should be gone.</li>
        </ol>
      )}
    </SetupStep>
  );

  const secretStep = (
    <SetupStep
      done={status.authSecret}
      id="authSecret"
      last={status.hosted ? !show("authUrl") && !show("database") && !show("blob") && !show("allowlist") : !show("aiGateway") && !show("allowlist")}
      open={openId === "authSecret"}
      onOpen={() => setOpenId("authSecret")}
      title="Create a sign-in secret"
    >
      <p>
        This random password protects sign-in cookies. You do not need to remember it —
        {status.hosted
          ? " store it on the Vercel project as BETTER_AUTH_SECRET."
          : " store it in your settings file."}
      </p>
      {status.authSecret ? (
        <p className="text-foreground">This secret is already set.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy !== null}
              onClick={() => {
                setBusy("generate");
                setError(undefined);
                void postSetup({ action: "generate-secret" })
                  .then((payload) => {
                    if (payload.secret) setSecret(payload.secret);
                  })
                  .catch((caught: unknown) => {
                    setError(
                      caught instanceof Error ? caught.message : "Could not generate a secret.",
                    );
                  })
                  .finally(() => setBusy(null));
              }}
              type="button"
            >
              Generate secret
            </Button>
            {status.canWriteLocalEnv && secret ? (
              <Button
                disabled={busy !== null}
                onClick={() => {
                  setBusy("save-secret");
                  setError(undefined);
                  void postSetup({ action: "save-secret", secret })
                    .then((payload) => {
                      setOpenId(nextOpenRequiredSetupStep(payload.status ?? status));
                    })
                    .catch((caught: unknown) => {
                      setError(
                        caught instanceof Error ? caught.message : "Could not save the secret.",
                      );
                    })
                    .finally(() => setBusy(null));
                }}
                type="button"
                variant="secondary"
              >
                Save to this computer
              </Button>
            ) : null}
          </div>
          {secret ? (
            <div className="space-y-2">
              <Label htmlFor="setup-secret">Your new secret</Label>
              <div className="flex gap-2">
                <Input id="setup-secret" readOnly spellCheck={false} value={secret} />
                <Button
                  onClick={() => {
                    void copyText(`BETTER_AUTH_SECRET=${secret}`).then((ok) => {
                      setCopied(ok);
                      if (ok) window.setTimeout(() => setCopied(false), 2000);
                    });
                  }}
                  size="icon"
                  type="button"
                  variant="outline"
                >
                  <CopyIcon />
                  <span className="sr-only">Copy secret</span>
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                {copied ? "Copied. " : ""}
                {status.hosted ? (
                  <>
                    Add this as <code className="font-mono">BETTER_AUTH_SECRET</code> in Vercel →
                    Settings → Environment Variables, then redeploy and hit Refresh.
                  </>
                ) : (
                  <>
                    Paste this line into <code className="font-mono">.env.local</code> as{" "}
                    <code className="font-mono">BETTER_AUTH_SECRET</code>. If you edited the file
                    yourself, stop the app and run <code className="font-mono">npm run dev</code>{" "}
                    again, then hit Refresh.
                  </>
                )}
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">
              {status.hosted ? (
                <>
                  Click Generate, then copy the value into Vercel → Settings → Environment
                  Variables as <code className="font-mono">BETTER_AUTH_SECRET</code>. Redeploy,
                  then Refresh.
                </>
              ) : (
                <>
                  Click Generate, then copy the value into{" "}
                  <code className="font-mono">.env.local</code> as{" "}
                  <code className="font-mono">BETTER_AUTH_SECRET</code>.
                </>
              )}
            </p>
          )}
        </div>
      )}
    </SetupStep>
  );

  return (
    <main
      className="min-h-dvh bg-background pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
      id="main"
      tabIndex={-1}
    >
      <div className="mx-auto flex w-full max-w-xl flex-col gap-8 px-1 py-10 sm:py-14">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <p className="font-medium text-sm tracking-tight">{APP_NAME}</p>
            <h1 className="font-semibold text-2xl tracking-tight">Set up your workspace</h1>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {status.hosted ? (
                <>
                  This list is the environment variables on this Vercel deployment. Add missing
                  names under Settings → Environment Variables, redeploy, then Refresh. The last
                  step is who can sign in — after you add your email or domain, this page goes
                  away.
                </>
              ) : (
                <>
                  This list is the values in <code className="font-mono">.env.local</code> on this
                  computer. Add a missing name, restart <code className="font-mono">npm run
                  dev</code>, then Refresh. The last step is who can sign in — after you add your
                  email or domain, this page goes away.
                </>
              )}
            </p>
          </div>
          <ThemeAppearanceButton className="w-auto shrink-0 px-2 py-1 text-muted-foreground text-xs" />
        </header>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 text-muted-foreground text-sm">
            <p>
              {doneCount} of {visibleRequiredSteps.length} required steps ready
            </p>
            <Button
              disabled={busy !== null}
              onClick={() => void refreshStatus()}
              size="sm"
              type="button"
              variant="ghost"
            >
              <RefreshCwIcon className={cn(busy === "refresh" && "animate-spin")} />
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

        {!status.hosted ? (
          <section className="space-y-3">
            <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
              On this computer
            </h2>
            <ol className="overflow-hidden rounded-xl border bg-card">
              {show("authSecret") ? secretStep : null}
              {show("aiGateway") ? (
                <SetupStep
                  done={status.aiGateway}
                  id="aiGateway"
                  last={!show("allowlist")}
                  open={openId === "aiGateway"}
                  onOpen={() => setOpenId("aiGateway")}
                  title="Add an AI Gateway key"
                >
                  <p>
                    This is how the agent talks to AI models on your computer. Put the key in{" "}
                    <code className="font-mono">.env.local</code>.
                  </p>
                  <ol className="list-decimal space-y-1 pl-5">
                    <li>
                      Open{" "}
                      <OutLink href={AI_GATEWAY_KEYS_URL}>AI Gateway API keys</OutLink> and create a
                      key.
                    </li>
                    <li>
                      In <code className="font-mono">.env.local</code>, put it on the{" "}
                      <code className="font-mono">AI_GATEWAY_API_KEY=</code> line. Save the file,
                      restart <code className="font-mono">npm run dev</code>, then Refresh.
                    </li>
                  </ol>
                </SetupStep>
              ) : null}
              {show("allowlist") ? allowlistStep : null}
            </ol>
          </section>
        ) : (
          <section className="space-y-3">
            <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
              On this deployment
            </h2>
            <ol className="overflow-hidden rounded-xl border bg-card">
              {show("authSecret") ? secretStep : null}
              {show("authUrl") ? (
                <SetupStep
                  done={status.authUrl}
                  id="authUrl"
                  last={!show("database") && !show("blob") && !show("allowlist")}
                  open={openId === "authUrl"}
                  onOpen={() => setOpenId("authUrl")}
                  title="Set the public website address"
                >
                  <p>Sign-in needs the live site URL from this Vercel project.</p>
                  <ol className="list-decimal space-y-1 pl-5">
                    <li>Open your Vercel project → Settings → Environment Variables.</li>
                    <li>
                      Add <code className="font-mono">BETTER_AUTH_URL</code> with your live URL,
                      such as <code className="font-mono">https://your-app.vercel.app</code>.
                    </li>
                    <li>Redeploy (Deployments → ⋯ → Redeploy) so the new setting is used.</li>
                  </ol>
                </SetupStep>
              ) : null}
              {show("database") ? (
                <SetupStep
                  done={status.database}
                  id="database"
                  last={!show("blob") && !show("allowlist")}
                  open={openId === "database"}
                  onOpen={() => setOpenId("database")}
                  title="Add a Neon database"
                >
                  <p>
                    The live site needs a Neon Postgres database so accounts and chats survive
                    deploys.
                  </p>
                  <ol className="list-decimal space-y-1 pl-5">
                    <li>Open your Vercel project → Storage → Create Database → Neon.</li>
                    <li>
                      Or install Neon from the{" "}
                      <OutLink href={NEON_MARKETPLACE_URL}>Vercel Marketplace</OutLink>.
                    </li>
                    <li>
                      Vercel adds <code className="font-mono">DATABASE_URL</code> for you. Redeploy
                      after it appears.
                    </li>
                  </ol>
                </SetupStep>
              ) : null}
              {show("blob") ? (
                <SetupStep
                  done={status.blob}
                  id="blob"
                  last={!show("allowlist")}
                  open={openId === "blob"}
                  onOpen={() => setOpenId("blob")}
                  title="Add file storage"
                >
                  <p>Vercel Blob stores uploaded files and some memory notes.</p>
                  <ol className="list-decimal space-y-1 pl-5">
                    <li>Open your Vercel project → Storage → Create → Blob.</li>
                    <li>
                      See the <OutLink href={BLOB_DOCS_URL}>Blob guide</OutLink> if the menu looks
                      different.
                    </li>
                    <li>
                      Vercel adds <code className="font-mono">BLOB_READ_WRITE_TOKEN</code>. Redeploy
                      after it appears.
                    </li>
                  </ol>
                </SetupStep>
              ) : null}
              {show("allowlist") ? allowlistStep : null}
            </ol>
          </section>
        )}

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
                Voice input uses AI Gateway, like chat, so it works once the Gateway step is done.
                Pick the model with <code className="font-mono">models.transcription</code> in{" "}
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
                Add <code className="font-mono">RESEND_API_KEY</code> and{" "}
                <code className="font-mono">RESEND_FROM_EMAIL</code>
                {status.hosted ? (
                  <>
                    {" "}
                    on this Vercel project so signup can send a verification link and the agent can
                    send and receive mail. The README has the inbound webhook steps.
                  </>
                ) : (
                  <>
                    {" "}
                    in <code className="font-mono">.env.local</code> so signup can send a
                    verification link and the agent can send and receive mail. The README has the
                    inbound webhook steps. Without Resend, the verification URL is printed in the
                    server log.
                  </>
                )}
              </p>
            </SetupStep>
          </ol>
        </section>

        <p className="text-center text-muted-foreground text-sm">
          {status.authSecret ? (
            <>
              Ready to try the app{status.hosted ? "" : " on this computer"}?{" "}
              <Link className="underline" href="/sign-up">
                Create an account
              </Link>{" "}
              or{" "}
              <Link className="underline" href="/sign-in">
                sign in
              </Link>
              .
            </>
          ) : (
            <>
              Create the sign-in secret first, then you can make an account
              {status.hosted ? "" : " on this computer"}.
            </>
          )}
        </p>
      </div>
    </main>
  );
}
