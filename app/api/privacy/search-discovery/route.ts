import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 15;

type SearchItem = {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
  page_age?: string;
  profile?: { long_name?: string; name?: string; url?: string };
};

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile?.organization_id) {
      return NextResponse.json({ error: "Your account is not connected to an organization." }, { status: 409 });
    }

    const apiKey = process.env.BRAVE_SEARCH_API_KEY;
    if (!apiKey) {
      return NextResponse.json({
        error: "Automated web discovery is not configured yet. Add BRAVE_SEARCH_API_KEY to the server environment to enable it.",
        code: "SEARCH_PROVIDER_NOT_CONFIGURED",
      }, { status: 503 });
    }

    const body = await request.json();
    const terms = Array.isArray(body?.terms)
      ? body.terms.filter((value: unknown): value is string => typeof value === "string")
          .map((value: string) => value.trim()).filter(Boolean).slice(0, 5)
      : [];
    if (!terms.length) return NextResponse.json({ error: "Enter at least one name, username, or phrase to search." }, { status: 400 });
    if (terms.some((term: string) => term.length > 100)) {
      return NextResponse.json({ error: "Each search term must be 100 characters or fewer." }, { status: 400 });
    }

    const searches = await Promise.all(terms.map(async (term: string) => {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", term);
      url.searchParams.set("count", "8");
      url.searchParams.set("safesearch", "moderate");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      try {
        const response = await fetch(url, {
          method: "GET",
          headers: { "X-Subscription-Token": apiKey, "Accept": "application/json" },
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            throw new Error("The configured web-search provider rejected its API key. Check BRAVE_SEARCH_API_KEY.");
          }
          if (response.status === 429) throw new Error("The web-search provider rate limit was reached. Try again later.");
          throw new Error(`The web-search provider returned HTTP ${response.status}.`);
        }
        const data = await response.json();
        const items: SearchItem[] = Array.isArray(data?.web?.results) ? data.web.results : [];
        return { term, results: items.map((item) => ({
          title: String(item.title ?? "Untitled result").slice(0, 300),
          url: typeof item.url === "string" ? item.url : "",
          description: String(item.description ?? "").slice(0, 1200),
          age: item.page_age ?? item.age ?? null,
          source: "Brave Search",
          matchType: "unverified_public_search_result",
          warning: "Search-result text is not proof that the result belongs to you. Open and verify before taking action.",
        })).filter((item) => {
          try { const parsed = new URL(item.url); return parsed.protocol === "https:" || parsed.protocol === "http:"; }
          catch { return false; }
        }) };
      } catch (error) {
        return { term, error: error instanceof Error ? error.message : "Search failed.", results: [] };
      } finally {
        clearTimeout(timer);
      }
    }));

    const unique = new Map<string, { title: string; url: string; description: string; age: string | null; source: string; matchedTerms: string[]; matchType: string; warning: string }>();
    for (const search of searches) {
      for (const item of search.results) {
        const existing = unique.get(item.url);
        if (existing) {
          if (!existing.matchedTerms.includes(search.term)) existing.matchedTerms.push(search.term);
        } else {
          unique.set(item.url, {
            title: item.title, url: item.url, description: item.description, age: item.age,
            source: item.source, matchedTerms: [search.term], matchType: item.matchType, warning: item.warning,
          });
        }
      }
    }
    return NextResponse.json({
      searchProvider: "Brave Search",
      termsSearched: terms,
      resultCount: unique.size,
      results: [...unique.values()].slice(0, 30),
      searchErrors: searches.filter((item) => item.error).map((item) => ({ term: item.term, error: item.error })),
      boundary: "These are third-party public search results, not a complete scan of the internet. Results can be outdated, duplicated, misleading, or unrelated. Manually verify ownership and relevance. No content was changed or deleted.",
    });
  } catch {
    return NextResponse.json({ error: "Unable to run automated public-web discovery." }, { status: 500 });
  }
}
