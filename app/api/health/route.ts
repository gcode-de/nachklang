import { db } from "../../../lib/database";
export const dynamic = "force-dynamic";
export function GET() {
  try {
    db().prepare("SELECT 1").get();
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
