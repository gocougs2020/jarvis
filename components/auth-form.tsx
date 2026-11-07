"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { APP_NAME } from "@/lib/brand";

function ResendVerificationFields({
  next,
  pending,
}: {
  readonly next: "/sign-in" | "/sign-up";
  readonly pending: boolean;
}) {
  return (
    <>
      <input name="next" type="hidden" value={next} />
      <div className="space-y-2">
        <Label htmlFor="resend-email">Email</Label>
        <Input
          autoComplete="email"
          id="resend-email"
          inputMode="email"
          name="email"
          required
          spellCheck={false}
          type="email"
        />
      </div>
      <Button className="w-full" disabled={pending} type="submit">
        {pending ? (
          <>
            <Spinner />
            Sending link…
          </>
        ) : (
          "Send a new link"
        )}
      </Button>
    </>
  );
}

export function AuthForm({
  checkEmail,
  initialError,
  mode,
  signUpOpen = true,
}: {
  readonly checkEmail?: boolean;
  readonly initialError?: string;
  readonly mode: "sign-in" | "sign-up";
  /** False once the owner account exists: Jarvis has exactly one account. */
  readonly signUpOpen?: boolean;
}) {
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!initialError && !checkEmail) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("error") && !url.searchParams.has("checkEmail")) return;
    url.searchParams.delete("error");
    url.searchParams.delete("checkEmail");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [checkEmail, initialError]);

  return (
    <main
      className="flex min-h-dvh items-center justify-center bg-background pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
      id="main"
      tabIndex={-1}
    >
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            {checkEmail ? "Check your email" : mode === "sign-in" ? "Sign in" : "Create your account"}
          </CardTitle>
          <CardDescription>
            {checkEmail
              ? `We sent a verification link for your ${APP_NAME} account. Open it to finish, then you'll be signed in. Check your spam folder if you do not see it. The link expires in 1 hour.`
              : mode === "sign-up"
                ? `${APP_NAME} emails a verification link before you can sign in.`
                : `${APP_NAME} keeps sessions, skills, and jobs with your account.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {checkEmail ? (
            <form
              action="/auth/send-verification"
              className="space-y-4"
              method="post"
              onSubmit={() => setPending(true)}
            >
              {initialError ? (
                <Alert aria-live="polite" variant="destructive">
                  <AlertTitle>Verification needed</AlertTitle>
                  <AlertDescription>{initialError}</AlertDescription>
                </Alert>
              ) : (
                <Alert aria-live="polite">
                  <AlertTitle>Verification email sent</AlertTitle>
                  <AlertDescription>
                    Check your spam folder if it is not in your inbox. You can also send a new
                    link to the same address.
                  </AlertDescription>
                </Alert>
              )}
              <ResendVerificationFields next={mode === "sign-up" ? "/sign-up" : "/sign-in"} pending={pending} />
              <p className="text-center text-muted-foreground text-sm">
                Already confirmed?{" "}
                <Link className="underline" href="/sign-in">
                  Sign in
                </Link>
              </p>
            </form>
          ) : (
            <form
              action={mode === "sign-in" ? "/auth/sign-in" : "/auth/sign-up"}
              className="space-y-4"
              method="post"
              onSubmit={() => setPending(true)}
            >
              {initialError ? (
                <Alert aria-live="polite" variant="destructive">
                  <AlertTitle>Authentication failed</AlertTitle>
                  <AlertDescription>{initialError}</AlertDescription>
                </Alert>
              ) : null}
              {mode === "sign-up" ? (
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input autoComplete="name" id="name" name="name" required />
                </div>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  autoComplete="email"
                  id="email"
                  inputMode="email"
                  name="email"
                  required
                  spellCheck={false}
                  type="email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                  id="password"
                  minLength={8}
                  name="password"
                  required
                  type="password"
                />
              </div>
              <Button className="w-full" disabled={pending} type="submit">
                {pending ? (
                  <>
                    <Spinner />
                    {mode === "sign-in" ? "Signing in…" : "Creating account…"}
                  </>
                ) : mode === "sign-in" ? (
                  "Sign in"
                ) : (
                  "Create account"
                )}
              </Button>
              <p className="text-center text-muted-foreground text-sm">
                {mode === "sign-in" ? (
                  signUpOpen ? (
                    <>
                      No account yet?{" "}
                      <Link className="underline" href="/sign-up">
                        Create the owner account
                      </Link>
                    </>
                  ) : null
                ) : (
                  <>
                    Already have an account?{" "}
                    <Link className="underline" href="/sign-in">
                      Sign in
                    </Link>
                  </>
                )}
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
