export {
  type ClientOptions,
  CockpitClient,
  type ConnectionState,
  compareBuilds,
  type OutdatedDaemon,
} from "./daemon/client.ts"
export type { SpawnOptions } from "./daemon/spawn.ts"
export { claimedFeatures, claimFeature, duplicateFeatureMessage, type FeatureClaim } from "./feature.ts"
