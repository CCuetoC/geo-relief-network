import { createNeonAuth } from "@neondatabase/auth/next/server";
import { getNeonAuthServerConfig } from "@/core/server/neon-auth-config";

let authInstance: ReturnType<typeof createNeonAuth> | undefined;

export function getNeonAuth() {
  const config = getNeonAuthServerConfig();
  authInstance ??= createNeonAuth({ baseUrl: config.baseUrl, cookies: { secret: config.cookieSecret } });
  return authInstance;
}

export async function getAuthenticatedActor(): Promise<{ id: string; email?: string } | null> {
  try {
    const { data, error } = await getNeonAuth().getSession();
    if (error || !data?.user?.id) return null;
    return { id: data.user.id, email: data.user.email };
  } catch {
    return null;
  }
}
