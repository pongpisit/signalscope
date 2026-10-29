import { describe, expect, it } from "vitest";
import { BodyTooLarge, readJson } from "../worker/body";

// Streamed requests carry no Content-Length header: this is the shape a
// chunked client produces, so the byte cap must come from the stream itself.
function streamedRequest(chunks: string[]): Request {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Request("https://observatory.example/api/settings", {
    method: "PUT",
    body,
    // Node requires the duplex option for stream bodies; the app's DOM-based
    // RequestInit type does not declare it.
    ...({ duplex: "half" } as RequestInit),
  });
}

describe("bounded request-body reading", () => {
  it("parses a small streamed body that has no Content-Length header", async () => {
    const request = streamedRequest(['{"token":"correct horse"}']);
    expect(request.headers.has("Content-Length")).toBe(false);
    await expect(
      readJson<{ token: string }>(request, 4096),
    ).resolves.toEqual({ token: "correct horse" });
  });

  it("rejects a single chunk larger than the limit", async () => {
    const request = streamedRequest([`{"token":"${"x".repeat(5000)}"}`]);
    await expect(readJson(request, 4096)).rejects.toThrow(BodyTooLarge);
  });

  it("rejects a body that exceeds the limit only across several chunks", async () => {
    const chunk = "x".repeat(2048);
    const request = streamedRequest([chunk, chunk, chunk]);
    await expect(readJson(request, 4096)).rejects.toThrow(BodyTooLarge);
  });

  it("accepts a body exactly at the limit", async () => {
    const request = streamedRequest(["1234"]);
    await expect(readJson(request, 4)).resolves.toBe(1234);
  });

  it("propagates invalid JSON as a SyntaxError for the 400 path", async () => {
    const request = streamedRequest(["not json"]);
    await expect(readJson(request, 4096)).rejects.toThrow(SyntaxError);
  });

  it("treats a missing body like request.json() does", async () => {
    const request = new Request("https://observatory.example/api/settings", {
      method: "PUT",
    });
    await expect(readJson(request, 4096)).rejects.toThrow(SyntaxError);
  });
});
