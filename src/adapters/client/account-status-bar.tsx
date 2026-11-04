"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { LogIn, LogOut, UserRound } from "lucide-react";
import { authClient } from "@/adapters/client/neon-auth";

type SessionState = "loading" | "signed-in" | "signed-out" | "error";

export function AccountStatusBar() {
  const [sessionState, setSessionState] = useState<SessionState>("loading");
  const [account, setAccount] = useState<{ name: string; email: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const refreshSession = useCallback(async () => {
    try {
      const { data, error } = await authClient.getSession();
      if (error) throw error;
      if (data?.user) {
        setAccount({ name: data.user.name || "Usuario", email: data.user.email });
        setSessionState("signed-in");
      } else {
        setAccount(null);
        setSessionState("signed-out");
      }
    } catch {
      setAccount(null);
      setSessionState("error");
    }
  }, []);

  useEffect(() => {
    void refreshSession();
    const handleFocus = () => void refreshSession();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refreshSession]);

  async function signIn() {
    setBusy(true);
    setNotice("");
    try {
      const callbackURL = window.location.pathname + window.location.search;
      const result = await authClient.signIn.social({ provider: "google", callbackURL });
      if (result.error) throw new Error(result.error.message || "No se pudo iniciar sesión.");
      if (result.data?.url) window.location.assign(result.data.url);
      else throw new Error("Google no devolvió una dirección de inicio de sesión.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo iniciar sesión con Google.");
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setNotice("");
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error(result.error.message || "No se pudo cerrar sesión.");
      setAccount(null);
      setSessionState("signed-out");
      window.location.assign(window.location.pathname + window.location.search);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo cerrar sesión.");
      setBusy(false);
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex min-h-14 w-full max-w-[1440px] items-center justify-between gap-3 px-4 py-2 sm:px-8">
        <Link href="/" className="shrink-0 text-sm font-semibold tracking-tight sm:text-base">
          Geo Relief Network
        </Link>

        <div className="flex min-w-0 items-center justify-end gap-2 sm:gap-3">
          {sessionState === "loading" && <span className="text-xs text-muted-foreground">Verificando cuenta…</span>}

          {sessionState === "signed-in" && account && (
            <div className="flex min-w-0 items-center gap-2" aria-label={`Sesión activa de ${account.email}`}>
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-hidden="true">
                <UserRound className="size-4" />
              </span>
              <span className="min-w-0 max-w-[42vw] sm:max-w-[22rem]">
                <span className="hidden text-[11px] leading-4 text-muted-foreground sm:block">Sesión activa</span>
                <span className="block truncate text-xs font-medium sm:text-sm" title={`${account.name} · ${account.email}`}>
                  <span className="sm:hidden">{account.email}</span>
                  <span className="hidden sm:inline">{account.name} · {account.email}</span>
                </span>
              </span>
              <button type="button" onClick={() => void signOut()} disabled={busy} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50 sm:px-3 sm:text-sm">
                <LogOut className="size-4" />
                <span>Cerrar sesión</span>
              </button>
            </div>
          )}

          {sessionState === "signed-out" && (
            <div className="flex items-center gap-2">
              <span className="hidden text-xs text-muted-foreground sm:inline">Sin iniciar sesión</span>
              <button type="button" onClick={() => void signIn()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 sm:text-sm">
                <LogIn className="size-4" />
                <span>Ingresar con Google</span>
              </button>
            </div>
          )}

          {sessionState === "error" && (
            <button type="button" onClick={() => void refreshSession()} className="rounded-lg border px-3 py-2 text-xs font-medium hover:bg-muted sm:text-sm">
              No se pudo verificar · Reintentar
            </button>
          )}
        </div>
      </div>
      {notice && <p role="status" className="mx-auto w-full max-w-[1440px] px-4 pb-2 text-right text-xs text-red-700 sm:px-8">{notice}</p>}
    </header>
  );
}
