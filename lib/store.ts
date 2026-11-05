import { ensureNeonAuthSchema, hasNeon } from "@/lib/db";
import { generateInboundMailToken } from "@/lib/inbound-mail-token";
import * as jsonStore from "@/lib/store-json";
import * as pgStore from "@/lib/store-pg";

export { titleFromPrompt } from "@/lib/store-logic";
export type { ModelTier } from "@/lib/types";

type Store = typeof jsonStore;
type StoreMethod = {
  [K in keyof Store]: Store[K] extends (...args: never[]) => unknown ? K : never;
}[keyof Store];
type Async<F> = F extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never;
/** Both backends share the JSON store's signatures; only the sync/async return differs. */
type Backend = { [K in StoreMethod]: (...args: Parameters<Store[K]>) => unknown };

async function store(): Promise<Backend> {
  if (hasNeon()) {
    await ensureNeonAuthSchema();
    return pgStore;
  }
  return jsonStore;
}

/** Route one store method to the Neon or local JSON backend chosen at call time. */
function delegate<K extends StoreMethod>(name: K): Async<Store[K]> {
  return (async (...args: Parameters<Store[K]>) => (await store())[name](...args)) as Async<
    Store[K]
  >;
}

export const getUserSettings = delegate("getUserSettings");
export const upsertUserSettings = delegate("upsertUserSettings");
export const findUserIdByInboundMailToken = delegate("findUserIdByInboundMailToken");

async function issueUniqueInboundMailToken(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const token = generateInboundMailToken();
    const existing = await findUserIdByInboundMailToken(token);
    if (!existing) return token;
  }
  throw new Error("Unable to issue an inbound mail token.");
}

export async function ensureInboundMailToken(userId: string) {
  const current = await getUserSettings(userId);
  if (current.inboundMailToken) return current;
  return upsertUserSettings(userId, { inboundMailToken: await issueUniqueInboundMailToken() });
}

export async function rotateInboundMailToken(userId: string) {
  return upsertUserSettings(userId, { inboundMailToken: await issueUniqueInboundMailToken() });
}

export const listChats = delegate("listChats");
export const listAccountChats = delegate("listAccountChats");
export const getChat = delegate("getChat");
export const createChat = delegate("createChat");
export const updateChat = delegate("updateChat");
export const deleteChat = delegate("deleteChat");
export const getChatByEveSessionId = delegate("getChatByEveSessionId");
export const listChatOwnersForEveSession = delegate("listChatOwnersForEveSession");
export const listChatEvents = delegate("listChatEvents");
export const upsertChatEvent = delegate("upsertChatEvent");
export const replaceChatEvents = delegate("replaceChatEvents");
export const writeChatEventsTail = delegate("writeChatEventsTail");

export const listUserSkills = delegate("listUserSkills");
export const createUserSkill = delegate("createUserSkill");
export const updateUserSkill = delegate("updateUserSkill");
export const deleteUserSkill = delegate("deleteUserSkill");

export const listJobs = delegate("listJobs");
export const createJob = delegate("createJob");
export const updateJob = delegate("updateJob");
export const deleteJob = delegate("deleteJob");
export const claimDueJobs = delegate("claimDueJobs");
export const claimJob = delegate("claimJob");
export const completeJob = delegate("completeJob");
export const releaseJob = delegate("releaseJob");

export const listDocuments = delegate("listDocuments");
export const listFolders = delegate("listFolders");
export const getFolder = delegate("getFolder");
export const createFolder = delegate("createFolder");
export const updateFolder = delegate("updateFolder");
export const deleteFolder = delegate("deleteFolder");
export const getDocument = delegate("getDocument");
export const getPublicDocument = delegate("getPublicDocument");
export const createDocument = delegate("createDocument");
export const updateDocument = delegate("updateDocument");
export const deleteDocument = delegate("deleteDocument");
export const listChatDocuments = delegate("listChatDocuments");
export const listDocumentChats = delegate("listDocumentChats");
export const attachDocument = delegate("attachDocument");
export const detachDocument = delegate("detachDocument");

export const upsertEmbedding = delegate("upsertEmbedding");
export const listUserEmbeddings = delegate("listUserEmbeddings");
export const searchUserEmbeddings = delegate("searchUserEmbeddings");
export const deleteEmbeddingsForSource = delegate("deleteEmbeddingsForSource");
export const upsertSessionCitationSet = delegate("upsertSessionCitationSet");
export const listSessionCitationSets = delegate("listSessionCitationSets");

export const upsertUsageRecord = delegate("upsertUsageRecord");
export const listUserUsage = delegate("listUserUsage");
export const listAccountUsage = delegate("listAccountUsage");
export const listChatUsage = delegate("listChatUsage");

export const listEmails = delegate("listEmails");
export const getEmail = delegate("getEmail");
export const getEmailByResendId = delegate("getEmailByResendId");
export const createEmail = delegate("createEmail");
export const updateEmail = delegate("updateEmail");
