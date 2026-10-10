import { confirmToken } from "../../../lib/life";
import { appUrl } from "../../../lib/config";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (request.headers.get("origin") !== appUrl())
    return Response.json({ error: "Ungültige Herkunft." }, { status: 403 });
  const form = await request.formData();
  const token = form.get("token");
  const ok = typeof token === "string" && confirmToken(token);
  return Response.redirect(
    `${appUrl()}/confirm?result=${ok ? "ok" : "invalid"}`,
    303,
  );
}
