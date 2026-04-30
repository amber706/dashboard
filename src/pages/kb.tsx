import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useQueryKb } from "@/lib/workspace-api-stub";

export default function KnowledgeBase() {
  const [query, setQuery] = useState("");
  const queryKb = useQueryKb();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    queryKb.mutate({ data: { query: trimmed } });
  };

  const sources = (queryKb.data?.sources ?? []) as Array<{
    id: string;
    title: string;
    category: string | null;
    similarity: number;
  }>;
  const topAnswer = queryKb.data?.answer;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Knowledge Base</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Search the Cornerstone admissions playbook. Results are ranked by semantic relevance.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask a question — e.g. what insurance does Cornerstone accept"
            className="flex-1"
          />
          <Button type="submit" disabled={queryKb.isPending || !query.trim()}>
            {queryKb.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            <span className="ml-2">Search</span>
          </Button>
        </form>

        {queryKb.error && (
          <Card className="border-destructive">
            <CardContent className="pt-6 text-sm text-destructive">
              {(queryKb.error as Error).message}
            </CardContent>
          </Card>
        )}

        {queryKb.isPending && (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Embedding query and searching…
            </CardContent>
          </Card>
        )}

        {queryKb.data && !queryKb.isPending && (
          <div className="space-y-4">
            {sources.length === 0 ? (
              <Card>
                <CardContent className="pt-6 text-sm text-muted-foreground">
                  No matching content found above the relevance threshold.
                </CardContent>
              </Card>
            ) : (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Top match</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm whitespace-pre-wrap">
                    {topAnswer}
                  </CardContent>
                </Card>

                <div>
                  <h2 className="text-sm font-semibold text-muted-foreground mb-2">
                    All ranked results ({sources.length})
                  </h2>
                  <div className="space-y-2">
                    {sources.map((s) => (
                      <Card key={s.id}>
                        <CardContent className="pt-4 pb-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-medium">{s.title}</div>
                              {s.category && (
                                <Badge variant="secondary" className="mt-1 text-xs">
                                  {s.category}
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground tabular-nums">
                              {(s.similarity * 100).toFixed(1)}% match
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
    </div>
  );
}
