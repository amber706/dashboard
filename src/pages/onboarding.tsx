import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/section-header";
import {
  CheckCircle2, ChevronRight, ChevronLeft, Phone, Cloud, Database,
  FileText, Settings, Users, Shield, Lock, Loader2, Zap, ArrowRight
} from "lucide-react";

const STEPS = [
  { id: "ctm", label: "CTM Connection", icon: <Phone className="w-4 h-4" />, description: "Connect your CallTrackingMetrics account" },
  { id: "zoho", label: "Zoho CRM", icon: <Cloud className="w-4 h-4" />, description: "Link your Zoho CRM workspace" },
  { id: "kb", label: "Knowledge Base", icon: <Database className="w-4 h-4" />, description: "Upload approved response documents" },
  { id: "mapping", label: "Field Mapping", icon: <FileText className="w-4 h-4" />, description: "Map Zoho fields to extraction targets" },
  { id: "routing", label: "Routing Rules", icon: <Zap className="w-4 h-4" />, description: "Configure call routing weights" },
  { id: "scoring", label: "Scoring Weights", icon: <Settings className="w-4 h-4" />, description: "Adjust scoring parameters" },
  { id: "tasks", label: "Task Rules", icon: <CheckCircle2 className="w-4 h-4" />, description: "Set up automatic task creation" },
  { id: "thresholds", label: "Thresholds", icon: <Shield className="w-4 h-4" />, description: "Set confidence and SLA thresholds" },
  { id: "storage", label: "Storage", icon: <Lock className="w-4 h-4" />, description: "Configure transcript storage mode" },
  { id: "roles", label: "User Roles", icon: <Users className="w-4 h-4" />, description: "Add team members and set permissions" },
];

