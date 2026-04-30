import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, type Role } from "./supabase";

// Internal code role label kept as "rep" per spec: "rep only allowed in code field
// names" — user-facing copy uses "specialist". The DB stores "specialist" and we
// translate at the boundary via mapDbRole below.
export type UserRole = "rep" | "manager" | "admin";

export interface AuthUser {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  rep_id: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  role: UserRole;
  isAdmin: boolean;
  userName: string;
}

function mapDbRole(dbRole: Role): UserRole {
  return dbRole === "specialist" ? "rep" : dbRole;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,
  login: async () => {},
  logout: async () => {},
  role: "rep",
  isAdmin: false,
  userName: "",
});

async function loadProfileForSession(
  session: Session | null,
): Promise<AuthUser | null> {
  if (!session) return null;
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, role, full_name, email")
    .eq("id", session.user.id)
    .single();
  if (error || !profile) return null;
  return {
    id: profile.id,
    username: profile.email ?? session.user.email ?? "",
    display_name: profile.full_name ?? profile.email ?? "User",
    role: mapDbRole(profile.role as Role),
    rep_id: profile.id,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      const u = await loadProfileForSession(data.session);
      if (!mounted) return;
      setUser(u);
      setToken(data.session?.access_token ?? null);
      setIsLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return;
      const u = await loadProfileForSession(session);
      if (!mounted) return;
      setUser(u);
      setToken(session?.access_token ?? null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: username,
      password,
    });
    if (error) throw new Error(error.message);
    const u = await loadProfileForSession(data.session);
    if (!u) {
      await supabase.auth.signOut();
      throw new Error(
        "Logged in, but no profile row was found in the profiles table for this user. Ask an admin to create your profile.",
      );
    }
    setUser(u);
    setToken(data.session?.access_token ?? null);
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setToken(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout,
        role: user?.role ?? "rep",
        isAdmin: user?.role === "admin",
        userName: user?.display_name ?? "",
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
