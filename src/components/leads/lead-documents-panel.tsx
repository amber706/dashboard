// LeadDocumentsPanel — upload + view + download per-lead documents.
//
// Lives on /leads/[id]. Backed by Supabase Storage bucket 'lead-documents'
// with metadata in lead_documents. Files are private; downloads use
// signed URLs scoped to ~5 minutes.
//
// Storage path convention: "<lead_id>/<uuid>_<sanitized_filename>"
// — flat per-lead folder so a lead's docs stay together. UUID prefix
// prevents same-name uploads from colliding.

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Loader2, Upload, FileText, FileImage, File as FileIcon,
  Download, Trash2, Paperclip,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { logAudit } from "@/lib/audit";

const CATEGORY_LABEL: Record<string, string> = {
  release_of_info: "Release of info",
  court_doc: "Court doc",
  insurance_card: "Insurance card",
  intake_form: "Intake form",
  id: "ID",
  other: "Other",
};
const CATEGORY_OPTIONS: Array<{ key: string; label: string }> = [
  { key: "release_of_info", label: "Release of info" },
  { key: "court_doc",       label: "Court doc" },
  { key: "insurance_card",  label: "Insurance card" },
  { key: "intake_form",     label: "Intake form" },
  { key: "id",              label: "ID" },
  { key: "other",           label: "Other" },
];

interface LeadDocument {
  id: string;
  lead_id: string;
  storage_path: string;
  display_name: string;
  original_filename: string;
  mime_type: string | null;
  size_bytes: number;
  category: string;
  notes: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  uploader: { full_name: string | null; email: string | null } | null;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function iconFor(mimeType: string | null) {
  if (!mimeType) return FileIcon;
  if (mimeType.startsWith("image/")) return FileImage;
  if (mimeType === "application/pdf") return FileText;
  return FileIcon;
}

// Strip control chars + replace path-unsafe characters so the storage
// path stays predictable. We DON'T lowercase or aggressively normalize;
// keep enough of the original name that "AHCCCS_Card.pdf" stays
// "AHCCCS_Card.pdf" (managers recognize their own filenames).
function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 200);
}

