import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Caller must be an active manager.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
  const { data: who } = await admin.auth.getUser(token);
  if (!who?.user) return json({ error: "unauthorized" }, 401);
  const { data: caller } = await admin.from("profiles").select("role, active").eq("id", who.user.id).single();
  if (!caller || !caller.active || caller.role !== "manager") return json({ error: "forbidden" }, 403);

  const { email, password, display_name, role } = await req.json().catch(() => ({}));
  if (typeof email !== "string" || !email.includes("@")) return json({ error: "invalid_email" }, 400);
  if (typeof password !== "string" || password.length < 8) return json({ error: "password_too_short" }, 400);
  if (role !== "manager" && role !== "staff") return json({ error: "invalid_role" }, 400);
  const name = typeof display_name === "string" && display_name.trim() ? display_name.trim() : email.split("@")[0];

  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { display_name: name },
  });
  if (error || !created.user) return json({ error: error?.message ?? "create_failed" }, 400);

  const { error: upErr } = await admin.from("profiles")
    .update({ active: true, role, display_name: name }).eq("id", created.user.id);
  if (upErr) return json({ error: upErr.message }, 500);

  return json({ id: created.user.id });
});
