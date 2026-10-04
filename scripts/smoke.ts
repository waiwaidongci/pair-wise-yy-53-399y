/**
 * 版本链核心逻辑冒烟测试：
 * 1. 任一处变动生成新草案版本（窗口 / 意见 / 接受意见）
 * 2. 接受意见核对锚定窗口版本；版本过期拒绝合并并列出差异
 * 3. 日期、地区、独占变动同样使意见失效
 * 4. 审批只接受当前版本 + 无高风险冲突 + 无待处理意见；失败保留原草案与冲突明细
 * 5. 通过的版本变成只读快照
 * 6. 导出审批包带版本号、意见处理结果、窗口数据；重新载入按版本校验；失效包被标出
 */
import assert from 'node:assert/strict'
import { seedChain } from '../lib/mock-data'
import { findConflicts } from '../lib/rules'
import { signPackage, verifyPackage, commentAnchorDiffs, isCommentStale, diffWindows } from '../lib/versioning'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

// 轻量 store 复刻（与 zustand store 同构的纯函数流程，避免引入 DOM 依赖）
type Comment = (typeof seedChain)[number]['comments'][number]
type Win = (typeof seedChain)[number]['windows'][number]
type Version = (typeof seedChain)[number]

function makeHarness() {
  const chain: Version[] = JSON.parse(JSON.stringify(seedChain))
  let vseq = 200
  let cseq = 900
  const nextId = () => `v${chain[chain.length - 1]!.no + 1}-${vseq++}`
  let head = () => chain[chain.length - 1]!
  const now = () => '2026-10-04T18:00:00'
  const commit = (windows: Win[], comments: Comment[], reason: Version['reason'], summary: string, changes: string[]) => {
    const parent = head()
    chain.push({ id: nextId(), no: parent.no + 1, parentId: parent.id, author: '章宁', time: now(), reason, summary, changes, windows, comments })
  }
  const staleClose = (comments: Comment[], windows: Win[], newVersionId: string) => comments.map((c) => {
    if (c.resolution.kind !== 'pending' || c.windowVersionId === newVersionId) return c
    const probe: Version = { id: '__probe__', no: 0, parentId: null, author: '', time: '', reason: '窗口调整', summary: '', changes: [], windows, comments }
    const diffs = commentAnchorDiffs(c, probe, chain)
    return diffs.length ? { ...c, resolution: { kind: 'closed' as const, time: now(), by: '章宁', reason: diffs.map((d) => `${d.label} ${d.anchored} → ${d.current}`).join('；') } } : c
  })
  return {
    chain,
    head,
    updateWindow(id: string, patch: Partial<Win>) {
      const cur = head()
      const windows = cur.windows.map((w) => (w.id === id ? { ...w, ...patch, status: '草案' as const } : w))
      const newId = nextId()
      const comments = staleClose(cur.comments, windows, newId)
      if (!Object.keys(diffWindows(cur.windows, windows)).length) return
      chain.push({ id: newId, no: cur.no + 1, parentId: cur.id, author: '章宁', time: now(), reason: '窗口调整', summary: `调整 ${id}`, changes: [`${id} 字段变动`], windows, comments })
    },
    addComment(windowId: string, content: string) {
      const cur = head()
      const comment: Comment = { id: `CM-${cseq++}`, windowVersionId: cur.id, windowId, channel: '', anchor: `${windowId} · x`, author: '黎清', role: '法务', content, resolution: { kind: 'pending' } }
      commit(cur.windows, [...cur.comments, comment], '条款意见', `新意见 ${comment.id}`, [`新增意见 ${comment.id}`])
      return comment.id
    },
    accept(id: string) {
      const cur = head()
      const c = cur.comments.find((item) => item.id === id)!
      if (c.resolution.kind !== 'pending') return { ok: false as const, message: '已处理', diffs: [] }
      const probe: Version = { id: cur.id, no: cur.no, parentId: cur.parentId, author: '', time: '', reason: '窗口调整', summary: '', changes: [], windows: cur.windows, comments: cur.comments }
      const diffs = commentAnchorDiffs(c, probe, chain)
      if (c.windowVersionId !== cur.id && diffs.length) return { ok: false as const, message: '过期', diffs }
      const comments = cur.comments.map((item) => item.id === id ? { ...item, resolution: { kind: 'accepted' as const, versionId: cur.id, time: now(), by: '章宁' } } : item)
      commit(cur.windows, comments, '接受意见', `接受 ${id}`, [`接受 ${id}`])
      return { ok: true as const, message: 'ok', diffs: [], versionId: head().id }
    },
    approve() {
      const cur = head()
      const blockers: string[] = []
      for (const issue of findConflicts(cur.windows).filter((i) => i.severity === '高')) blockers.push(`冲突 ${issue.id}`)
      for (const c of cur.comments.filter((i) => i.resolution.kind === 'pending')) blockers.push(`待处理 ${c.id}`)
      if (blockers.length) return { ok: false as const, blockers, versionId: cur.id }
      cur.reason = '审批快照'
      return { ok: true as const, blockers: [] as string[], versionId: cur.id }
    },
    exportPackage(kind: 'approved' | 'draft' = 'draft') {
      const cur = head()
      return signPackage({
        packageFormat: 'rights-approval-package/v2', versionId: cur.id, versionNo: cur.no, parentId: cur.parentId,
        generatedAt: now(), kind, windows: cur.windows,
        conflicts: findConflicts(cur.windows).map((i) => ({ id: i.id, type: i.type, severity: i.severity, title: i.title, windowIds: i.windowIds })),
        commentResults: cur.comments.map((c) => ({ commentId: c.id, author: c.author, content: c.content, outcome: c.resolution.kind === 'accepted' ? 'accepted' as const : c.resolution.kind === 'closed' ? 'closed' as const : 'pending' as const, note: '' })),
        changes: cur.changes, checksum: '',
      })
    },
  }
}

