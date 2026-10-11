import { handlePost } from "../../../../lib/dashboard-api";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) { return handlePost(request, true); }
