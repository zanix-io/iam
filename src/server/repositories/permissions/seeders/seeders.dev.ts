/** No dev-only fixtures needed beyond `seeders.prod.ts`'s own real permission catalog — this
 * domain's dev environment reuses the same production-grade catalog, matching the
 * `DEV_AUTH_ID`/`DEV_USER_ID` precedent of keeping fake data confined to what a domain's OWN
 * seeder genuinely needs, rather than duplicating an entity another domain already seeds. */
export default [] as never[]
