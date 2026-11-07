import { connection } from "next/server";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { needsVerificationFollowUp } from "@/lib/auth-email";
import { authFormErrorMessage, firstSearchParam } from "@/lib/auth-form";
import { ownerAccount } from "@/lib/owner";
import { getSession } from "@/lib/session";
import { getSetupStatus } from "@/lib/setup-status";

export default async function SignUpPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly checkEmail?: string | string[]; readonly error?: string | string[] }>;
}) {
  await connection();
  if (!getSetupStatus().authSecret) {
    redirect("/");
  }
  if (await getSession()) {
    redirect("/");
  }
  const query = await searchParams;
  // One account only. Once it exists, send people to sign in, keeping the
  // "check your email" state so the owner can still resend the link.
  const error = firstSearchParam(query.error);
  if (await ownerAccount()) {
    const params = new URLSearchParams();
    if (firstSearchParam(query.checkEmail) === "1") params.set("checkEmail", "1");
    if (error) params.set("error", error);
    redirect(params.size > 0 ? `/sign-in?${params}` : "/sign-in");
  }
  return (
    <AuthForm
      checkEmail={firstSearchParam(query.checkEmail) === "1" || needsVerificationFollowUp(error)}
      initialError={error ? authFormErrorMessage(error) : undefined}
      mode="sign-up"
    />
  );
}
