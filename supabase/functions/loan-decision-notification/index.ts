import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://murundybaby-boop.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function normalizeTanzaniaPhone(value: string): string {
  let digits = value.replace(/[^0-9]/g, "");
  if (digits.startsWith("0")) digits = "255" + digits.slice(1);
  if (!digits.startsWith("255")) throw new Error("Namba ya simu lazima iwe ya Tanzania (+255).");
  if (digits.length !== 12) throw new Error("Namba ya simu haionekani kuwa sahihi.");
  return "+" + digits;
}

async function sendTwilioMessage(to: string, body: string, from: string, sid: string, token: string) {
  const form = new URLSearchParams({ To: to, From: from, Body: body });
  const response = await fetch("https://api.twilio.com/2010-04-01/Accounts/" + sid + "/Messages.json", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + btoa(sid + ":" + token),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("Twilio imeshindwa kutuma ujumbe (" + response.status + ").");
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const smsFrom = Deno.env.get("TWILIO_SMS_FROM");
    const whatsappFrom = Deno.env.get("TWILIO_WHATSAPP_FROM");
    if (!supabaseUrl || !anonKey || !serviceKey) throw new Error("Supabase secrets hazijakamilika.");
    if (!sid || !twilioToken || !smsFrom || !whatsappFrom) {
      return Response.json({ error: "Ujumbe haujatumwa: akaunti ya kutuma SMS na WhatsApp haijaunganishwa bado." }, { status: 503, headers: corsHeaders });
    }

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return Response.json({ error: "Ingia kama msimamizi kwanza." }, { status: 401, headers: corsHeaders });
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return Response.json({ error: "Uthibitisho wa msimamizi umeshindikana." }, { status: 401, headers: corsHeaders });

    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: admin, error: adminError } = await adminClient.from("admin_users").select("user_id").eq("user_id", authData.user.id).maybeSingle();
    if (adminError || !admin) return Response.json({ error: "Akaunti hii haina ruhusa ya msimamizi." }, { status: 403, headers: corsHeaders });

    const body = await req.json();
    const applicationId = Number(body.application_id);
    const status = String(body.status || "");
    if (!Number.isSafeInteger(applicationId) || applicationId < 1 || !["approved", "declined"].includes(status)) {
      return Response.json({ error: "Taarifa za uamuzi si sahihi." }, { status: 400, headers: corsHeaders });
    }

    const { data: loan, error: loanError } = await adminClient.from("loan_applications")
      .select("id,full_name,phone,amount,status").eq("id", applicationId).maybeSingle();
    if (loanError || !loan) return Response.json({ error: "Ombi la mkopo halijapatikana." }, { status: 404, headers: corsHeaders });
    if (loan.status !== status) return Response.json({ error: "Hali ya ombi haijathibitishwa kwenye hifadhidata. Sasisha ombi kisha jaribu tena." }, { status: 409, headers: corsHeaders });

    const phone = normalizeTanzaniaPhone(String(loan.phone || ""));
    const amount = Number(loan.amount || 0).toLocaleString("en-US");
    const message = status === "approved"
      ? "Habari " + (loan.full_name || "mteja") + ", ombi lako la WATAFITI LOAN la TSh " + amount + " limeidhinishwa kwa hatua inayofuata. Tafadhali wasiliana na WATAFITI LOAN kuthibitisha masharti ya mwisho kabla ya makubaliano."
      : "Habari " + (loan.full_name || "mteja") + ", asante kwa kuomba WATAFITI LOAN. Kwa sasa ombi lako la TSh " + amount + " halijaidhinishwa. Wasiliana nasi ikiwa unahitaji ufafanuzi. Asante.";

    const results: Record<string, string> = {};
    const errors: string[] = [];
    try { await sendTwilioMessage(phone, message, smsFrom, sid, twilioToken); results.sms = "sent"; }
    catch (e) { results.sms = "failed"; errors.push("SMS: " + (e instanceof Error ? e.message : "hitilafu")); }
    try {
      const waFrom = whatsappFrom.startsWith("whatsapp:") ? whatsappFrom : "whatsapp:" + whatsappFrom;
      await sendTwilioMessage("whatsapp:" + phone, message, waFrom, sid, twilioToken);
      results.whatsapp = "sent";
    } catch (e) { results.whatsapp = "failed"; errors.push("WhatsApp: " + (e instanceof Error ? e.message : "hitilafu")); }

    return Response.json({ ok: errors.length === 0, results, message: errors.length ? errors.join(" ") : "SMS na WhatsApp zimetumwa kwa huduma ya ujumbe." }, { status: errors.length ? 502 : 200, headers: corsHeaders });
  } catch (error) {
    console.error("loan-decision-notification error:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Hitilafu imetokea wakati wa kutuma ujumbe." }, { status: 500, headers: corsHeaders });
  }
});
