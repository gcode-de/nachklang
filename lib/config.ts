export function appUrl() {
  const url = new URL(process.env.BETTER_AUTH_URL || "http://localhost:3000");
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("BETTER_AUTH_URL muss in Produktion HTTPS verwenden.");
  }
  return url.origin;
}

export function secret(name: string) {
  const value = process.env[name];
  if (!value || value.length < 32)
    throw new Error(`${name} fehlt oder ist zu kurz.`);
  return value;
}
