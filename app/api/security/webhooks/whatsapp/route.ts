import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeSecurityEvent } from "@/lib/security/normalize";
import { runSecurityAnalysis } from "@/lib/security/analysis";

async function sign(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)))).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function equal(a:string,b:string){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}

export async function GET(request: Request) {
  const u=new URL(request.url);
  const expected=process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  const token=u.searchParams.get("hub.verify_token")||"";
  const challenge=u.searchParams.get("hub.challenge");
  if(u.searchParams.get("hub.mode")!=="subscribe"||!challenge)return new NextResponse("Bad request",{status:400});
  if(!expected||!equal(token,expected))return new NextResponse("Forbidden",{status:403});
  return new NextResponse(challenge);
}

export async function POST(request: Request) {
  try {
    const secret=process.env.META_APP_SECRET;
    if(!secret)return NextResponse.json({error:"Meta webhook verification is not configured."},{status:503});
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 1_000_000) return NextResponse.json({ error: "Webhook payload is too large." }, { status: 413 });
    const raw=await request.text();
    if(raw.length>1000000)return NextResponse.json({error:"Webhook payload is too large."},{status:413});
    const signature=request.headers.get("x-hub-signature-256")||"";
    if(!equal(signature,"sha256="+await sign(secret,raw)))return NextResponse.json({error:"Invalid Meta webhook signature."},{status:401});
    const body=JSON.parse(raw) as Record<string,unknown>;
    if(body.object!=="whatsapp_business_account")return NextResponse.json({accepted:true,ignored:true});
    const admin=createAdminClient();
    let ingested=0;
    const affectedOrganizations = new Set<string>();
    for(const entry of Array.isArray(body.entry)?body.entry:[]) {
      if(!entry||typeof entry!=="object"||Array.isArray(entry))continue;
      const e=entry as Record<string,unknown>;
      const wabaId=typeof e.id==="string"?e.id:"";
      const changes=Array.isArray(e.changes)?e.changes:[];
      if(!wabaId)continue;
      const {data: integrations}=await admin.from("security_integrations").select("id,organization_id,configuration").eq("provider","WhatsApp Business").eq("integration_type","whatsapp");
      for(const integration of integrations||[]) {
        const cfg=integration.configuration&&typeof integration.configuration==="object"&&!Array.isArray(integration.configuration)?integration.configuration as Record<string,unknown>:{};
        const auth=cfg.authorization&&typeof cfg.authorization==="object"&&!Array.isArray(cfg.authorization)?cfg.authorization as Record<string,unknown>:{};
        const sel=auth.asset_selection&&typeof auth.asset_selection==="object"&&!Array.isArray(auth.asset_selection)?auth.asset_selection as Record<string,unknown>:{};
        if(sel.waba_id!==wabaId||sel.verified!==true)continue;
        for(const change of changes) {
          if(!change||typeof change!=="object"||Array.isArray(change))continue;
          const c=change as Record<string,unknown>;
          const value=c.value&&typeof c.value==="object"&&!Array.isArray(c.value)?c.value as Record<string,unknown>:{};
          const meta=value.metadata&&typeof value.metadata==="object"&&!Array.isArray(value.metadata)?value.metadata as Record<string,unknown>:{};
          if(meta.phone_number_id!==sel.phone_number_id)continue;
          const messageIds = Array.isArray(value.messages)
            ? value.messages.map((message) =>
                message && typeof message === "object" && !Array.isArray(message) && typeof (message as Record<string, unknown>).id === "string"
                  ? (message as Record<string, unknown>).id
                  : null,
              ).filter((id): id is string => Boolean(id))
            : [];
          const statusIds = Array.isArray(value.statuses)
            ? value.statuses.map((status) =>
                status && typeof status === "object" && !Array.isArray(status) && typeof (status as Record<string, unknown>).id === "string"
                  ? (status as Record<string, unknown>).id
                  : null,
              ).filter((id): id is string => Boolean(id))
            : [];
          const field=typeof c.field==="string"?c.field:"unknown";
          const providerEventId = [...messageIds, ...statusIds].join(",");
          const fingerprint=await sign(secret,providerEventId
            ? wabaId+":"+String(meta.phone_number_id)+":"+field+":"+providerEventId
            : wabaId+":"+String(meta.phone_number_id)+":"+field+":"+JSON.stringify(value));
          const {data:dupe}=await admin.from("security_evidence").select("id").eq("organization_id",integration.organization_id).eq("source","whatsapp_events").contains("data",{webhook_fingerprint:fingerprint}).limit(1).maybeSingle();
          if(dupe)continue;
          const title="WhatsApp event: "+field;
          const summary=JSON.stringify(value).slice(0,5000);
          const normalized=normalizeSecurityEvent({event_type:"whatsapp."+field,severity:"info",source:"whatsapp_events",title,description:summary,observed_at:new Date().toISOString(),indicators:[]});
          const {data:evidence}=await admin.from("security_evidence").insert({organization_id:integration.organization_id,evidence_type:"application",source:"whatsapp_events",title,summary,data:{webhook_fingerprint:fingerprint,waba_id:wabaId,phone_number_id:meta.phone_number_id,field,payload:value},observed_at:normalized.observedAt}).select("id").single();
          if(!evidence)continue;
          await admin.from("security_events").insert({organization_id:integration.organization_id,event_type:normalized.eventType,severity:normalized.severity,source:normalized.source,title:normalized.title,description:normalized.description,observed_at:normalized.observedAt,evidence:{evidence_id:evidence.id,provider:"whatsapp",waba_id:wabaId,phone_number_id:meta.phone_number_id},raw_reference:evidence.id});
          await admin.from("security_integrations").update({status:"connected",last_sync_at:normalized.observedAt,configuration:{...cfg,connection_state:"ingestion_active",last_ingestion_at:new Date().toISOString()}}).eq("id",integration.id);
          affectedOrganizations.add(integration.organization_id);
          ingested++;
        }

      }
    }
    const analysisResults: Array<{ organizationId: string; triggered: boolean }> = [];
    for (const organizationId of affectedOrganizations) {
      try {
        await runSecurityAnalysis(admin, organizationId);
        analysisResults.push({ organizationId, triggered: true });
      } catch {
        analysisResults.push({ organizationId, triggered: false });
      }
    }
    return NextResponse.json({ accepted: true, ingested, analysis: analysisResults });
  } catch { return NextResponse.json({error:"Invalid WhatsApp webhook request."},{status:400}); }
}