export function LeadDocumentsPanel({ leadId }: { leadId: string }) {
  const { user } = useAuth();
  const [docs, setDocs] = useState<LeadDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingCategory, setPendingCategory] = useState<string>("other");
  const [pendingNotes, setPendingNotes] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const { data, error } = await supabase
      .from("lead_documents")
      .select(`*, uploader:profiles!lead_documents_uploaded_by_fkey(full_name, email)`)
      .eq("lead_id", leadId)
      .is("deleted_at", null)
      .order("uploaded_at", { ascending: false });
    if (error) setError(error.message);
    else setDocs((data ?? []) as unknown as LeadDocument[]);
    setLoading(false);
  }, [leadId]);

  useEffect(() => { load(); }, [load]);

  function pickFile() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setPendingFile(f);
  }

  async function commitUpload() {
    if (!pendingFile) return;
    setUploading(true); setError(null);
    try {
      const safeName = sanitizeFilename(pendingFile.name);
      const path = `${leadId}/${crypto.randomUUID()}_${safeName}`;
      const { error: upErr } = await supabase.storage
        .from("lead-documents")
        .upload(path, pendingFile, {
          contentType: pendingFile.type || undefined,
          upsert: false,
        });
      if (upErr) throw new Error(upErr.message);

      const { error: insErr } = await supabase.from("lead_documents").insert({
        lead_id: leadId,
        storage_path: path,
        display_name: pendingFile.name,
        original_filename: pendingFile.name,
        mime_type: pendingFile.type || null,
        size_bytes: pendingFile.size,
        category: pendingCategory,
        notes: pendingNotes.trim() || null,
        uploaded_by: user?.id ?? null,
      });
      if (insErr) {
        // Best-effort cleanup of the orphaned object so the bucket doesn't
        // fill up with metadata-less files.
        await supabase.storage.from("lead-documents").remove([path]).catch(() => {});
        throw new Error(insErr.message);
      }

      logAudit("lead_document.upload", { lead_id: leadId, category: pendingCategory, size: pendingFile.size });
      setPendingFile(null);
      setPendingNotes("");
      setPendingCategory("other");
      if (fileInputRef.current) fileInputRef.current.value = "";
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  async function downloadDoc(doc: LeadDocument) {
    // Signed URL — Supabase Storage requires this for private buckets.
    // 5-minute window is enough for the user's browser to start the
    // download; the URL becomes invalid afterward.
    const { data, error } = await supabase.storage
      .from("lead-documents")
      .createSignedUrl(doc.storage_path, 5 * 60);
    if (error || !data?.signedUrl) {
      setError(error?.message ?? "Could not generate download link");
      return;
    }
    logAudit("lead_document.download", { lead_id: leadId, doc_id: doc.id });
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function deleteDoc(doc: LeadDocument) {
    if (!confirm(`Delete "${doc.display_name}"? The file will be permanently removed.`)) return;
    const { error: delErr } = await supabase
      .from("lead_documents")
      .update({ deleted_at: new Date().toISOString(), deleted_by: user?.id ?? null })
      .eq("id", doc.id);
    if (delErr) {
      setError(delErr.message);
      return;
    }
    // Best-effort: remove the underlying object too. If this fails the row
    // is already soft-deleted so the UI hides it; an admin can clean up.
    await supabase.storage.from("lead-documents").remove([doc.storage_path]).catch(() => {});
    logAudit("lead_document.delete", { lead_id: leadId, doc_id: doc.id });
    await load();
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Paperclip className="w-4 h-4 text-muted-foreground" />
            Documents
            {docs.length > 0 && (
              <Badge variant="outline" className="text-[10px] ml-1">{docs.length}</Badge>
            )}
          </span>
          <Button size="sm" variant="outline" onClick={pickFile} disabled={uploading} className="gap-1.5 h-8">
            <Upload className="w-3.5 h-3.5" /> Upload
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileChange}
          accept=".pdf,.jpg,.jpeg,.png,.heic,.webp,.doc,.docx,.txt"
          className="hidden"
        />

        {error && <div className="text-sm text-destructive">{error}</div>}

        {pendingFile && (
          <div className="border rounded-md p-3 space-y-2.5 bg-accent/30">
            <div className="flex items-center gap-2 text-sm">
              <FileIcon className="w-4 h-4 text-muted-foreground" />
              <span className="font-medium truncate">{pendingFile.name}</span>
              <span className="text-xs text-muted-foreground">{fmtBytes(pendingFile.size)}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORY_OPTIONS.map((c) => (
                <Button
                  key={c.key}
                  size="sm"
                  variant={pendingCategory === c.key ? "default" : "outline"}
                  onClick={() => setPendingCategory(c.key)}
                  className="h-7 text-xs"
                >
                  {c.label}
                </Button>
              ))}
            </div>
            <textarea
              value={pendingNotes}
              onChange={(e) => setPendingNotes(e.target.value)}
              placeholder="Notes (optional) — e.g. signed 4/12, court order #ABC123"
              className="w-full text-sm border rounded-md p-2 bg-background min-h-[60px]"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={commitUpload} disabled={uploading} className="gap-1.5 h-8">
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                Save
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setPendingFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} disabled={uploading} className="h-8">
                Cancel
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2 py-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading documents…
          </div>
        ) : docs.length === 0 && !pendingFile ? (
          <div className="text-sm text-muted-foreground py-2">
            No documents on this lead yet. Click Upload to attach a release of information, court doc, insurance card, or intake form.
          </div>
        ) : (
          <div className="space-y-1.5">
            {docs.map((d) => {
              const Icon = iconFor(d.mime_type);
              return (
                <div key={d.id} className="border rounded-md p-2.5 flex items-center gap-3 hover:bg-accent/30 transition-colors">
                  <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => downloadDoc(d)}
                        className="font-medium text-sm truncate hover:underline text-left"
                      >
                        {d.display_name}
                      </button>
                      <Badge variant="outline" className="text-[10px]">{CATEGORY_LABEL[d.category] ?? d.category}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap mt-0.5">
                      <span>{fmtBytes(d.size_bytes)}</span>
                      <span>·</span>
                      <span>{fmtDate(d.uploaded_at)}</span>
                      {d.uploader && (
                        <>
                          <span>·</span>
                          <span>{d.uploader.full_name ?? d.uploader.email}</span>
                        </>
                      )}
                    </div>
                    {d.notes && <div className="text-xs text-muted-foreground mt-1">{d.notes}</div>}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => downloadDoc(d)} className="h-7 px-2" title="Download">
                      <Download className="w-3.5 h-3.5" />
                    </Button>
                    {(d.uploaded_by === user?.id) && (
                      <Button size="sm" variant="ghost" onClick={() => deleteDoc(d)} className="h-7 px-2 text-rose-600 hover:text-rose-700" title="Delete">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
