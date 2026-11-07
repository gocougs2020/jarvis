import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { ACCESS_DENIED_MESSAGE, canCreateAccount, isOwnerEmail } from "@/lib/owner";
import { getNeonDb, getSqliteDb, hasNeon } from "@/lib/db";
import { pgAuthSchema, sqliteAuthSchema } from "@/lib/db/schema";
import { sendVerificationEmail, VERIFY_EMAIL_EXPIRES_IN_SECONDS } from "@/lib/auth-email";
import { authOrigins } from "@/lib/auth-origins";
import { findUserById } from "@/lib/email-users";

export class MissingAuthSecretError extends Error {
  constructor() {
    super(
      "BETTER_AUTH_SECRET is required. Copy .env.example to .env.local and set BETTER_AUTH_SECRET to a random 32+ character string, for example: openssl rand -base64 32. See README.md.",
    );
    this.name = "MissingAuthSecretError";
  }
}

function requireAuthSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  if (!secret) {
    throw new MissingAuthSecretError();
  }
  return secret;
}

function emailFromUnknown(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const email = (value as { email?: unknown }).email;
  return typeof email === "string" ? email : "";
}

function createAuth() {
  const secret = requireAuthSecret();
  const { hosts, origins, fallback } = authOrigins();

  const shared = {
    secret,
    baseURL: {
      allowedHosts: hosts,
      fallback,
    },
    trustedOrigins: origins,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      requireEmailVerification: true,
      autoSignIn: false,
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: VERIFY_EMAIL_EXPIRES_IN_SECONDS,
      sendVerificationEmail: async ({
        user,
        url,
        token,
      }: {
        user: { id: string; email: string };
        url: string;
        token: string;
      }) => {
        await sendVerificationEmail({ user, url, token });
      },
    },
    plugins: [nextCookies()],
    hooks: {
      // One account: the owner (lib/owner.ts). Checked at every entry point:
      // the API before and after, the user row insert, and each new session.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-up/email") {
          const email = typeof ctx.body?.email === "string" ? ctx.body.email : "";
          const decision = await canCreateAccount(email);
          if (!decision.ok) {
            throw new APIError("FORBIDDEN", { message: decision.message });
          }
          return;
        }
        if (ctx.path === "/sign-in/email") {
          const email = typeof ctx.body?.email === "string" ? ctx.body.email : "";
          if (!(await isOwnerEmail(email))) {
            throw new APIError("FORBIDDEN", { message: ACCESS_DENIED_MESSAGE });
          }
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-out") return;
        const returned = ctx.context.returned;
        const email = emailFromUnknown(returned) || emailFromUnknown(
          returned && typeof returned === "object"
            ? (returned as { user?: unknown }).user
            : undefined,
        );
        // A sign-up response carries the account just created; it is checked
        // in user.create.before instead (before it exists, it is not the owner yet).
        if (ctx.path === "/sign-up/email") return;
        if (email && !(await isOwnerEmail(email))) {
          throw new APIError("FORBIDDEN", { message: ACCESS_DENIED_MESSAGE });
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user: { email: string }) => {
            const decision = await canCreateAccount(user.email);
            if (!decision.ok) {
              throw new APIError("FORBIDDEN", { message: decision.message });
            }
            return { data: user };
          },
        },
      },
      session: {
        create: {
          before: async (session: { userId: string }) => {
            const user = await findUserById(session.userId);
            if (user && !(await isOwnerEmail(user.email))) {
              throw new APIError("FORBIDDEN", { message: ACCESS_DENIED_MESSAGE });
            }
            return true;
          },
        },
      },
    },
  };

  if (hasNeon()) {
    return betterAuth({
      ...shared,
      database: drizzleAdapter(getNeonDb(), {
        provider: "pg",
        schema: pgAuthSchema,
      }),
    });
  }

  return betterAuth({
    ...shared,
    database: drizzleAdapter(getSqliteDb(), {
      provider: "sqlite",
      schema: sqliteAuthSchema,
    }),
  });
}

let authSingleton: ReturnType<typeof createAuth> | undefined;

export function getAuth() {
  authSingleton ??= createAuth();
  return authSingleton;
}

export async function sessionIfAllowed<T extends { user: { email: string } } | null>(
  session: T,
  headers?: Headers,
): Promise<T | null> {
  if (!session) return null;
  if (await isOwnerEmail(session.user.email)) return session;
  if (headers) {
    try {
      await getAuth().api.signOut({ headers });
    } catch {
      // Cookie may already be invalid.
    }
  }
  return null;
}
