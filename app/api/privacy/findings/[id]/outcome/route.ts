import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const allowedOutcomes = [
  "no_response",
  "needs_more_information",
  "request_accepted",
  "request_rejected",
  "content_removed_reported",
  "content_reappeared_reported",
] as const;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await context.params;
    const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).maybeSingle();
    if (!profile?.organization_id) return NextResponse.json({ error: "Your account is not connected to an organization." }, { status: 409 });

    const { data: finding, error: findingError } = await supabase.from("privacy_footprint_findings")
      .select("id").eq("id", id).eq("organization_id", profile.organization_id).maybeSingle();
    if (findingError) return NextResponse.json({ error: "Finding storage is unavailable." }, { status: 500 });
    if (!finding) return NextResponse.json({ error: "Finding not found in your organization." }, { status: 404 });

    const { data: outcomes, error } = await supabase.from("privacy_footprint_outcomes")
      .select("id,outcome,note,reported_at,reported_by")
      .eq("organization_id", profile.organization_id).eq("finding_id", id)
      .order("reported_at", { ascending: false }).limit(30);
    if (error) return NextResponse.json({ error: "Outcome history is unavailable. Apply the footprint outcome migration." }, { status: 500 });
    return NextResponse.json({ outcomes: outcomes ?? [], notice: "Entries are user-reported and are not independently verified." });
  } catch {
    return NextResponse.json({ error: "Unable to load outcome history." }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await context.params;
    let body: { outcome?: unknown; note?: unknown };
    try { body = await request.json(); } catch { return NextResponse.json({ error: "A valid JSON body is required." }, { status: 400 }); }
    if (typeof body?.outcome !== "string" || !(allowedOutcomes as readonly string[]).includes(body.outcome)) {
      return NextResponse.json({ error: "Choose a supported outcome." }, { status: 400 });
    }
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 1500) : "";
    if (["needs_more_information", "request_rejected", "content_removed_reported", "content_reappeared_reported"].includes(body.outcome) && !note) {
      return NextResponse.json({ error: "Add a short note so this outcome has context." }, { status: 400 });
    }
    const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).maybeSingle();
    if (!profile?.organization_id) return NextResponse.json({ error: "Your account is not connected to an organization." }, { status: 409 });
    const { data: finding, error: findingError } = await supabase.from("privacy_footprint_findings")
      .select("id").eq("id", id).eq("organization_id", profile.organization_id).maybeSingle();
    if (findingError) return NextResponse.json({ error: "Finding storage is unavailable." }, { status: 500 });
    if (!finding) return NextResponse.json({ error: "Finding not found in your organization." }, { status: 404 });

    const { data: outcome, error } = await supabase.from("privacy_footprint_outcomes").insert({
      organization_id: profile.organization_id, finding_id: id, reported_by: user.id,
      outcome: body.outcome, note,
    }).select("id,outcome,note,reported_at,reported_by").single();
    if (error) return NextResponse.json({ error: "Could not save this report. Apply the footprint outcome migration." }, { status: 500 });
    return NextResponse.json({
      outcome,
      notice: "Saved as a user-reported event. This does not contact the website or prove that content was removed; use a public-page verification check for a separate observation.",
    }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unable to record this outcome." }, { status: 500 });
  }
}
