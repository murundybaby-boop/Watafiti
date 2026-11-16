const SITE_ORIGIN = "https://murundybaby-boop.github.io";
const corsHeaders = {
  "Access-Control-Allow-Origin": SITE_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (origin && origin !== SITE_ORIGIN) return json({ error: "Chanzo cha ombi hakiruhusiwi." }, 403);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Njia ya ombi hairuhusiwi." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const openAiKey = Deno.env.get("OPENAI_API_KEY");
    const model = Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini";
    if (!supabaseUrl || !anonKey || !serviceKey || !openAiKey) {
      return json({ error: "Huduma ya AI bado haijakamilishwa. Tafadhali jaribu tena baadaye." }, 503);
    }

    const suppliedKey = req.headers.get("apikey") || "";
    if (suppliedKey !== anonKey) return json({ error: "Ombi halijathibitishwa." }, 401);

    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 8) {
      return json({ error: "Muundo wa swali si sahihi. Tafadhali jaribu tena." }, 400);
    }

    let totalLength = 0;
    const conversation: Array<{ role: "user" | "assistant"; content: string }> = [];
    for (const item of body.messages) {
      if (!item || !["user", "assistant"].includes(item.role) || typeof item.content !== "string") {
        return json({ error: "Ujumbe hauko kwenye muundo unaotakiwa." }, 400);
      }
      const content = item.content.trim();
      if (!content || content.length > 2500) return json({ error: "Kila ujumbe uwe na herufi zisizozidi 2,500." }, 400);
      totalLength += content.length;
      conversation.push({ role: item.role, content });
    }
    if (totalLength > 9000 || conversation[conversation.length - 1].role !== "user") {
      return json({ error: "Mazungumzo ni marefu sana au ujumbe wa mwisho si swali." }, 400);
    }

    const forwarded = req.headers.get("x-forwarded-for") || "";
    const ip = req.headers.get("cf-connecting-ip") || forwarded.split(",")[0].trim() || "unknown";
    const ipHash = await sha256(ip + ":" + serviceKey);
    const { data: allowed, error: limitError } = await createRateLimiter(supabaseUrl, serviceKey, ipHash);
    if (limitError) {
      console.error("WATAFITI AI rate-limit check failed:", limitError.message);
      return json({ error: "Huduma haipatikani kwa muda. Tafadhali jaribu tena." }, 503);
    }
    if (allowed !== true) return json({ error: "Umefikia kikomo cha maswali kwa muda mfupi. Tafadhali subiri dakika chache kisha ujaribu tena." }, 429);

    const systemPrompt = "Wewe ni WATAFITI AI, msaidizi wa elimu na utafiti wa jukwaa la WATAFITI nchini Tanzania. Jibu kwa lugha ambayo mtumiaji ametumia; pendelea Kiswahili sanifu ikiwa lugha haijabainika. Eleza kwa uwazi, kwa mpangilio na kwa mifano rahisi. Saidia maswali kuhusu sayansi, historia, jamii, teknolojia, elimu, utafiti na surveying. Kwa mada ngumu, gawanya maelezo katika hatua. Usibuni vyanzo, takwimu au nukuu. Ikiwa huna uhakika, sema hivyo na elekeza namna ya kuthibitisha. Usijidai kuwa umefanya utafutaji wa moja kwa moja wa mtandao au kuona nyaraka ambazo hujapewa. Kwa masuala ya afya, sheria au fedha, toa taarifa za jumla tu na eleza mipaka yake; usitoe uhakika wa kitaalamu. Usidai kuwa unawakilisha serikali au taasisi nyingine.";
    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + openAiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: systemPrompt }, ...conversation],
        max_tokens: 700,
        temperature: 0.4,
      }),
    });
    if (!aiResponse.ok) {
      console.error("OpenAI request failed with status:", aiResponse.status);
      return json({ error: "WATAFITI AI imeshindwa kupata jibu kwa sasa. Tafadhali jaribu tena." }, 502);
    }
    const result = await aiResponse.json();
    const reply = result?.choices?.[0]?.message?.content;
    if (typeof reply !== "string" || !reply.trim()) return json({ error: "Jibu halijapatikana. Tafadhali jaribu tena." }, 502);
    return json({ reply: reply.trim() });
  } catch (error) {
    console.error("WATAFITI AI error:", error instanceof Error ? error.message : "Unknown error");
    return json({ error: "Hitilafu imetokea. Tafadhali jaribu tena baadaye." }, 500);
  }
});

async function createRateLimiter(supabaseUrl: string, serviceKey: string, ipHash: string) {
  const response = await fetch(supabaseUrl + "/rest/v1/rpc/check_watafiti_ai_rate_limit", {
    method: "POST",
    headers: {
      "apikey": serviceKey,
      "Authorization": "Bearer " + serviceKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_ip_hash: ipHash, p_limit: 12, p_window_seconds: 900 }),
  });
  if (!response.ok) return { data: false, error: new Error("Rate-limit RPC returned " + response.status) };
  return { data: await response.json(), error: null };
}
