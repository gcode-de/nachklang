import { confirmToken } from "../../../lib/life";
import { confirmMailTest } from "../../../lib/mail-test";
import { appUrl } from "../../../lib/config";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (request.headers.get("origin") !== appUrl())
    return Response.json({ error: "Ungültige Herkunft." }, { status: 403 });
  const form = await request.formData();
  const token = form.get("token");
  const mail = form.get("kind") === "mail";
  const ok =
    typeof token === "string" &&
    (mail ? confirmMailTest(token) : confirmToken(token));
  return Response.redirect(
    `${appUrl()}/confirm?result=${ok ? "ok" : "invalid"}${mail ? "&kind=mail" : ""}`,
    303,
  );
}
