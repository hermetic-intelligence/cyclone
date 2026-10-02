import { createClient } from "@supabase/supabase-js";
export const CLOUD_URL = "https://dalyamgpwkllgwwfywpq.supabase.co";
export const CLOUD_KEY = "sb_publishable_15b21h1aMNKJohsGZzhY-w_SKHTE2v_";
export const supabase = createClient(CLOUD_URL, CLOUD_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});
export async function cloudSession() {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session;
  const result = await supabase.auth.signInAnonymously();
  if (result.error || !result.data.session) throw new Error(result.error?.message ?? "Could not authenticate Cyclone.");
  return result.data.session;
}
