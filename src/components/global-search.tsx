import { useEffect, useState, useRef } from "react";
import { useLocation } from "wouter";
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty,
  CommandGroup, CommandItem,
} from "@/components/ui/command";
import { User as UserIcon, Phone, BookOpen, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface LeadHit {
  id: string;
  first_name: string | null;
  last_name: string | null;
  primary_phone_normalized: string | null;
  email: string | null;
  outcome_category: string | null;
}

interface CallHit {
  id: string;
  ctm_call_id: string;
  caller_name: string | null;
  caller_phone_normalized: string | null;
  started_at: string | null;
  status: string;
}

interface KbHit {
  id: string;
  title: string;
  category: string | null;
}

// Normalize a phone-shaped query: pull just the digits and prefix +1 if
// it looks like a US 10-digit number. Lets the user paste any format.
function normalizePhoneQuery(q: string): string | null {
  const digits = q.replace(/\D/g, "");
  if (digits.length < 7) return null;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

function fmtTime(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [, navigate] = useLocation();
  const [q, setQ] = useState("");
  const [leads, setLeads] = useState<LeadHit[]>([]);
  const [calls, setCalls] = useState<CallHit[]>([]);
  const [kb, setKb] = useState<KbHit[]>([]);
  const [searching, setSearching] = useState(false);
  const lastQueryRef = useRef<string>("");

  // Debounced search across leads, call_sessions, and kb_documents.
  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setLeads([]); setCalls([]); setKb([]);
      return;
    }
    const t = setTimeout(async () => {
      if (trimmed === lastQueryRef.current) return;
      lastQueryRef.current = trimmed;
      setSearching(true);

      const phone = normalizePhoneQuery(trimmed);
      const namePat = `%${trimmed}%`;

      const leadFilter = phone
        ? `primary_phone_normalized.eq.${phone},first_name.ilike.${namePat},last_name.ilike.${namePat},email.ilike.${namePat}`
        : `first_name.ilike.${namePat},last_name.ilike.${namePat},email.ilike.${namePat}`;

      const callFilter = phone
        ? `caller_phone_normalized.eq.${phone},caller_name.ilike.${namePat},ctm_call_id.eq.${trimmed}`
        : `caller_name.ilike.${namePat},ctm_call_id.eq.${trimmed}`;

      const [leadsRes, callsRes, kbRes] = await Promise.all([
        supabase
          .from("leads")
          .select("id, first_name, last_name, primary_phone_normalized, email, outcome_category")
          .or(leadFilter)
          .limit(6),
        supabase
          .from("call_sessions")
          .select("id, ctm_call_id, caller_name, caller_phone_normalized, started_at, status")
          .or(callFilter)
          .order("started_at", { ascending: false, nullsFirst: false })
          .limit(8),
        supabase
          .from("kb_documents")
          .select("id, title, category")
          .ilike("title", namePat)
          .limit(5),
      ]);

      setLeads((leadsRes.data ?? []) as LeadHit[]);
      setCalls((callsRes.data ?? []) as CallHit[]);
      setKb((kbRes.data ?? []) as KbHit[]);
      setSearching(false);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  function go(path: string) {
    onOpenChange(false);
    setTimeout(() => {
      setQ("");
      navigate(path);
    }, 50);
  }

  const hasResults = leads.length + calls.length + kb.length > 0;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        value={q}
        onValueChange={setQ}
        placeholder="Search leads, calls, or KB articles… (paste a phone number, name, or CTM call ID)"
      />
      <CommandList>
        {q.trim().length < 2 && (
          <CommandEmpty>Start typing to search.</CommandEmpty>
        )}
        {q.trim().length >= 2 && !searching && !hasResults && (
          <CommandEmpty>No results.</CommandEmpty>
        )}

        {leads.length > 0 && (
          <CommandGroup heading="Leads">
            {leads.map((l) => {
              const name = [l.first_name, l.last_name].filter(Boolean).join(" ") || l.primary_phone_normalized || "Unknown";
              return (
                <CommandItem key={l.id} value={`lead-${l.id}`} onSelect={() => go(`/leads/${l.id}`)}>
                  <UserIcon className="w-4 h-4 mr-2 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm">{name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {l.primary_phone_normalized ?? l.email ?? "—"}
                      {l.outcome_category && l.outcome_category !== "in_progress" && (
                        <span className="ml-2">· {l.outcome_category}</span>
                      )}
                    </div>
                  </div>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {calls.length > 0 && (
          <CommandGroup heading="Calls">
            {calls.map((c) => {
              const name = c.caller_name ?? c.caller_phone_normalized ?? `CTM ${c.ctm_call_id}`;
              return (
                <CommandItem key={c.id} value={`call-${c.id}`} onSelect={() => go(`/live/${c.id}`)}>
                  <Phone className="w-4 h-4 mr-2 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {fmtTime(c.started_at)} · {c.status}
                    </div>
                  </div>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {kb.length > 0 && (
          <CommandGroup heading="Knowledge base">
            {kb.map((k) => (
              <CommandItem key={k.id} value={`kb-${k.id}`} onSelect={() => go(`/kb`)}>
                <BookOpen className="w-4 h-4 mr-2 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{k.title}</div>
                  {k.category && (
                    <div className="text-xs text-muted-foreground">{k.category}</div>
                  )}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {searching && (
          <div className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
            <Search className="w-3 h-3 animate-pulse" /> Searching…
          </div>
        )}
      </CommandList>
    </CommandDialog>
  );
}
