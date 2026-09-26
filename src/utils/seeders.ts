/**
 * Combines a domain's production-always fixtures with its dev-only ones — the dev set is
 * appended only when `ENV` isn't `'production'`, so a production deployment never seeds test data.
 */
export const defineSeeders = <T>(seedersProd: T[], seedersDev: T[]): T[] => {
  const seeders: typeof seedersProd = []
  seeders.push(...seedersProd)
  if (Deno.env.get('ENV') !== 'production') {
    seeders.push(...seedersDev)
  }
  return seeders
}
