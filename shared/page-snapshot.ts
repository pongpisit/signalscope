// This function is serialized into Chromium by Puppeteer. Keep it self-contained.
export function freezePingPage() {
  const parse = (value: string | null): number | null => {
    if (!value?.trim() || !/^\s*\d+(?:\.\d+)?\s*%?\s*$/.test(value))
      return null;
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : null;
  };
  const probes = Array.from(
    document.querySelectorAll<HTMLTableRowElement>(
      "tr.ping-result-row[data-pinger-id]",
    ),
  ).map((row) => ({
    id: row.dataset.pingerId ?? "",
    location: row.dataset.location ?? "",
    provider: row.dataset.provider ?? "",
    sent: parse(row.dataset.sent ?? null) ?? 0,
    loss: parse(row.dataset.loss ?? null),
    avg: parse(row.dataset.avg ?? null),
    best: parse(row.dataset.best ?? null),
    worst: parse(row.dataset.worst ?? null),
    jitter: parse(row.dataset.stdev ?? null),
  }));
  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll("script, iframe, noscript")
    .forEach((el) => el.remove());
  const canvases = document.querySelectorAll("canvas");
  clone.querySelectorAll("canvas").forEach((canvas, index) => {
    const image = document.createElement("img");
    try {
      image.src = canvases[index].toDataURL();
    } catch {
      return;
    }
    image.width = canvases[index].width;
    image.height = canvases[index].height;
    canvas.replaceWith(image);
  });
  const base = document.createElement("base");
  base.href = location.href;
  const head = clone.querySelector("head");
  if (head) head.insertBefore(base, head.firstChild);
  return {
    probes,
    resolvedAddress:
      document
        .querySelector("#snapshot-metadata")
        ?.getAttribute("data-target-host-resolved") ?? null,
    html: "<!doctype html>" + clone.outerHTML,
    capturedAt: new Date().toISOString(),
  };
}
