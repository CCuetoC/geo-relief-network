"use client";

import { createAuthClient } from "@neondatabase/auth/next";

/** Browser client uses the same-origin Next.js proxy; no auth URL or secret is exposed. */
export const authClient = createAuthClient();
