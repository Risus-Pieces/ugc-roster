import type { Platform } from "@/db/schema";

export type DiscoveredPost = {
  externalId: string;
  url?: string;
  caption: string;
  transcript?: string;
  postedAt: Date;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  paidViews?: number;
  isPaidPartnership?: boolean;
  sampleComments?: string[];
};

export type DiscoveredCreator = {
  platform: Platform;
  handle: string;
  platformUserId?: string;
  name: string;
  bio: string;
  followers: number;
  url?: string;
  country?: string;
  posts: DiscoveredPost[];
};

export type SearchOptions = { minFollowers: number; maxFollowers: number; limit: number };

/** Keyword discovery. Official keyword search exists only for YouTube; TikTok/IG need a partner or data vendor. */
export interface DiscoveryProvider {
  platform: Platform;
  name: string;
  live: boolean;
  search(keyword: string, opts: SearchOptions): Promise<DiscoveredCreator[]>;
}

export type OAuthTokens = { accessToken: string; refreshToken?: string; expiresAt?: Date; platformUserId?: string };

/** Creator-connected account via the platform's official login. Stats come straight from the platform. */
export interface ConnectedProvider {
  platform: Platform;
  configured(): boolean;
  authorizeUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens>;
  refresh?(refreshToken: string): Promise<OAuthTokens>;
  profile(token: string): Promise<{ handle: string; platformUserId: string; followers: number; bio?: string; name?: string }>;
  recentPosts(token: string, platformUserId: string): Promise<DiscoveredPost[]>;
}
