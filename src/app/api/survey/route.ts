import { connection } from "next/server";
import { eq } from "drizzle-orm";
import { db, creators } from "@/db";
import { surveyOptions, recordSurvey } from "@/lib/services/attribution";
import { getOps } from "@/lib/settings";

const QUESTION = "Where did you hear about us?";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { ...CORS, "Cache-Control": "no-store" } });

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

/** Options for the in-app survey: roster creator names (shuffled per request to avoid position bias), then generic answers. */
export async function GET() {
  await connection();
  const [roster, ops] = await Promise.all([surveyOptions(), getOps()]);
  const shuffled = [...roster];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return json({
    question: QUESTION,
    options: [
      ...shuffled.map((c) => ({ label: c.name, creatorId: c.id, type: "creator" as const })),
      ...ops.surveyOptions.map((label) => ({ label, creatorId: null, type: "generic" as const })),
    ],
  });
}

/** Record one answer: { creatorId?, answer, appUserId? }. A creator name sent without an id is matched to the roster. */
export async function POST(req: Request) {
  let body: { creatorId?: unknown; answer?: unknown; appUserId?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Body must be JSON: { creatorId?, answer, appUserId? }" }, 400);
  }
  const answerIn = typeof body.answer === "string" ? body.answer.trim().slice(0, 200) : "";
  const appUserId = typeof body.appUserId === "string" && body.appUserId.trim() ? body.appUserId.trim().slice(0, 200) : undefined;
  let creatorId: string | null = typeof body.creatorId === "string" && body.creatorId.trim() ? body.creatorId.trim() : null;
  let answer = answerIn;

  if (creatorId) {
    const c = await db.query.creators.findFirst({ where: eq(creators.id, creatorId), columns: { id: true, name: true } });
    if (!c) return json({ ok: false, error: "Unknown creatorId. Fetch GET /api/survey for current options." }, 400);
    answer = answer || c.name;
  } else if (answer) {
    const match = (await surveyOptions()).find((c) => c.name.toLowerCase() === answer.toLowerCase());
    if (match) {
      creatorId = match.id;
      answer = match.name;
    }
  }
  if (!answer) return json({ ok: false, error: "Send an answer (the option label) or a creatorId." }, 400);

  await recordSurvey({ creatorId, answer, appUserId });
  return json({ ok: true, creatorId });
}
