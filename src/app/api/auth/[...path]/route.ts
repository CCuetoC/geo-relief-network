import { getNeonAuth } from "@/core/server/auth";

type RouteContext = { params: Promise<{ path: string[] }> };
type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

async function proxy(method: Method, request: Request, context: RouteContext): Promise<Response> {
  try {
    const handlers = getNeonAuth().handler();
    return handlers[method](request, context);
  } catch {
    return Response.json({ error: "auth_not_configured" }, { status: 503 });
  }
}

export const GET = (request: Request, context: RouteContext) => proxy("GET", request, context);
export const POST = (request: Request, context: RouteContext) => proxy("POST", request, context);
export const PUT = (request: Request, context: RouteContext) => proxy("PUT", request, context);
export const DELETE = (request: Request, context: RouteContext) => proxy("DELETE", request, context);
export const PATCH = (request: Request, context: RouteContext) => proxy("PATCH", request, context);
