import { GET as getDashboard, handlePost } from "../../../lib/dashboard-api";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = getDashboard;
export async function POST(request: Request) { return handlePost(request); }
