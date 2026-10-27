import { Activity, Check, Globe2, Layers3 } from "lucide-react";

type Source = "pingpe" | "globalping";

export default function DatasetSelector({
  source,
  onChange,
  history,
  countryName,
  globalpingLimit,
}: {
  source: Source;
  onChange: (source: Source) => void;
  history: boolean;
  countryName: string;
  globalpingLimit: number;
}) {
  return (
    <section className="dataset-console" aria-labelledby="dataset-heading">
      <div className="dataset-console-heading">
        <h2 id="dataset-heading">
          <Layers3 size={16} /> Measurement dataset
        </h2>
        <span>Choose the source behind your results</span>
      </div>
      <div
        className="dataset-options"
        role="radiogroup"
        aria-label="Measurement source"
      >
        {(
          [
            {
              id: "pingpe",
              name: "Ping.pe",
              icon: Activity,
              description: "Browser-captured ICMP",
              metrics: "Latency · Packet loss · Jitter",
            },
            {
              id: "globalping",
              name: "Globalping",
              icon: Globe2,
              description: `${countryName} probe network`,
              metrics: "Latency · Packet loss",
            },
          ] as const
        ).map((dataset) => {
          const selected = source === dataset.id;
          const Icon = dataset.icon;
          return (
            <label
              className={`dataset-option dataset-${dataset.id} ${selected ? "is-selected" : ""}`}
              key={dataset.id}
            >
              <input
                type="radio"
                name="measurement-source"
                value={dataset.id}
                aria-label={dataset.name}
                checked={selected}
                onChange={() => onChange(dataset.id)}
              />
              <span className="dataset-option-icon">
                <Icon size={27} strokeWidth={1.5} />
              </span>
              <span className="dataset-option-copy">
                <strong>{dataset.name}</strong>
                <span>{dataset.description}</span>
                <small>{dataset.metrics}</small>
              </span>
              <span className="dataset-option-state" aria-hidden="true">
                <span className="dataset-radio-mark">
                  {selected && <Check size={13} strokeWidth={3} />}
                </span>
                {selected ? "Selected" : "Select"}
              </span>
            </label>
          );
        })}
      </div>
      <div className="dataset-console-footer">
        <div
          className="dataset-current"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="dataset-current-indicator" />
          Viewing{" "}
          <strong>
            {source === "globalping" ? "Globalping" : "Ping.pe"} dataset
          </strong>
        </div>
        <p>
          {history
            ? "History lists both sources. Your selection applies when you open a run."
            : source === "globalping"
              ? `New tests: up to ${globalpingLimit} ${countryName} probes. Historical tests keep their original sample.`
              : "Cards, trends, locations and exports use Ping.pe. Evidence includes the original captures."}
        </p>
      </div>
    </section>
  );
}
