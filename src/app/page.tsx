import Link from "next/link";
import { PublicMap } from "@/adapters/client/public-map";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col gap-9 px-4 py-6 sm:px-8 sm:py-10">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Red Geoespacial de Respuesta Vecinal</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Geo Relief Network</h1>
        </div>
        <nav aria-label="Acciones" className="flex flex-wrap gap-2 text-sm">
          <Link href="/chat" className="rounded-xl bg-primary px-4 py-2.5 font-medium text-primary-foreground">Hablar con el asistente</Link>
          <Link href="/manager" className="rounded-xl border bg-card px-4 py-2.5 font-medium hover:bg-muted">Panel del punto</Link>
        </nav>
      </header>

      <PublicMap />

      <section aria-labelledby="workflow-title" className="grid gap-4 rounded-2xl border bg-card p-5 sm:grid-cols-[1fr_auto] sm:items-center sm:p-6">
        <div>
          <h2 id="workflow-title" className="text-lg font-semibold">¿Vas a donar o necesitas ayuda?</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">El asistente organiza la información, recomienda un punto y te pide confirmar antes de registrar una acción.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/donate" className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">Preparar donación</Link>
          <Link href="/request" className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">Solicitar ayuda</Link>
        </div>
      </section>
    </main>
  );
}
