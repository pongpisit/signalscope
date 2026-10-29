// Bounded request-body reading.
//
// Content-Length is a client-controlled header, and clients can omit it
// entirely (chunked uploads), so it cannot be the only size limit on a
// JSON route. readJson caps the bytes actually read from the request
// stream instead; SyntaxError still propagates for the generic 400 path.

export class BodyTooLarge extends Error {
  constructor() {
    super("Request too large.");
  }
}

export async function readJson<T>(request: Request, limit: number): Promise<T> {
  const body = request.body;
  // An absent body fails the same way request.json() would.
  if (!body) throw new SyntaxError("The request body must be valid JSON.");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new BodyTooLarge();
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    // On any exit (including BodyTooLarge) stop accepting more upload data.
    reader.cancel().catch(() => {});
  }
  text += decoder.decode();
  return JSON.parse(text) as T;
}
