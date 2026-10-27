import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-10 px-5 py-12 sm:px-8">
      <header className="space-y-3">
        <p className="text-sm font-medium text-muted-foreground">
          Red Geoespacial de Respuesta Vecinal
        </p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Geo Relief Network
        </h1>
        <p className="max-w-2xl text-base text-muted-foreground">
          Scaffolding del producto. El mapa, la conversación y los flujos operativos
          se implementarán después de revisar esta base.
        </p>
      </header>

      <section aria-labelledby="map-title" className="space-y-3">
        <h2 id="map-title" className="text-xl font-semibold">
          Mapa y consulta pública
        </h2>
        <div className="rounded-xl border border-dashed bg-card p-6 text-sm text-muted-foreground">
          Área reservada para el mapa de puntos de acopio y el chat público.
        </div>
      </section>

      <nav aria-label="Vistas de scaffolding" className="flex flex-wrap gap-4 text-sm">
        <Link className="underline underline-offset-4" href="/donate">
          Vista de donante
        </Link>
        <Link className="underline underline-offset-4" href="/request">
          Vista de solicitante
        </Link>
        <Link className="underline underline-offset-4" href="/manager">
          Vista de encargado
        </Link>
      </nav>
    </main>
  );
}
