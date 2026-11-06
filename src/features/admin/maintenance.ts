import "server-only";
import { createClient } from "@/lib/supabase/server";

export type EncodingFix = { table_name: string; column_name: string; row_id: string; before: string; after: string };
export type EncodingBatch = { id: string; created_at: string; created_by_name: string | null; rows_fixed: number; reverted_at: string | null };

/** Textos com acentuação corrompida e como ficariam (nada é alterado). */
export async function getEncodingPreview(limit = 500): Promise<EncodingFix[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_encoding_preview", { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as EncodingFix[];
}

export async function listEncodingBatches(): Promise<EncodingBatch[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_encoding_batches");
  if (error) throw error;
  return (data ?? []) as EncodingBatch[];
}