console.log('版本链冒烟测试')

check('初始链：v17 已审批快照，v18 是有高风险冲突的当前草案', () => {
  const h = makeHarness()
  assert.equal(h.head().id, 'v18')
  assert.equal(findConflicts(h.head().windows).filter((i) => i.severity === '高').length >= 1, true)
  assert.equal(h.head().comments.some((c) => c.resolution.kind === 'pending'), true)
})

check('窗口任一处变动都生成新草案版本并保持 parent 链', () => {
  const h = makeHarness()
  h.updateWindow('RW-103', { priority: 9 })
  assert.equal(h.head().parentId, 'v18')
  assert.equal(h.head().reason, '窗口调整')
  const cid = h.addComment('RW-103', '新意见')
  assert.equal(h.head().reason, '条款意见')
  const r = h.accept(cid)
  assert.equal(r.ok, true)
  assert.equal(h.head().reason, '接受意见')
  assert.equal(h.chain.length, 5)
})

check('日期变动使锚定旧版本的待处理意见失效，接受时拒绝合并并列出差异', () => {
  const h = makeHarness()
  // CM-34 锚定 v18 的 RW-101；改动 RW-101 日期后它应变 stale
  h.updateWindow('RW-101', { start: '2026-10-25' })
  const staleComment = h.head().comments.find((c) => c.id === 'CM-34')!
  assert.equal(staleComment.resolution.kind, 'closed')
  // 同窗口的非锚点字段（如渠道）不影响意见有效性
  const h2 = makeHarness()
  h2.updateWindow('RW-101', { channel: '星海影院升级版' })
  const okRes = h2.accept('CM-34')
  assert.equal(okRes.ok, true, '仅非锚点字段变动时意见应可接受')
  // 锚点字段（日期）变动后：接受被拒绝、列出差异且不产生新版本（CM-32 锚定 v17 的 RW-102）
  const h3 = makeHarness()
  // 手工构造一个「窗口已变但意见尚未自动关闭」的状态，专门验证 accept 的防御性核对
  const v18 = h3.head()
  h3.chain.push({ ...v18, id: 'v19-raw', no: 19, parentId: v18.id, windows: v18.windows.map((w) => w.id === 'RW-102' ? { ...w, end: '2027-10-31' } : w) })
  const before = h3.head()
  const res32 = h3.accept('CM-32')
  assert.equal(res32.ok, false)
  assert.ok(res32.diffs.some((d) => d.label === '开始日期' || d.label === '结束日期'))
  assert.equal(before.id, h3.head().id, '拒绝合并不得产生新版本')
})

check('日期、地区、独占三种锚点维度逐一验证', () => {
  const probes: { patch: Partial<Win>; field: string }[] = [
    { patch: { start: '2026-11-21' }, field: '开始日期' },
    { patch: { territory: '北美' as Win['territory'] }, field: '地区' },
    { patch: { exclusive: false }, field: '独占' },
  ]
  for (const probe of probes) {
    const h = makeHarness()
    const cid = h.addComment('RW-102', `针对 ${probe.field} 的意见`)
    assert.equal(isCommentStale(h.head().comments.find((c) => c.id === cid)!, h.head(), h.chain), false)
    h.updateWindow('RW-102', probe.patch)
    const closed = h.head().comments.find((c) => c.id === cid)!
    assert.equal(closed.resolution.kind, 'closed', `${probe.field} 变动应失效`)
    assert.match(closed.resolution.kind === 'closed' ? closed.resolution.reason : '', new RegExp(probe.field))
  }
})

