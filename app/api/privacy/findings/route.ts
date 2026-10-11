import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).maybeSingle();
    if (!profile?.organization_id) return NextResponse.json({ error: "Your account is not connected to an organization." }, { status: 409 });

    const { data, error } = await supabase.from("privacy_footprint_findings")
      .select("id,search_term,source_url,page_title,description,provider,page_age,review_status,discovered_at")
      .eq("organization_id", profile.organization_id)
      .order("discovered_at", { ascending: false }).limit(100);
    if (error) return NextResponse.json({ findings: [], configured: false, message: "Saved finding history is not available yet. Apply the privacy_footprint_findings migration." });
    return NextResponse.json({
      configured: true,
      findings: (data ?? []).map((row) => ({
        findingId: row.id, title: row.page_title, url: row.source_url, description: row.description,
        age: row.page_age, source: row.provider, matchedTerms: [row.search_term],
        matchType: "saved_public_search_finding", reviewStatus: row.review_status,
        discoveredAt: row.discovered_at,
        warning: "Saved public search result; manually verify identity and relevance.",
      })),
    });
  } catch {
    return NextResponse.json({ error: "Unable to load saved footprint findings." }, { status: 500 });
  }
}
