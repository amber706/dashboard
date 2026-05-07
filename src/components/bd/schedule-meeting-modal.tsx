// ScheduleMeetingModal — schedule a new BD meeting via two-way sync.
//
// On submit we POST to bd-meeting-write which:
//   1. INSERTs into public.meeting_records with sync_status='pending_zoho_create'
//   2. Pushes to Zoho POST /crm/v6/Events
//   3. Updates the row → sync_status='synced' + zoho_event_id
//
// If Zoho is down, the row stays as pending and the user gets a
// 'Meeting saved locally — Zoho sync pending' toast. The retry happens
// when the user reopens the page (or via a future cron).
//
// Account picker uses the existing bd-account-search edge function
// (typeahead). Contact list is the account's business_contacts pulled
// from bd-account-detail when an account is selected.

import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Search, Building2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

interface AccountResult { id: string; name: string; type: string | null }
interface ContactResult { id: string; name: string; email: string | null }

// Subset of public.meeting_records that the modal needs to prefill an
// edit. Caller passes this when re-opening the modal to update an
// existing meeting; the modal switches to action="update" + reuses
// the same form.
export interface EditingMeetingRecord {
  id: string;                     // local meeting_records.id
  title: string;
  description: string | null;
  start_at: string;               // ISO
  end_at: string | null;
  venue: string | null;
  account_zoho_id: string | null;
  account_name: string | null;
  contact_zoho_id: string | null;
  contact_name: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScheduled?: () => void;
  // Pre-fill an account when launched from /bd/account or stuck-accounts.
  initialAccount?: { id: string; name: string } | null;
  // When set, the modal opens in edit mode — title says "Edit meeting",
  // submit dispatches action="update", and all fields prefill from this
  // record.
  editingRecord?: EditingMeetingRecord | null;
}

