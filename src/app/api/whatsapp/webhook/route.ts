function notImplemented(): Response {
  return Response.json(
    { error: "not_implemented", message: "El webhook de WhatsApp aún no está implementado." },
    { status: 501 },
  );
}

export async function GET(): Promise<Response> {
  return notImplemented();
}

export async function POST(): Promise<Response> {
  return notImplemented();
}
