import { and, cosineDistance, eq, inArray, notInArray, sql } from "drizzle-orm";
import { getNeonDb } from "@/lib/db";
import { pgEmbeddings } from "@/lib/db/schema";
import {
  embeddingSearchQueries,
  rankEmbeddingHits,
  shouldSkipEmbeddingSearch,
  toIso,
} from "@/lib/store-logic";
import type {
  EmbeddingKind,
  EmbeddingSearchHit,
  EmbeddingSearchInput,
  EmbeddingSourceType,
} from "@/lib/types";

export async function searchUserEmbeddings(
  input: EmbeddingSearchInput,
): Promise<EmbeddingSearchHit[]> {
  if (shouldSkipEmbeddingSearch(input)) return [];

  const hits = (
    await Promise.all(
      embeddingSearchQueries(input).map((query) => searchUserEmbeddingsForQuery(input, query)),
    )
  ).flat();

  return rankEmbeddingHits(hits, input);
}

async function searchUserEmbeddingsForQuery(
  input: EmbeddingSearchInput,
  query: number[],
): Promise<EmbeddingSearchHit[]> {
  const distance = cosineDistance(pgEmbeddings.embedding, query);
  const similarity = sql<number>`1 - (${distance})`;
  const filters = [eq(pgEmbeddings.userId, input.userId)];
  if (input.kinds && input.kinds.length > 0) {
    filters.push(inArray(pgEmbeddings.kind, [...input.kinds]));
  }
  if (input.excludeSourceIds && input.excludeSourceIds.length > 0) {
    filters.push(notInArray(pgEmbeddings.sourceId, [...input.excludeSourceIds]));
  }

  const rows = await getNeonDb()
    .select({
      id: pgEmbeddings.id,
      userId: pgEmbeddings.userId,
      kind: pgEmbeddings.kind,
      sourceType: pgEmbeddings.sourceType,
      sourceId: pgEmbeddings.sourceId,
      turnId: pgEmbeddings.turnId,
      text: pgEmbeddings.text,
      createdAt: pgEmbeddings.createdAt,
      updatedAt: pgEmbeddings.updatedAt,
      score: similarity,
    })
    .from(pgEmbeddings)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(distance)
    .limit(input.limit);

  return rows.map((row) => ({
    record: {
      id: row.id,
      userId: row.userId,
      kind: row.kind as EmbeddingKind,
      sourceType: row.sourceType as EmbeddingSourceType,
      sourceId: row.sourceId,
      turnId: row.turnId,
      text: row.text,
      embedding: [],
      createdAt: toIso(row.createdAt) ?? "",
      updatedAt: toIso(row.updatedAt) ?? "",
    },
    score: Number(row.score),
  }));
}