export function ScheduleMeetingModal({ open, onOpenChange, onScheduled, initialAccount, editingRecord }: Props) {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  // Form state.
  const [title, setTitle] = useState("");
  const [startAt, setStartAt] = useState(() => defaultStart());
  const [durationMin, setDurationMin] = useState(30);
  const [venue, setVenue] = useState("");
  const [description, setDescription] = useState("");

  // Account picker.
  const [accountQuery, setAccountQuery] = useState(initialAccount?.name ?? "");
  const [accountResults, setAccountResults] = useState<AccountResult[]>([]);
  const [accountSearching, setAccountSearching] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<AccountResult | null>(initialAccount ? { id: initialAccount.id, name: initialAccount.name, type: null } : null);

  // Contacts at the selected account.
  const [contacts, setContacts] = useState<ContactResult[]>([]);
  const [selectedContact, setSelectedContact] = useState<ContactResult | null>(null);

  // Reset / prefill the form whenever the modal opens or the record
  // changes. Edit mode hydrates from `editingRecord`; create mode
  // resets to empty defaults.
  useEffect(() => {
    if (!open) return;
    if (editingRecord) {
      setTitle(editingRecord.title);
      setStartAt(toLocalDatetimeInput(editingRecord.start_at));
      const startMs = new Date(editingRecord.start_at).getTime();
      const endMs = editingRecord.end_at ? new Date(editingRecord.end_at).getTime() : startMs + 30 * 60_000;
      setDurationMin(Math.max(15, Math.min(480, Math.round((endMs - startMs) / 60_000) || 30)));
      setVenue(editingRecord.venue ?? "");
      setDescription(editingRecord.description ?? "");
      if (editingRecord.account_zoho_id && editingRecord.account_name) {
        setSelectedAccount({ id: editingRecord.account_zoho_id, name: editingRecord.account_name, type: null });
        setAccountQuery(editingRecord.account_name);
      } else {
        setSelectedAccount(null);
        setAccountQuery("");
      }
      // Contact prefill happens later when the contacts load triggers
      // off the selected account; keep its id so we can match it.
      if (editingRecord.contact_zoho_id) {
        setSelectedContact({
          id: editingRecord.contact_zoho_id,
          name: editingRecord.contact_name ?? "",
          email: null,
        });
      } else {
        setSelectedContact(null);
      }
    } else {
      // create mode
      setTitle("");
      setStartAt(defaultStart());
      setDurationMin(30);
      setVenue("");
      setDescription("");
      setAccountQuery(initialAccount?.name ?? "");
      setAccountResults([]);
      setSelectedAccount(initialAccount ? { id: initialAccount.id, name: initialAccount.name, type: null } : null);
      setContacts([]);
      setSelectedContact(null);
    }
  }, [open, initialAccount, editingRecord]);

  // Debounced account search.
  useEffect(() => {
    if (!accountQuery.trim() || selectedAccount) { setAccountResults([]); return; }
    const t = setTimeout(async () => {
      setAccountSearching(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bd-account-search`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ q: accountQuery, limit: 10 }),
        });
        const j = await res.json();
        if (j.ok) setAccountResults(j.accounts ?? []);
      } finally { setAccountSearching(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [accountQuery, selectedAccount]);

  // When an account is picked, pull its business contacts so the user
  // can select a Who_Id without leaving the modal.
  useEffect(() => {
    if (!selectedAccount) { setContacts([]); setSelectedContact(null); return; }
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bd-account-detail`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ account_id: selectedAccount.id, days: 365 }),
      });
      const j = await res.json();
      if (j.ok) {
        setContacts((j.business_contacts ?? []).map((c: any) => ({ id: c.id, name: c.name, email: c.email })));
      }
    })();
  }, [selectedAccount]);

  async function handleSubmit() {
    if (!title.trim()) {
      toast({ title: "Title required", description: "Give the meeting a title before saving." });
      return;
    }
    if (!startAt) {
      toast({ title: "Start time required", description: "Pick a date and time." });
      return;
    }
    setSubmitting(true);
    try {
      const start = new Date(startAt);
      const end = new Date(start.getTime() + durationMin * 60_000);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bd-meeting-write`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          action: editingRecord ? "update" : "create",
          id: editingRecord?.id,
          title: title.trim(),
          start_at: start.toISOString(),
          end_at: end.toISOString(),
          venue: venue.trim() || null,
          description: description.trim() || null,
          account_zoho_id: selectedAccount?.id ?? null,
          account_name: selectedAccount?.name ?? null,
          contact_zoho_id: selectedContact?.id ?? null,
          contact_name: selectedContact?.name ?? null,
        }),
      });
      const j = await res.json();
      if (!j.ok) {
        toast({ title: "Couldn't schedule meeting", description: j.error ?? "Unknown error", variant: "destructive" });
        setSubmitting(false);
        return;
      }
      // Success can mean two things:
      //   sync_status === 'synced'        — pushed to Zoho cleanly
      //   sync_status === 'pending_*'     — saved locally, Zoho push failed
      const verb = editingRecord ? "updated" : "scheduled";
      if (j.sync_status === "synced") {
        toast({ title: `Meeting ${verb}`, description: `Pushed to Zoho. It'll appear in the list on next refresh.` });
      } else {
        toast({
          title: `Saved locally — Zoho sync pending`,
          description: j.sync_error ?? "We'll retry the Zoho push automatically.",
          variant: "destructive",
        });
      }
      onOpenChange(false);
      onScheduled?.();
    } catch (e) {
      toast({ title: "Couldn't schedule meeting", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editingRecord ? "Edit meeting" : "Schedule a meeting"}</DialogTitle>
          <DialogDescription>
            {editingRecord
              ? "Edits push to Zoho. If the Zoho update fails, the local copy still saves and we'll retry."
              : "Saved locally first, then pushed to Zoho. If the Zoho push fails, the meeting still saves and we'll retry — you'll see a sync-error badge on the row until it lands."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="mtg-title" className="text-xs">Title</Label>
            <Input id="mtg-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Drop by Calvary intake team" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mtg-start" className="text-xs">Start</Label>
              <Input id="mtg-start" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mtg-dur" className="text-xs">Duration (min)</Label>
              <Input id="mtg-dur" type="number" min={15} max={480} step={15} value={durationMin} onChange={(e) => setDurationMin(Math.max(15, Math.min(480, Number(e.target.value) || 30)))} />
            </div>
          </div>

          {/* Account picker */}
          <div className="space-y-1.5">
            <Label className="text-xs">Account (optional)</Label>
            {selectedAccount ? (
              <div className="flex items-center justify-between gap-2 border rounded-md px-3 py-2 bg-muted/30">
                <div className="flex items-center gap-2 min-w-0">
                  <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium truncate">{selectedAccount.name}</span>
                </div>
                <button
                  type="button"
                  onClick={() => { setSelectedAccount(null); setSelectedContact(null); setAccountQuery(""); }}
                  className="text-muted-foreground hover:text-foreground shrink-0"
                  aria-label="Clear account"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  value={accountQuery}
                  onChange={(e) => setAccountQuery(e.target.value)}
                  placeholder="Search a referring company…"
                  className="pl-9 h-9 text-sm"
                />
                {accountSearching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                {accountResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full border rounded-md bg-background shadow-md max-h-60 overflow-y-auto">
                    {accountResults.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => { setSelectedAccount(a); setAccountResults([]); setAccountQuery(a.name); }}
                        className="w-full text-left px-3 py-1.5 hover:bg-accent/40 text-sm border-b last:border-b-0"
                      >
                        <div className="font-medium truncate">{a.name}</div>
                        {a.type && <div className="text-[10px] text-muted-foreground">{a.type}</div>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Contact picker — only available once an account is chosen */}
          {selectedAccount && contacts.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Contact (optional)</Label>
              <select
                value={selectedContact?.id ?? ""}
                onChange={(e) => {
                  const c = contacts.find((c) => c.id === e.target.value) ?? null;
                  setSelectedContact(c);
                }}
                className="w-full h-9 text-sm px-2 rounded-md border bg-background"
              >
                <option value="">— none —</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.email ? ` (${c.email})` : ""}</option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="mtg-venue" className="text-xs">Venue (optional)</Label>
            <Input id="mtg-venue" value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="e.g. their office, Zoom, lunch spot" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mtg-desc" className="text-xs">Notes (optional)</Label>
            <Textarea id="mtg-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Agenda, talking points, anything you want in the Zoho event description." rows={3} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting} className="gap-1.5">
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {editingRecord ? "Save changes" : "Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Convert an ISO timestamp (with TZ) to the local-time-no-TZ format
// that <input type="datetime-local"> expects: YYYY-MM-DDTHH:MM. We
// intentionally drop sub-minute precision and the timezone — the
// browser will display whatever value we give it as-is in the user's
// local time, which is what we want for prefilling an edit.
function toLocalDatetimeInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Default = next 30 minutes, rounded up to the nearest 15-min boundary.
// Returned in the local-time format <input type="datetime-local"> wants
// (YYYY-MM-DDTHH:MM, no timezone).
function defaultStart(): string {
  const d = new Date(Date.now() + 30 * 60_000);
  // Round up to nearest 15 min.
  const min = d.getMinutes();
  const rounded = Math.ceil(min / 15) * 15;
  d.setMinutes(rounded, 0, 0);
  if (d.getMinutes() === 60) {
    d.setHours(d.getHours() + 1);
    d.setMinutes(0);
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
