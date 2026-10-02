import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { handler } from "./handler.ts";
import type { Reservation } from "./handler.ts";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
Deno.serve(handler({
  apiKey: Deno.env.get("OPENAI_API_KEY"),
  authenticate: async token => { const { data, error } = await admin.auth.getUser(token); return error ? null : data.user?.id ?? null; },
  reserve: async (user, id, micros) => {
    const { data, error } = await admin.rpc("reserve_transcription", { p_user: user, p_id: id, p_micros: micros });
    if (error) throw error; return data as Reservation;
  },
  finish: async (user, id, text, error) => {
    const { error: failure } = await admin.rpc("finish_transcription", { p_user: user, p_id: id, p_text: text, p_error: error });
    if (failure) throw failure;
  }
}));
