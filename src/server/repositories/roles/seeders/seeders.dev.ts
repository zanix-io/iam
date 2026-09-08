/** No dev-only fixtures needed beyond `seeders.prod.ts`'s own real `superadmin` role — deliberately
 * NOT wiring the local-dev `DEV_AUTH_ID` account (`auth/seeders/seeders.dev.ts`) to it here: that
 * would require this seeder to reach into the `auth` model directly, a cross-domain write this
 * project avoids everywhere else (`auth`/`users`' own seeders link only via a pre-agreed id value,
 * never one domain's seeder mutating another's collection) and one whose correctness would depend
 * on an implicit, unenforced model-registration import order between `roles` and `auth`. Assign
 * the seeded `superadmin` role to a local dev account by hand via `RolesService.assignRole` (or
 * `POST /roles/assign`) instead. */
export default [] as never[]
