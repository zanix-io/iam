/** No real bootstrap fixture needed — unlike `roles/seeders/seeders.prod.ts`'s own `superadmin`
 * role (this project's only real bootstrap path for a first administrative account), a grant is
 * always created for a specific, already-existing `userId`/`resourceId` pair — there is no
 * system-wide grant a fresh environment needs seeded ahead of time. */
export default [] as never[]
