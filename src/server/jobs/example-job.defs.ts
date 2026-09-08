import { registerCronJob } from '@zanix/asyncmq/jobs'

registerCronJob({
  name: 'example-job',
  isActive: true,
  processingQueue: 'soft',
  schedule: '0 0 * * * *',
  handler: function () {
    // Run the recurring work here, e.g.:
    // const repository = this.providers.get(ExampleRepository)
  },
})
