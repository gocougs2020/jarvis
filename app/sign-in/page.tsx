import { connection } from "next/server";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { needsVerificationFollowUp } from "@/lib/auth-email";
import { authFormErrorMessage, firstSearchParam } from "@/lib/auth-form";
import { ownerAccount } from "@/lib/owner";
import { getSession } from "@/lib/session";
import { getSetupStatus } from "@/lib/setup-status";

export default async function SignInPage({
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
  const error = firstSearchParam(query.error);
  return (
    <AuthForm
      checkEmail={firstSearchParam(query.checkEmail) === "1" || needsVerificationFollowUp(error)}
      initialError={error ? authFormErrorMessage(error) : undefined}
      mode="sign-in"
      signUpOpen={!(await ownerAccount())}
    />
  );
}
