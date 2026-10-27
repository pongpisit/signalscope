import { describe, expect, it } from "vitest";
import { authenticated, sessionCookie, verifyPassword } from "../worker/auth";

const secret = crypto.randomUUID() + crypto.randomUUID();
describe("dashboard sessions", () => {
  it("verifies the password without a plaintext equality check", async () => {
    expect(await verifyPassword(secret, secret)).toBe(true);
    expect(await verifyPassword("incorrect", secret)).toBe(false);
  });
  it("accepts signed sessions and rejects tampering or a rotated secret", async () => {
    const cookie = (await sessionCookie(secret, true)).split(";")[0];
    const request = new Request("https://observatory.example/api/dashboard", {
      headers: { Cookie: cookie },
    });
    expect(await authenticated(request, secret)).toBe(true);
    expect(await authenticated(request, secret + "rotated")).toBe(false);
    expect(
      await authenticated(
        new Request(request, {
          headers: { Cookie: cookie.replace(/.$/, "z") },
        }),
        secret,
      ),
    ).toBe(false);
  });
  it("sets secure, HttpOnly and SameSite cookie attributes", async () => {
    expect(await sessionCookie(secret, true)).toContain(
      "HttpOnly; SameSite=Strict; Path=/; Max-Age=43200; Secure",
    );
  });
});
