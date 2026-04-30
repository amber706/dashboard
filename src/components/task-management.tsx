import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CheckCircle2, Clock, AlertTriangle, User, Plus, X,
  ChevronDown, ListTodo, RotateCcw
} from "lucide-react";

interface Task {
  id: string;
  title: string;
  due_time?: string;
  priority: "high" | "medium" | "low";
  owner?: string;
  reason?: string;
  status: "pending" | "completed" | "dismissed" | "overdue";
  auto_created?: boolean;
}

const priorityStyles = {
  high: "bg-red-50 text-red-700 border-red-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  low: "bg-blue-50 text-blue-700 border-blue-200",
};

export function TaskList({ tasks, onReassign, onAdjustDue, onDismiss, onComplete, editable = false }: {
  tasks: Task[];
  onReassign?: (taskId: string, newOwner: string) => void;
  onAdjustDue?: (taskId: string, newDue: string) => void;
  onDismiss?: (taskId: string, reason: string) => void;
  onComplete?: (taskId: string) => void;
  editable?: boolean;
}) {
  const [editingTask, setEditingTask] = useState<string | null>(null);
  const [dismissReason, setDismissReason] = useState("");

  if (tasks.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground border border-dashed rounded-lg">
        <ListTodo className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
        No tasks created
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {tasks.map((task) => (
        <div key={task.id} className="flex items-start gap-3 p-3 rounded-lg border bg-background hover:bg-muted/20 transition-colors">
          <div className="mt-0.5">
            {task.status === "completed" ? (
              <CheckCircle2 className="w-4 h-4 text-green-500" />
            ) : task.status === "overdue" ? (
              <AlertTriangle className="w-4 h-4 text-red-500" />
            ) : (
              <Clock className="w-4 h-4 text-amber-500" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-sm font-medium ${task.status === "dismissed" ? "line-through text-muted-foreground" : ""}`}>{task.title}</span>
              <Badge variant="outline" className={`text-[10px] ${priorityStyles[task.priority]}`}>{task.priority}</Badge>
              {task.auto_created && <Badge variant="secondary" className="text-[9px]">Auto</Badge>}
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
              {task.owner && (
                <span className="flex items-center gap-1">
                  <User className="w-3 h-3" /> {task.owner}
                </span>
              )}
              {task.due_time && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {new Date(task.due_time).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </span>
              )}
            </div>
            {task.reason && <p className="text-xs text-muted-foreground/70 mt-1">{task.reason}</p>}

            {editingTask === task.id && (
              <div className="mt-2 flex items-center gap-2">
                <Input
                  placeholder="Reason for dismissing..."
                  value={dismissReason}
                  onChange={(e: any) => setDismissReason(e.target.value)}
                  className="h-7 text-xs"
                />
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { onDismiss?.(task.id, dismissReason); setEditingTask(null); setDismissReason(""); }}>
                  Confirm
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingTask(null)}>
                  Cancel
                </Button>
              </div>
            )}
          </div>

          {editable && task.status === "pending" && (
            <div className="flex items-center gap-1 shrink-0">
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => onComplete?.(task.id)} title="Mark complete">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
              </Button>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditingTask(task.id)} title="Dismiss">
                <X className="w-3.5 h-3.5 text-red-500" />
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function TaskManagementPanel({ tasks: initialTasks }: { tasks: Task[] }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTask, setNewTask] = useState({ title: "", owner: "", priority: "medium" as const });

  const handleComplete = (id: string) => {
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, status: "completed" as const } : t));
  };

  const handleDismiss = (id: string, reason: string) => {
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, status: "dismissed" as const, reason } : t));
  };

  const handleAdd = () => {
    if (!newTask.title.trim()) return;
    setTasks((prev) => [...prev, {
      id: `manual-${Date.now()}`,
      title: newTask.title,
      owner: newTask.owner || undefined,
      priority: newTask.priority,
      status: "pending" as const,
      auto_created: false,
    }]);
    setNewTask({ title: "", owner: "", priority: "medium" });
    setShowAddForm(false);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <ListTodo className="w-4 h-4" />
            Tasks
          </CardTitle>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowAddForm(!showAddForm)}>
            <Plus className="w-3 h-3" />
            Add Task
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {showAddForm && (
          <div className="p-3 border rounded-lg bg-muted/20 mb-3 space-y-2">
            <Input placeholder="Task description..." value={newTask.title} onChange={(e: any) => setNewTask({ ...newTask, title: e.target.value })} className="h-8 text-sm" />
            <div className="flex gap-2">
              <Input placeholder="Owner (optional)" value={newTask.owner} onChange={(e: any) => setNewTask({ ...newTask, owner: e.target.value })} className="h-7 text-xs flex-1" />
              <select
                value={newTask.priority}
                onChange={(e) => setNewTask({ ...newTask, priority: e.target.value as any })}
                className="h-7 text-xs border rounded-md px-2 bg-background"
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <Button size="sm" className="h-7 text-xs" onClick={handleAdd}>Create</Button>
            </div>
          </div>
        )}
        <TaskList tasks={tasks} editable onComplete={handleComplete} onDismiss={handleDismiss} />
      </CardContent>
    </Card>
  );
}

export function AdminTaskOverview({ tasks }: { tasks: Task[] }) {
  const overdue = tasks.filter((t) => t.status === "overdue");
  const pending = tasks.filter((t) => t.status === "pending");
  const completed = tasks.filter((t) => t.status === "completed");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-red-600">{overdue.length}</div>
            <div className="text-xs text-muted-foreground mt-1">Overdue</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-amber-600">{pending.length}</div>
            <div className="text-xs text-muted-foreground mt-1">Pending</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-green-600">{completed.length}</div>
            <div className="text-xs text-muted-foreground mt-1">Completed</div>
          </CardContent>
        </Card>
      </div>
      {overdue.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-red-600 mb-2 flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" /> Overdue Tasks
          </h3>
          <TaskList tasks={overdue} />
        </div>
      )}
    </div>
  );
}
