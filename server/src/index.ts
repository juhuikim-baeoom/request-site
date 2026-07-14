import { buildApp } from './app.js'
import { env } from './env.js'
import { startAutoCompleteJob } from './jobs/auto-complete.js'

const app = await buildApp()
startAutoCompleteJob(app)
app
  .listen({ port: env.PORT, host: '0.0.0.0' })
  .then(() => app.log.info(`server up on :${env.PORT}`))
  .catch((err) => { app.log.error(err); process.exit(1) })
