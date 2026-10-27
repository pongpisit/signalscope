const encoder = new TextEncoder();
const cookieName = "observatory_session";
const ttl = 12 * 60 * 60;

async function key(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

export async function verifyPassword(input: string, secret: string) {
  const k = await key(secret);
  const signature = await crypto.subtle.sign("HMAC", k, encoder.encode(secret));
  return crypto.subtle.verify("HMAC", k, signature, encoder.encode(input));
}

export async function sessionCookie(secret: string, secure: boolean) {
  const payload = `${Math.floor(Date.now() / 1000) + ttl}.${crypto.randomUUID()}`;
  const signature = hex(
    await crypto.subtle.sign(
      "HMAC",
      await key(secret),
      encoder.encode(payload),
    ),
  );
  return `${cookieName}=${payload}.${signature}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${ttl}${secure ? "; Secure" : ""}`;
}

export function clearCookie(secure: boolean) {
  return `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? "; Secure" : ""}`;
}

export async function authenticated(request: Request, secret: string) {
  const value = request.headers
    .get("Cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
  if (!value) return false;
  const [expiration, nonce, signature, extra] = value.split(".");
  if (
    extra ||
    !nonce ||
    !/^\d+$/.test(expiration) ||
    !/^[a-f0-9]{64}$/.test(signature ?? "")
  )
    return false;
  const now = Math.floor(Date.now() / 1000);
  if (Number(expiration) <= now || Number(expiration) > now + ttl) return false;
  const bytes = new Uint8Array(
    signature.match(/.{2}/g)!.map((x) => parseInt(x, 16)),
  );
  return crypto.subtle.verify(
    "HMAC",
    await key(secret),
    bytes,
    encoder.encode(`${expiration}.${nonce}`),
  );
}
