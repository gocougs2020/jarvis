"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon, ExternalLinkIcon, InboxIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export type ResendInboxInfo = {
  address: string | null;
  active: boolean;
  unread: number;
  error?: string;
};

export type InboundMailInfo = {
  address: string | null;
  configured: boolean;
  /** Present when Resend Inboxes are on for this deployment (resendInbox in app.config.ts). */
  resendInbox?: ResendInboxInfo | null;
};

async function copyText(value: string): Promise<boolean> {
  if (!navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function InboundMailSettings({
  inboundMail,
  onChanged,
}: {
  readonly inboundMail: InboundMailInfo | undefined;
  readonly onChanged: (next: InboundMailInfo) => void;
}) {
  const [copied, setCopied] = useState(false);
  const address = inboundMail?.address ?? "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent address</CardTitle>
        <CardDescription>
          The agent sends and receives at this address. Mail from your account email starts a
          session when it asks for something and passes your domain&apos;s DMARC check; other mail
          is filed in Inbox. Set it with <code>RESEND_FROM_EMAIL</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {inboundMail && !inboundMail.configured ? (
          <p className="text-muted-foreground text-sm">
            Set <code>RESEND_FROM_EMAIL</code> to an address on a Resend domain with receiving
            enabled, for example <code>agent@yourdomain.com</code>.
          </p>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            readOnly
            aria-label="Agent email address"
            className="font-mono text-sm"
            placeholder="Set RESEND_FROM_EMAIL to see the address"
            value={address}
          />
          <Button
            disabled={!address}
            size="sm"
            type="button"
            variant="outline"
            onClick={() => {
              if (!address) return;
              void copyText(address).then((ok) => {
                if (!ok) return;
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              });
            }}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        {inboundMail?.resendInbox ? (
          <ResendInboxSection info={inboundMail.resendInbox} onChanged={onChanged} />
        ) : null}
      </CardContent>
    </Card>
  );
}

function ResendInboxSection({
  info,
  onChanged,
}: {
  readonly info: ResendInboxInfo;
  readonly onChanged: (next: InboundMailInfo) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();

  const turnOn = () => {
    setCreating(true);
    setError(undefined);
    void fetch("/api/settings/resend-inbox", { method: "POST" })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          inboundMail?: InboundMailInfo;
        };
        if (!response.ok || !payload.inboundMail) {
          throw new Error(payload.error || "Unable to turn on the inbox.");
        }
        onChanged(payload.inboundMail);
      })
      .catch((createError: unknown) => {
        setError(createError instanceof Error ? createError.message : "Unable to turn on the inbox.");
      })
      .finally(() => setCreating(false));
  };

  return (
    <section aria-labelledby="resend-inbox-heading" className="space-y-3 border-t pt-4">
      <div className="flex items-center gap-2">
        <InboxIcon aria-hidden="true" className="size-4 text-muted-foreground" />
        <h3 className="font-medium text-sm" id="resend-inbox-heading">
          Resend inbox
        </h3>
        {info.active ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs">
            {info.unread > 0 ? `${info.unread} unread` : "On"}
          </span>
        ) : null}
      </div>
      {info.active ? (
        <>
          <p className="text-muted-foreground text-sm">
            Mail to <span className="font-mono text-foreground">{info.address}</span> is kept as
            threads in Resend. Resend&apos;s inbox agent labels new mail and drafts replies, and
            never sends. The agent can search, read, reply, and organize these threads; sending
            always asks you first.
          </p>
          <Button asChild size="sm" variant="outline">
            <a href="https://resend.com/inboxes" rel="noreferrer" target="_blank">
              <ExternalLinkIcon />
              Open in Resend
            </a>
          </Button>
        </>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            Host the agent address as a Resend inbox. Resend keeps threads, labels, and drafts,
            triages new mail, and lets the agent work the inbox. Each Resend account includes a
            few free inboxes; see Resend pricing beyond that.
          </p>
          <Button disabled={creating || !info.address} onClick={turnOn} size="sm" type="button">
            {creating ? "Turning on…" : "Turn on Resend inbox"}
          </Button>
        </>
      )}
      {error || info.error ? (
        <p className="text-destructive text-sm" role="alert">
          {error || info.error}
        </p>
      ) : null}
    </section>
  );
}