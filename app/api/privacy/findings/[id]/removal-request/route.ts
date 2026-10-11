import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await context.params;
    const body = await request.json();
    const explanation = typeof body?.explanation === "string" ? body.explanation.trim().slice(0, 1500) : "";
    if (!explanation) return NextResponse.json({ error: "Explain briefly why you are requesting removal or correction." }, { status: 400 });
    const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).maybeSingle();
    if (!profile?.organization_id) return NextResponse.json({ error: "Your account is not connected to an organization." }, { status: 409 });

    const { data: finding, error } = await supabase.from("privacy_footprint_findings")
      .select("source_url,page_title,search_term,review_status")
      .eq("id", id).eq("organization_id", profile.organization_id).maybeSingle();
    if (error) return NextResponse.json({ error: "Saved finding history is not available. Confirm the database migration is applied." }, { status: 500 });
    if (!finding) return NextResponse.json({ error: "Finding not found in your organization." }, { status: 404 });

    const host = new URL(finding.source_url).hostname;
    const draft = [
      "Subject: Request to review and remove or correct personal information",
      "",
      "Hello,",
      "",
      "I am contacting you about content published at the URL below:",
      finding.source_url,
      "",
      `Page title: ${finding.page_title || "Not provided"}`,
      "",
      "I believe this content may relate to me and would like your team to review it.",
      `Reason for this request: ${explanation}`,
      "",
      "Please let me know whether the content can be removed, corrected, or restricted under your applicable privacy policy and procedures. If you need additional information to verify my identity or authority, please tell me what is required through your official process.",
      "",
      "I have not included passwords or identity documents in this message. I can provide appropriate verification through a secure, official channel if needed.",
      "",
      "Thank you.",
      "[Your name]",
      "",
      `Destination to identify: ${host}`,
    ].join("\n");

    return NextResponse.json({
      draft,
      finding: { url: finding.source_url, title: finding.page_title, reviewStatus: finding.review_status },
      notice: "Draft only. Nothing has been sent, and the finding status has not changed. Review accuracy and use the website's official privacy, support, or removal channel. Do not send sensitive identity documents unless the official process requires them and you trust the channel.",
    });
  } catch {
    return NextResponse.json({ error: "Unable to prepare a removal request draft." }, { status: 500 });
  }
}