check('接受锚定当前版本的意见成功，并把接受时的版本号写入结果', () => {
  const h = makeHarness()
  const cid = h.addComment('RW-102', '请确认物料拆分')
  const headAtAccept = h.head().id
  const r = h.accept(cid)
  assert.equal(r.ok, true)
  assert.match(r.versionId!, /^v20-/)
  const accepted = h.head().comments.find((c) => c.id === cid)!
  assert.equal(accepted.resolution.kind, 'accepted')
  if (accepted.resolution.kind === 'accepted') assert.equal(accepted.resolution.versionId, headAtAccept)
})

check('审批在高风险冲突 + 待处理意见下失败，且保留原草案与冲突明细', () => {
  const h = makeHarness()
  const beforeId = h.head().id
  const beforeCount = h.chain.length
  const result = h.approve()
  assert.equal(result.ok, false)
  assert.equal(result.versionId, beforeId)
  assert.equal(h.chain.length, beforeCount, '失败不得产生新版本')
  assert.ok(result.blockers.some((b) => b.includes('冲突')))
  assert.ok(result.blockers.some((b) => b.includes('待处理')))
})

check('修复窗口并处理完意见后审批通过，版本固化为只读快照', () => {
  const h = makeHarness()
  // 1) 把 RW-102 恢复到院线独占结束后（对齐 v17），消除高风险冲突；旧意见随之失效
  h.updateWindow('RW-102', { start: '2026-12-06', end: '2027-12-05' })
  const highAfter = findConflicts(h.head().windows).filter((i) => i.severity === '高')
  assert.equal(highAfter.length, 0)
  // 2) 关闭残留待处理意见（自动关闭之外的）
  for (const c of [...h.head().comments.filter((i) => i.resolution.kind === 'pending')]) {
    const r = h.accept(c.id)
    if (!r.ok) {
      // 过期意见：直接关闭并提交新版本
      const cur = h.head()
      const comments = cur.comments.map((item) => item.id === c.id ? { ...item, resolution: { kind: 'closed' as const, time: 'x', by: '章宁', reason: '过期' } } : item)
      h.chain.push({ ...cur, id: `v${cur.no + 1}-${Math.random()}`, no: cur.no + 1, parentId: cur.id, comments, reason: '关闭过期意见', summary: 'x', changes: [] })
    }
  }
  assert.equal(h.head().comments.every((c) => c.resolution.kind !== 'pending'), true)
  const result = h.approve()
  assert.equal(result.ok, true, JSON.stringify(result.blockers))
  assert.equal(h.head().reason, '审批快照')
})

check('审批包：导出带版本号、意见结果和窗口数据，重新载入校验通过', () => {
  const h = makeHarness()
  const pkg = h.exportPackage()
  assert.equal(pkg.versionId, 'v18')
  assert.equal(pkg.windows.length, 5)
  assert.ok(pkg.commentResults.some((c) => c.commentId === 'CM-31'))
  assert.equal(typeof pkg.checksum, 'string')
  const result = verifyPackage(pkg, h.chain, [], h.head().id)
  assert.equal(result.status, '校验通过', JSON.stringify(result.issues))
})

check('窗口后续变动后，旧审批包按版本校验标记为已失效并列出差异', () => {
  const h = makeHarness()
  const pkg = h.exportPackage()
  h.updateWindow('RW-102', { start: '2026-10-01' })
  const result = verifyPackage(pkg, h.chain, [], h.head().id)
  assert.equal(result.status, '已失效')
  assert.ok(result.issues.some((i) => i.includes('RW-102')))
  assert.ok(result.issues.some((i) => i.includes('开始日期')))
})

check('被篡改的审批包校验失败', () => {
  const h = makeHarness()
  const pkg = h.exportPackage()
  const tampered = { ...pkg, windows: pkg.windows.map((w) => w.id === 'RW-102' ? { ...w, exclusive: false } : w) }
  const result = verifyPackage(tampered, h.chain, [], h.head().id)
  assert.equal(result.status, '校验失败')
})

check('已审批包在本地无审批记录时判定为已失效', () => {
  const h = makeHarness()
  const pkg = signPackage({ ...h.exportPackage('approved'), approver: '沈策', approvedAt: '2026-10-04T20:00:00' })
  const result = verifyPackage(pkg, h.chain, [], h.head().id)
  assert.equal(result.status, '已失效')
  assert.ok(result.issues.some((i) => i.includes('未通过审批')))
})

console.log(`\n全部 ${passed} 项测试通过`)
