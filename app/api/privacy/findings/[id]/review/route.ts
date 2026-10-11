import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const allowedStatuses = ["confirmed_relevant", "not_relevant", "removal_requested"] as const;

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await context.params;
    const body = await request.json();
    if (typeof body?.status !== "string" || !(allowedStatuses as readonly string[]).includes(body.status)) {
      return NextResponse.json({ error: "Choose a supported review status." }, { status: 400 });
    }
    const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : null;
    const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).maybeSingle();
    if (!profile?.organization_id) return NextResponse.json({ error: "Your account is not connected to an organization." }, { status: 409 });
    const { data, error } = await supabase.from("privacy_footprint_findings")
      .update({ review_status: body.status, review_note: note, reviewed_at: new Date().toISOString() })
      .eq("id", id).eq("organization_id", profile.organization_id)
      .select("id,review_status,review_note,reviewed_at").maybeSingle();
    if (error) return NextResponse.json({ error: "Could not save the review. Confirm the privacy_footprint_findings migration has been applied." }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Finding not found in your organization." }, { status: 404 });
    return NextResponse.json({ finding: data });
  } catch {
    return NextResponse.json({ error: "Unable to update the finding review." }, { status: 500 });
  }
}
