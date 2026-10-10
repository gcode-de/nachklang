import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "../../../../lib/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return toNextJsHandler(auth()).GET(request);
}
export async function POST(request: Request) {
  return toNextJsHandler(auth()).POST(request);
}
