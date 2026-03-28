import type { RuntimeInfo } from "./types";

export async function getRuntimeInfo(): Promise<RuntimeInfo> {
  const response = await fetch("/api/runtime-info");

  if (!response.ok) {
    throw new Error("Failed to load runtime info.");
  }

  return (await response.json()) as RuntimeInfo;
}
