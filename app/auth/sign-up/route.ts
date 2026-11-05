import { headers } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getAuth } from "@/lib/auth";
import { VERIFY_EMAIL_CALLBACK_PATH } from "@/lib/auth-email";
import { authFormErrorMessage, formField } from "@/lib/auth-form";
import { ensureNeonAuthSchema } from "@/lib/db";
import { isCrossSiteRequest } from "@/lib/internal-auth";
import { clientKey, RATE_LIMIT_MESSAGE, rateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  if (isCrossSiteRequest(request)) {
    return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
  }
  if (!rateLimit(clientKey(request, "signup"), { limit: 5, windowMs: 15 * 60 * 1000 })) {
    const dest = new URL("/sign-up", request.url);
    dest.searchParams.set("error", RATE_LIMIT_MESSAGE);
    return NextResponse.redirect(dest, 303);
  }

  const formData = await request.formData();
  const name = formField(formData, "name");
  const email = formField(formData, "email");
  const password = formField(formData, "password", { trim: false });

  if (password.length < 8) {
    const dest = new URL("/sign-up", request.url);
    dest.searchParams.set("error", "Password must be at least 8 characters.");
    return NextResponse.redirect(dest, 303);
  }

  await ensureNeonAuthSchema();
  try {
    await getAuth().api.signUpEmail({
      body: { name, email, password, callbackURL: VERIFY_EMAIL_CALLBACK_PATH },
      headers: await headers(),
    });
  } catch (error) {
    const dest = new URL("/sign-up", request.url);
    dest.searchParams.set("error", authFormErrorMessage(error));
    return NextResponse.redirect(dest, 303);
  }

  const dest = new URL("/sign-up", request.url);
  dest.searchParams.set("checkEmail", "1");
  return NextResponse.redirect(dest, 303);
}