export default function Onboarding() {
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null);

  const step = STEPS[currentStep];

  const handleNext = () => {
    setCompletedSteps((prev) => new Set(prev).add(currentStep));
    setTestResult(null);
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    setTestResult(null);
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  };

  const handleTestConnection = () => {
    setTesting(true);
    setTestResult(null);
    setTimeout(() => {
      setTesting(false);
      setTestResult("success");
    }, 1500);
  };

  return (
    <div className="p-5 md:p-8 lg:p-10 max-w-4xl mx-auto space-y-6 md:space-y-8">
      <PageHeader title="Setup Wizard" subtitle="Get your Admissions Copilot up and running in minutes" />

      <div className="flex items-center gap-1 overflow-x-auto pb-2">
        {STEPS.map((s, i) => (
          <button
            key={s.id}
            onClick={() => setCurrentStep(i)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              i === currentStep ? "bg-primary text-primary-foreground" :
              completedSteps.has(i) ? "bg-green-50 text-green-700 border border-green-200" :
              "bg-muted/50 text-muted-foreground hover:bg-muted"
            }`}
          >
            {completedSteps.has(i) ? <CheckCircle2 className="w-3 h-3" /> : <span className="w-4 h-4 rounded-full bg-current/10 flex items-center justify-center text-[10px]">{i + 1}</span>}
            <span className="hidden sm:inline">{s.label}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <div className="flex-1 bg-muted rounded-full h-1.5">
          <div
            className="h-1.5 bg-primary rounded-full transition-all duration-300"
            style={{ width: `${((completedSteps.size) / STEPS.length) * 100}%` }}
          />
        </div>
        <span className="text-xs font-medium">{completedSteps.size} / {STEPS.length}</span>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
              {step.icon}
            </div>
            <div>
              <CardTitle className="text-lg">{step.label}</CardTitle>
              <p className="text-sm text-muted-foreground mt-0.5">{step.description}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <StepContent stepId={step.id} onTestConnection={handleTestConnection} testing={testing} testResult={testResult} />
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={handleBack} disabled={currentStep === 0} className="gap-1.5">
          <ChevronLeft className="w-4 h-4" />
          Back
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" className="text-xs text-muted-foreground" onClick={handleNext}>
            Skip for now
          </Button>
          <Button onClick={handleNext} className="gap-1.5">
            {currentStep === STEPS.length - 1 ? "Finish Setup" : "Save & Continue"}
            {currentStep < STEPS.length - 1 ? <ChevronRight className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

function StepContent({ stepId, onTestConnection, testing, testResult }: {
  stepId: string;
  onTestConnection: () => void;
  testing: boolean;
  testResult: "success" | "error" | null;
}) {
  switch (stepId) {
    case "ctm":
      return (
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">API Key</label>
            <Input placeholder="Enter your CTM API key..." type="password" />
            <p className="text-xs text-muted-foreground mt-1">Found in CTM Settings &rarr; API &rarr; API Keys</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">Account ID</label>
            <Input placeholder="e.g., 12345" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">Webhook URL</label>
            <Input value="https://your-app.repl.co/api/ctm/webhook" readOnly className="bg-muted/30 font-mono text-xs" />
            <p className="text-xs text-muted-foreground mt-1">Copy this URL into CTM webhook settings</p>
          </div>
          <TestConnectionButton onClick={onTestConnection} testing={testing} result={testResult} />
        </div>
      );

    case "zoho":
      return (
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">Client ID</label>
            <Input placeholder="Zoho OAuth Client ID" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">Client Secret</label>
            <Input placeholder="Zoho OAuth Client Secret" type="password" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">Refresh Token</label>
            <Input placeholder="Zoho Refresh Token" type="password" />
          </div>
          <TestConnectionButton onClick={onTestConnection} testing={testing} result={testResult} />
        </div>
      );

    case "kb":
      return (
        <div className="space-y-4">
          <div className="border-2 border-dashed rounded-xl p-8 text-center bg-muted/20">
            <Database className="w-8 h-8 mx-auto mb-3 text-muted-foreground/40" />
            <p className="text-sm font-medium">Upload Knowledge Base Documents</p>
            <p className="text-xs text-muted-foreground mt-1">Drag and drop PDF, DOCX, or TXT files, or click to browse</p>
            <Button variant="outline" className="mt-4 text-xs">Choose Files</Button>
          </div>
          <p className="text-xs text-muted-foreground">These documents will be used by the AI to generate grounded, approved responses during calls. Only upload verified, approved content.</p>
        </div>
      );

    case "mapping":
      return (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Map your Zoho CRM fields to the data the AI will extract from calls.</p>
          {["First Name", "Last Name", "Email", "Phone", "Program Interest", "Start Date", "Financial Aid"].map((field) => (
            <div key={field} className="flex items-center gap-3">
              <span className="text-xs font-medium w-32">{field}</span>
              <ArrowRight className="w-3 h-3 text-muted-foreground" />
              <Input placeholder={`Zoho field name...`} className="flex-1 h-8 text-xs" />
            </div>
          ))}
        </div>
      );

    case "routing":
      return (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Adjust how incoming calls are routed to reps. Higher weight = stronger influence.</p>
          {[
            { name: "Answer Rate", default: 40 },
            { name: "Book Rate", default: 25 },
            { name: "Callback Success", default: 20 },
            { name: "Open Leads Penalty", default: 10 },
            { name: "Missed Call Penalty", default: 5 },
          ].map((w) => (
            <div key={w.name} className="flex items-center gap-3">
              <span className="text-xs font-medium w-40">{w.name}</span>
              <Input type="number" defaultValue={w.default} className="w-20 h-8 text-xs" />
              <span className="text-xs text-muted-foreground">%</span>
            </div>
          ))}
        </div>
      );

    case "scoring":
      return (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Customize how call and lead scores are calculated.</p>
          {["Qualification Weight", "Empathy Weight", "Compliance Weight", "Urgency Bonus", "Program Fit Bonus"].map((w) => (
            <div key={w} className="flex items-center gap-3">
              <span className="text-xs font-medium w-40">{w}</span>
              <Input type="number" defaultValue={10} className="w-20 h-8 text-xs" />
            </div>
          ))}
        </div>
      );

    case "tasks":
      return (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Configure when tasks are automatically created for reps.</p>
          {[
            { rule: "Create follow-up task after each call", enabled: true },
            { rule: "Create brochure send task when materials requested", enabled: true },
            { rule: "Create callback task for missed calls", enabled: true },
            { rule: "Create tour scheduling task when interest shown", enabled: false },
          ].map((r) => (
            <label key={r.rule} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/20 cursor-pointer transition-colors">
              <input type="checkbox" defaultChecked={r.enabled} className="rounded" />
              <span className="text-sm">{r.rule}</span>
            </label>
          ))}
        </div>
      );

    case "thresholds":
      return (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Set confidence thresholds for automatic actions.</p>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">Auto-write threshold</label>
              <Input type="number" step="0.05" defaultValue="0.90" className="w-32 h-8 text-xs" />
              <p className="text-xs text-muted-foreground mt-1">Fields above this confidence are written to Zoho automatically</p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">Show confirmation threshold</label>
              <Input type="number" step="0.05" defaultValue="0.60" className="w-32 h-8 text-xs" />
              <p className="text-xs text-muted-foreground mt-1">Fields between this and auto-write are shown for rep confirmation</p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">Follow-up SLA (hours)</label>
              <Input type="number" defaultValue="4" className="w-32 h-8 text-xs" />
              <p className="text-xs text-muted-foreground mt-1">Maximum time before a hot lead must receive follow-up</p>
            </div>
          </div>
        </div>
      );

    case "storage":
      return (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Choose how call transcripts and recordings are stored.</p>
          {[
            { mode: "Note Only", desc: "Save a summarized note to Zoho — no raw transcript stored" },
            { mode: "Attachment Only", desc: "Attach full transcript as a file to the Zoho lead record" },
            { mode: "Both", desc: "Save summary note and attach full transcript" },
          ].map((m) => (
            <label key={m.mode} className="flex items-start gap-3 p-4 rounded-lg border hover:bg-muted/20 cursor-pointer transition-colors">
              <input type="radio" name="storage" defaultChecked={m.mode === "Both"} className="mt-0.5" />
              <div>
                <span className="text-sm font-medium">{m.mode}</span>
                <p className="text-xs text-muted-foreground mt-0.5">{m.desc}</p>
              </div>
            </label>
          ))}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">Retention period (days)</label>
            <Input type="number" defaultValue="90" className="w-32 h-8 text-xs" />
          </div>
        </div>
      );

    case "roles":
      return (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Add team members and assign their roles.</p>
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Name</th>
                  <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Email</th>
                  <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                <tr>
                  <td className="p-3 font-medium">Jane Doe</td>
                  <td className="p-3 text-muted-foreground">jane@school.edu</td>
                  <td className="p-3"><Badge>Admin</Badge></td>
                </tr>
                <tr>
                  <td className="p-3">
                    <Input placeholder="Name" className="h-7 text-xs" />
                  </td>
                  <td className="p-3">
                    <Input placeholder="Email" className="h-7 text-xs" />
                  </td>
                  <td className="p-3">
                    <select className="h-7 text-xs border rounded-md px-2 bg-background">
                      <option>Rep</option>
                      <option>Admin</option>
                    </select>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <Button variant="outline" size="sm" className="text-xs">+ Add Team Member</Button>
        </div>
      );

    default:
      return <p className="text-sm text-muted-foreground">Configuration for this step coming soon.</p>;
  }
}

function TestConnectionButton({ onClick, testing, result }: { onClick: () => void; testing: boolean; result: "success" | "error" | null }) {
  return (
    <div className="flex items-center gap-3">
      <Button variant="outline" size="sm" onClick={onClick} disabled={testing} className="text-xs gap-1.5">
        {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
        Test Connection
      </Button>
      {result === "success" && (
        <span className="flex items-center gap-1 text-xs text-green-600">
          <CheckCircle2 className="w-3.5 h-3.5" /> Connected successfully
        </span>
      )}
      {result === "error" && (
        <span className="flex items-center gap-1 text-xs text-red-600">
          Connection failed — check credentials
        </span>
      )}
    </div>
  );
}
