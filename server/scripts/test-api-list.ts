import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { pool } from '../src/db/client.js'
import { loginAsDev } from '../src/routes/helpers.js'

const app = await buildApp()

// 미인증 401
const anon = await app.inject({ method: 'GET', url: '/api/requests' })
assert.equal(anon.statusCode, 401)
console.log('unauth 401 ok')

const sid = await loginAsDev(app)
const cookies = { sid }

const types = await app.inject({ method: 'GET', url: '/api/request-types', cookies })
assert.equal(types.statusCode, 200)
assert.equal(types.json().length, 4)
console.log('request-types ok')

const profiles = await app.inject({ method: 'GET', url: '/api/profiles', cookies })
assert.ok(profiles.json().some((p: any) => p.email === 'juhuikim@baeoom.com'))
console.log('profiles ok')

const list = await app.inject({ method: 'GET', url: '/api/requests', cookies })
assert.equal(list.statusCode, 200)
assert.ok(Array.isArray(list.json()))
console.log('requests list ok')

const shared = await app.inject({ method: 'GET', url: '/api/requests/shared-targets', cookies })
assert.equal(shared.statusCode, 200)
console.log('shared-targets ok')

await app.close()
await pool.end()
console.log('API LIST TEST OK')
