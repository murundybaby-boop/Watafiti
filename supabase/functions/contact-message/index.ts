import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });

  try {
    const body = await req.json();
    // Honeypot: genuine visitors leave this hidden field empty.
    if (typeof body.website === "string" && body.website.trim()) {
      return Response.json({ ok: true }, { headers: corsHeaders });
    }
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const phone = String(body.phone || "").trim();
    const subject = String(body.subject || "").trim();
    const message = String(body.message || "").trim();
    if (name.length < 2 || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        email.length > 254 || phone.length > 40 || subject.length < 2 || subject.length > 160 ||
        message.length < 5 || message.length > 5000) {
      return Response.json({ error: "Tafadhali kagua taarifa ulizojaza." }, { status: 400, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const recipient = Deno.env.get("CONTACT_EMAIL") || "Murundybaby@gmail.com";
    if (!supabaseUrl || !serviceKey) throw new Error("Supabase function secrets are not configured.");

    const supabase = createClient(supabaseUrl, serviceKey);
    const { error: saveError } = await supabase.from("contact_messages").insert({
      name, email, phone: phone || null, subject, message,
    });
    if (saveError) throw saveError;

    let emailSent = false;
    if (resendKey) {
      const emailResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": "Bearer " + resendKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "WATAFITI Website <onboarding@resend.dev>",
          to: [recipient],
          reply_to: email,
          subject: "[WATAFITI] " + subject,
          text: "Ujumbe mpya kutoka kwenye tovuti ya WATAFITI\n\nJina: " + name +
            "\nBarua pepe: " + email + "\nSimu: " + (phone || "Haijawekwa") +
            "\n\nMada: " + subject + "\n\nUjumbe:\n" + message,
        }),
      });
      emailSent = emailResponse.ok;
      if (!emailSent) console.error("Resend email failed:", await emailResponse.text());
    }
    return Response.json({ ok: true, saved: true, email_sent: emailSent }, { headers: corsHeaders });
  } catch (error) {
    console.error("contact-message error:", error);
    return Response.json({ error: "Ujumbe haukuweza kuhifadhiwa. Tafadhali jaribu tena baadaye." }, { status: 500, headers: corsHeaders });
  }
});
