import type { PrismaClient } from "@calcom/prisma";

import type { AppFlags } from "../config";

export async function getFeatureFlagMap(prisma: PrismaClient) {
  const flags = await prisma.feature.findMany({
    orderBy: { slug: "asc" },
    cacheStrategy: { swr: 300, ttl: 300 },
  });
  return flags.reduce((acc, flag) => {
    acc[flag.slug as keyof AppFlags] = flag.enabled;
    return acc;
  }, {} as Partial<AppFlags>);
}

export const getFeatureFlag = async (prisma: PrismaClient, slug: keyof AppFlags): Promise<boolean> => {
  const flag = await prisma.feature.findUnique({
    where: {
      slug,
    },
    cacheStrategy: { swr: 300, ttl: 300 },
  });

  return Boolean(flag && flag.enabled);
};
