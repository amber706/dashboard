import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type WorkflowMode = "pre-call" | "live-call" | "wrap-up" | "admin";

interface WorkflowContextType {
  mode: WorkflowMode;
  setMode: (mode: WorkflowMode) => void;
  callId: string | null;
  setCallId: (id: string | null) => void;
  callerPhone: string | null;
  setCallerPhone: (phone: string | null) => void;
}

const WorkflowContext = createContext<WorkflowContextType>({
  mode: "admin",
  setMode: () => {},
  callId: null,
  setCallId: () => {},
  callerPhone: null,
  setCallerPhone: () => {},
});

export function WorkflowProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<WorkflowMode>("admin");
  const [callId, setCallId] = useState<string | null>(null);
  const [callerPhone, setCallerPhone] = useState<string | null>(null);

  const setMode = useCallback((newMode: WorkflowMode) => {
    setModeState(newMode);
  }, []);

  return (
    <WorkflowContext.Provider value={{ mode, setMode, callId, setCallId, callerPhone, setCallerPhone }}>
      {children}
    </WorkflowContext.Provider>
  );
}

export function useWorkflow() {
  return useContext(WorkflowContext);
}
