import { createContext, useContext, type ReactNode } from "react";
import { useAuth, type UserRole } from "./auth-context";

export type { UserRole };

interface RoleContextType {
  role: UserRole;
  setRole: (role: UserRole) => void;
  userName: string;
  setUserName: (name: string) => void;
  isAdmin: boolean;
}

const RoleContext = createContext<RoleContextType>({
  role: "admin",
  setRole: () => {},
  userName: "",
  setUserName: () => {},
  isAdmin: true,
});

export function RoleProvider({ children }: { children: ReactNode }) {
  const { role, userName, isAdmin } = useAuth();

  return (
    <RoleContext.Provider
      value={{
        role,
        setRole: () => {},
        userName,
        setUserName: () => {},
        isAdmin,
      }}
    >
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() {
  return useContext(RoleContext);
}
