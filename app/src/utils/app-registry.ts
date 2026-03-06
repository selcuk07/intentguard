const REGISTRY_URL =
  "https://selcuk07.github.io/intentguard/app-registry.json";

export interface AppInfo {
  name: string;
  icon: string;
  website: string;
  verified: boolean;
  category: string;
  description: string;
}

interface Registry {
  version: number;
  apps: Record<string, AppInfo>;
}

let cache: Registry | null = null;

export async function lookupApp(appId: string): Promise<AppInfo | null> {
  try {
    if (!cache) {
      const res = await fetch(REGISTRY_URL);
      if (res.ok) cache = await res.json();
    }
    return cache?.apps[appId] ?? null;
  } catch {
    return null;
  }
}

export function isVerified(info: AppInfo | null): boolean {
  return info?.verified === true;
}
