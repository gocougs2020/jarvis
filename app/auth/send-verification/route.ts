import { headers } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getAuth } from "@/lib/auth";
import { VERIFY_EMAIL_CALLBACK_PATH } from "@/lib/auth-email";
import { authFormErrorMessage, formField } from "@/lib/auth-form";
import { ensureNeonAuthSchema } from "@/lib/db";
import { isCrossSiteRequest } from "@/lib/internal-auth";
import { isOwnerEmail } from "@/lib/owner";
import { clientKey, RATE_LIMIT_MESSAGE, rateLimit } from "@/lib/rate-limit";

function verificationReturnPath(value: string): "/sign-in" | "/sign-up" {
  return value === "/sign-up" ? "/sign-up" : "/sign-in";
}

export async function POST(request: NextRequest) {
  if (isCrossSiteRequest(request)) {
    return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
  }
  const formData = await request.formData();
  const next = verificationReturnPath(formField(formData, "next"));
  const dest = new URL(next, request.url);

  if (!rateLimit(clientKey(request, "verify-email"), { limit: 5, windowMs: 15 * 60 * 1000 })) {
    dest.searchParams.set("error", RATE_LIMIT_MESSAGE);
    return NextResponse.redirect(dest, 303);
  }

  const email = formField(formData, "email");
  if (!email) {
    dest.searchParams.set("error", "Enter the email you used to sign up.");
    return NextResponse.redirect(dest, 303);
  }
  // Only the owner has an account; answer the same either way so the form never reveals who that is.
  if (!(await isOwnerEmail(email))) {
    dest.searchParams.set("checkEmail", "1");
    return NextResponse.redirect(dest, 303);
  }

  await ensureNeonAuthSchema();
  try {
    await getAuth().api.sendVerificationEmail({
      body: { email, callbackURL: VERIFY_EMAIL_CALLBACK_PATH },
      headers: await headers(),
    });
  } catch (error) {
    dest.searchParams.set("error", authFormErrorMessage(error));
    return NextResponse.redirect(dest, 303);
  }

  dest.searchParams.set("checkEmail", "1");
  return NextResponse.redirect(dest, 303);
}
