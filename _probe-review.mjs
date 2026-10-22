import { HintCoordinator } from './packages/agenthint-core/lib/index.js'
const noop = { send: async () => ({ status: 'accepted', httpStatus: 200 }) }

// F04: 未知 requestClass 必须拒绝
{
  const core = new HintCoordinator({ transport: noop })
  core.registerSession({ sessionId: 'cls', seeded: false })
  let rejected = false
  try { await core.prepareRequest({ sessionId: 'cls', requestClass: 'not-recognized', model: 'm' }) }
  catch (e) { rejected = e.code === 'INVALID_INPUT' }
  console.log('F04 未知 requestClass:', rejected ? '✅ 已拒绝 INVALID_INPUT' : '❌ 仍被接受')
  // 拒绝后会话仍可用
  const ok = await core.prepareRequest({ sessionId: 'cls', requestClass: 'ordinary', model: 'm' })
  console.log('  拒绝后合法请求:', ok.hint ? '✅ 可用' : '❌')
  ok.finish(); core.dispose()
}

// F04b: 非法 JSON 值
{
  const core = new HintCoordinator({ transport: noop })
  core.registerSession({ sessionId: 'json', seeded: false })
  const cases = [
    ['NaN', { type: 'kv', ttl: NaN }],
    ['function', { type: 'kv', fn: () => 1 }],
    ['BigInt', { type: 'kv', n: 1n }],
    ['Date', { type: 'kv', d: new Date() }],
  ]
  for (const [name, cc] of cases) {
    let rejected = false
    try { await core.prepareRequest({ sessionId: 'json', requestClass: 'ordinary', model: 'm', cacheControl: cc }) }
    catch (e) { rejected = e.code === 'INVALID_INPUT' }
    console.log(`  ${name.padEnd(9)}:`, rejected ? '✅ 拒绝' : '❌ 被接受')
  }
  core.dispose()
}

// F05: finish 后迟到 accepted
{
  const core = new HintCoordinator({ transport: noop })
  core.registerSession({ sessionId: 'late', seeded: false })
  const lease = await core.prepareRequest({ sessionId: 'late', requestClass: 'ordinary', model: 'm' })
  lease.finish(); lease.accepted()
  const sent = core.facts('late').firstOrdinarySent
  console.log('\nF05 finish 后迟到 accepted:', sent ? '❌ 仍提交了 start' : '✅ 已拒绝')
  // 会话仍可正常使用
  const next = await core.prepareRequest({ sessionId: 'late', requestClass: 'ordinary', model: 'm' })
  console.log('  后续请求:', next.hint?.session_control?.type === 'start' ? '✅ 仍能声明 start' : '⚠️ 未声明 start')
  next.finish(); core.dispose()
}

// F06: transport 抛错应为 unknown
{
  const core = new HintCoordinator({ transport: { send: async () => { throw new Error('boom') } } })
  core.registerSession({ sessionId: 'boom', seeded: false })
  const lease = await core.prepareRequest({ sessionId: 'boom', requestClass: 'ordinary', model: 'm' })
  lease.accepted(); lease.finish()
  const r = await core.requestControl({ verb: 'pause', sessionId: 'boom', model: 'm' })
  console.log('\nF06 transport 抛错:', r.status === 'unknown' ? '✅ 返回 unknown' : `❌ 返回 ${r.status}`)
  core.dispose()
}
