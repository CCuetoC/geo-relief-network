export async function POST(): Promise<Response> {
  return Response.json(
    { error: "not_implemented", message: "El adaptador de chat aún no está implementado." },
    { status: 501 },
  );
}
