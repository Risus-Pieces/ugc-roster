import { checkIntegrations } from "@/lib/integrations/health";

/** Signed-in only (not a public path, so the proxy requires a session). Read-only connection checks. */
export async function GET() {
  return Response.json({ checks: await checkIntegrations() });
}
