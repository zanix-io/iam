import seedersProd from './seeders.prod.ts'
import seedersDev from './seeders.dev.ts'
import { defineSeeders } from 'utils/seeders.ts'

/** Combined production + (non-production-only) dev seeders for the `permissions` collection. */
const seeders: typeof seedersProd = defineSeeders(seedersProd, seedersDev)

export default seeders
