import { AuthForm } from "@/components/auth-form";
import { UsagePanel } from "@/components/usage-panel";
import { getSession } from "@/lib/session";
import { listChats, listUserUsage } from "@/lib/store";
import { toUsagePageSnapshot } from "@/lib/usage";

export default async function UsagePage() {
  const session = await getSession();
  if (!session) {
    return <AuthForm mode="sign-in" />;
  }

  const [records, chats] = await Promise.all([
    listUserUsage(session.user.id),
    listChats(session.user.id),
  ]);

  return <UsagePanel you={toUsagePageSnapshot(records, chats, { includeSessions: false })} />;
}
