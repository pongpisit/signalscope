import { ipAddress, testedDestinationIp } from "./addresses.ts";
import { countryName } from "./countries";
import type { Result } from "./types";

type Evidence = {
  hostname: string;
  measurement?: {
    id: string;
    target: string;
    type: string;
    results: {
      probe: { country: string; city: string; network: string; asn: number };
      result: { resolvedAddress?: string | null; rawOutput?: string };
    }[];
  };
};

export function recoverAddresses(stored: Result, evidence: Evidence): Result {
  const measurement = evidence.measurement;
  if (
    stored.source !== "globalping" ||
    !measurement ||
    measurement.type !== "ping" ||
    evidence.hostname !== stored.hostname ||
    measurement.target !== stored.hostname ||
    measurement.id !== stored.measurementId ||
    !Array.isArray(measurement.results) ||
    measurement.results.length !== stored.probes.length
  )
    throw new Error(
      "Evidence does not match the stored Globalping measurement.",
    );
  return {
    ...stored,
    probes: stored.probes.map((probe, index) => {
      const raw = measurement.results[index];
      // The probe ID prefix records the country the selection ran in; legacy
      // evidence stored Thailand before countries became configurable.
      const country = probe.id.split("_")[0];
      if (
        probe.id !== `${country}_globalping_${index}` ||
        country.length !== 2 ||
        raw.probe.country !== country ||
        probe.location !== `${countryName(country)}, ${raw.probe.city}` ||
        probe.provider !== `${raw.probe.network} (AS${raw.probe.asn})`
      )
        throw new Error(
          "Evidence probe identity/order does not match the stored result.",
        );
      return {
        ...probe,
        resolvedAddress:
          ipAddress(probe.resolvedAddress) ?? testedDestinationIp(raw.result),
      };
    }),
  };
}
