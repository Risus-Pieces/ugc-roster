import type { Platform } from "@/db/schema";
import type { ConnectedProvider, DiscoveryProvider } from "./types";
import { demoDiscovery } from "./demo";
import { youtubeConnected, youtubeDiscovery } from "./youtube";
import { tiktokConnected } from "./tiktok";
import { instagramConnected } from "./instagram";

export function discoveryFor(platform: Platform): DiscoveryProvider {
  if (platform === "youtube" && process.env.YOUTUBE_API_KEY) return youtubeDiscovery;
  return demoDiscovery(platform);
}

export const connectedProviders: Record<Platform, ConnectedProvider> = {
  tiktok: tiktokConnected,
  instagram: instagramConnected,
  youtube: youtubeConnected,
};

export * from "./types";
