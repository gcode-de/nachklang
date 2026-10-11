export async function action<T = { ok: boolean; id?: string; revision?: number }>(input: Record<string, unknown>): Promise<T> {
  const authorization = input.action === "release" || input.action === "revoke";
  const response = await fetch(authorization ? "/api/messages/release" : "/api/dashboard", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Aktion fehlgeschlagen.");
  return data as T;
}
