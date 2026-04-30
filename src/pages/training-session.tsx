import { useEffect, useRef, useState } from "react";
import { useRoute, Link } from "wouter";
import { ArrowLeft, Loader2, Send, AlertTriangle, Shield } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

interface Scenario {
  id: string;
  title: string;
  description: string | null;
  difficulty: "entry" | "intermediate" | "advanced";
  is_crisis_tagged: boolean;
  involves_minors: boolean;
  programs: string[] | null;
  persona: any;
  context: any;
}

interface Message {
  role: "specialist" | "caller";
  content: string;
}

export default function TrainingSession() {
  const [, params] = useRoute<{ id: string }>("/training/:id");
  const scenarioId = params?.id;

  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [loadingScenario, setLoadingScenario] = useState(true);
  const [scenarioError, setScenarioError] = useState<string | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [turnError, setTurnError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scenarioId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("training_scenarios")
        .select("id, title, description, difficulty, is_crisis_tagged, involves_minors, programs, persona, context")
        .eq("id", scenarioId)
        .maybeSingle();
      if (cancelled) return;
      if (error) setScenarioError(error.message);
      else if (!data) setScenarioError("Scenario not found");
      else setScenario(data as Scenario);
      setLoadingScenario(false);
    })();
    return () => { cancelled = true; };
  }, [scenarioId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  async function sendTurn() {
    const text = draft.trim();
    if (!text || thinking || !scenarioId) return;
    setTurnError(null);
    const newSpecialist: Message = { role: "specialist", content: text };
    const historyForCall = [...messages];
    setMessages((m) => [...m, newSpecialist]);
    setDraft("");
    setThinking(true);

    try {
      const { data, error } = await supabase.functions.invoke("roleplay-turn", {
        body: {
          scenario_id: scenarioId,
          history: historyForCall,
          specialist_message: text,
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error ?? "roleplay-turn failed");
      const callerMessage = String(data.caller_message ?? "");
      setMessages((m) => [...m, { role: "caller", content: callerMessage }]);
    } catch (e) {
      setTurnError(e instanceof Error ? e.message : String(e));
      // Roll back the optimistic specialist add so they can retry
      setMessages((m) => m.slice(0, -1));
      setDraft(text);
    } finally {
      setThinking(false);
    }
  }

  if (loadingScenario) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <Card><CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading scenario…
        </CardContent></Card>
      </div>
    );
  }

  if (scenarioError || !scenario) {
    return (
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <Link href="/training" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back to scenarios
        </Link>
        <Card className="border-destructive"><CardContent className="pt-6 text-sm text-destructive">
          {scenarioError ?? "Scenario not found"}
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <Link href="/training" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Back to scenarios
      </Link>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-lg">{scenario.title}</CardTitle>
              {scenario.description && (
                <p className="text-sm text-muted-foreground mt-1">{scenario.description}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="secondary">{scenario.difficulty}</Badge>
              {scenario.is_crisis_tagged && (
                <Badge variant="outline" className="gap-1"><AlertTriangle className="w-3 h-3" /> crisis</Badge>
              )}
              {scenario.involves_minors && (
                <Badge variant="outline" className="gap-1"><Shield className="w-3 h-3" /> minor</Badge>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div ref={scrollRef} className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
            {messages.length === 0 && (
              <p className="text-sm text-muted-foreground italic text-center py-8">
                Start the conversation. The caller is on the line — open with however you'd answer a real call.
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "specialist" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                    m.role === "specialist"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  <div className="text-xs opacity-70 mb-0.5">{m.role === "specialist" ? "You" : "Caller"}</div>
                  {m.content}
                </div>
              </div>
            ))}
            {thinking && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-3 py-2 text-sm flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" /> Caller is thinking…
                </div>
              </div>
            )}
          </div>

          {turnError && (
            <div className="mt-3 text-xs text-destructive">{turnError}</div>
          )}

          <div className="mt-4 flex gap-2 items-end">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  sendTurn();
                }
              }}
              placeholder="Type what you'd say to the caller — Cmd+Enter to send"
              rows={3}
              className="flex-1 resize-none"
              disabled={thinking}
            />
            <Button onClick={sendTurn} disabled={thinking || !draft.trim()}>
              {thinking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
