import type {
  AnchorFieldDiff,
  ApprovalPackage,
  DraftVersion,
  LicenseWindow,
  RightsComment,
  WindowAnchor,
  WindowFieldDiff,
} from './types'
import type { ConflictIssue } from './rules'

/** 受版本锚定保护的字段：日期、地区、独占。任一变动都会让旧意见失效 */
const ANCHORED_FIELDS: { field: keyof WindowAnchor; label: string }[] = [
  { field: 'start', label: '开始日期' },
  { field: 'end', label: '结束日期' },
  { field: 'territory', label: '地区' },
  { field: 'exclusive', label: '独占' },
]

export function anchorOf(win: LicenseWindow): WindowAnchor {
  return { start: win.start, end: win.end, territory: win.territory, exclusive: win.exclusive }
}

export function findWindow(version: DraftVersion, windowId: string): LicenseWindow | undefined {
  return version.windows.find((item) => item.id === windowId)
}

/** 在版本链中定位意见锚定的窗口快照 */
export function anchoredWindowFor(comment: RightsComment, chain: DraftVersion[]): LicenseWindow | undefined {
  const version = chain.find((item) => item.id === comment.windowVersionId)
  return version ? findWindow(version, comment.windowId) : undefined
}

/** 意见锚定窗口与指定版本当前窗口的差异；无差异返回空数组 */
export function commentAnchorDiffs(comment: RightsComment, version: DraftVersion, chain: DraftVersion[]): AnchorFieldDiff[] {
  const anchored = anchoredWindowFor(comment, chain)
  const current = findWindow(version, comment.windowId)
  if (!anchored || !current) return []
  const diffs: AnchorFieldDiff[] = []
  for (const { field, label } of ANCHORED_FIELDS) {
    const from = String(anchored[field])
    const to = String(current[field])
    if (from !== to) {
      diffs.push({
        field,
        label,
        anchored: field === 'exclusive' ? (anchored.exclusive ? '独占' : '非独占') : from,
        current: field === 'exclusive' ? (current.exclusive ? '独占' : '非独占') : to,
      })
    }
  }
  return diffs
}

/** 意见是否在指定版本上已过期（锚定窗口的日期/地区/独占发生了变动） */
export function isCommentStale(comment: RightsComment, version: DraftVersion, chain: DraftVersion[]): boolean {
  if (comment.windowVersionId === version.id) return false
  return commentAnchorDiffs(comment, version, chain).length > 0
}

const WINDOW_FIELD_LABELS: Record<string, string> = {
  channel: '渠道',
  rights: '权利类型',
  territory: '地区',
  start: '开始日期',
  end: '结束日期',
  exclusive: '独占',
  sublicense: '次级授权',
  priority: '优先级',
  status: '状态',
}

/** 两个窗口版本之间的字段级差异 */
export function diffWindows(from: LicenseWindow[], to: LicenseWindow[]): Record<string, WindowFieldDiff[]> {
  const result: Record<string, WindowFieldDiff[]> = {}
  const before = new Map(from.map((item) => [item.id, item]))
  for (const next of to) {
    const prev = before.get(next.id)
    if (!prev) {
      result[next.id] = [{ field: '__new__', label: '窗口', from: '—', to: `新增 ${next.channel} 窗口` }]
      continue
    }
    const diffs: WindowFieldDiff[] = []
    for (const key of Object.keys(next) as (keyof LicenseWindow)[]) {
      if (String(prev[key]) !== String(next[key])) {
        diffs.push({
          field: key,
          label: WINDOW_FIELD_LABELS[key] ?? key,
          from: String(prev[key]),
          to: String(next[key]),
        })
      }
    }
    if (diffs.length) result[next.id] = diffs
    before.delete(next.id)
  }
  for (const removed of before.values()) {
    result[removed.id] = [{ field: '__removed__', label: '窗口', from: removed.channel, to: '已删除' }]
  }
  return result
}

/** 判断某条变动是否触及受锚定保护的字段 */
export function touchesAnchoredFields(diffs: WindowFieldDiff[]): boolean {
  return diffs.some((diff) => ['start', 'end', 'territory', 'exclusive'].includes(diff.field))
}

export function formatDiffLine(diff: WindowFieldDiff): string {
  if (diff.field === '__new__' || diff.field === '__removed__') return diff.to
  return `${diff.label}：${diff.from} → ${diff.to}`
}

/** FNV-1a 32 位校验和，用于审批包重新载入时按版本校验 */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function canonicalChecksum(value: unknown): string {
  const canonical = JSON.stringify(value, (_, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v).sort().reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = (v as Record<string, unknown>)[key]
        return acc
      }, {})
    }
    return v
  })
  return fnv1a(canonical)
}

/** 签名/重算都排除 checksum 字段，保证两侧口径一致 */
export function packagePayload(pkg: ApprovalPackage): Omit<ApprovalPackage, 'checksum'> {
  const { checksum: _omitted, ...payload } = pkg
  return payload
}

export function signPackage(pkg: ApprovalPackage): ApprovalPackage {
  return { ...pkg, checksum: canonicalChecksum(packagePayload(pkg)) }
}

export interface PackageVerification {
  status: '校验通过' | '已失效' | '校验失败'
  issues: string[]
}

/**
 * 重新载入审批包时按版本校验：
 * 1. 校验和必须匹配（文件被篡改 → 校验失败）
 * 2. 版本号、父版本、窗口数据必须与本地版本链一致
 * 3. 该版本之后若版本链头部的窗口又被改动 → 已失效（旧包不能套到新窗口）
 * 4. 已审批包必须能在本地找到对应只读审批快照
 */
export function verifyPackage(
  pkg: ApprovalPackage,
  chain: DraftVersion[],
  approvals: { versionId: string }[],
  headId?: string,
): PackageVerification {
  const issues: string[] = []
  if (pkg.packageFormat !== 'rights-approval-package/v2' || !pkg.versionId || typeof pkg.checksum !== 'string') {
    return { status: '校验失败', issues: ['审批包格式不完整，缺少版本标识或校验和。'] }
  }
  const { checksum, ...payload } = pkg
  if (canonicalChecksum(payload) !== checksum) {
    return { status: '校验失败', issues: ['校验和不匹配，审批包内容可能已被篡改。'] }
  }
  const local = chain.find((version) => version.id === pkg.versionId)
  if (!local) {
    issues.push(`本地版本链中找不到版本 ${pkg.versionId}（v${pkg.versionNo}）。`)
  } else {
    if (local.no !== pkg.versionNo) issues.push(`版本号不一致：审批包为 v${pkg.versionNo}，本地为 v${local.no}。`)
    if (local.parentId !== pkg.parentId) issues.push('父版本链接与本地版本链不一致。')
    const localDiffs = diffWindows(pkg.windows, local.windows)
    for (const [windowId, diffs] of Object.entries(localDiffs)) {
      for (const diff of diffs) issues.push(`窗口 ${windowId} 的${formatDiffLine(diff)}，审批包锚定数据已过期。`)
    }
    // 包锚定版本之后，版本链头部窗口又发生变动 → 旧审批包已失效
    const head = headId ? chain.find((version) => version.id === headId) : chain[chain.length - 1]
    if (head && head.id !== pkg.versionId) {
      const headDiffs = diffWindows(pkg.windows, head.windows)
      for (const [windowId, diffs] of Object.entries(headDiffs)) {
        for (const diff of diffs) {
          issues.push(`最新版本 ${head.id} 已将窗口 ${windowId} 的${formatDiffLine(diff)}，审批包锚定的窗口数据已过期。`)
        }
      }
    }
    if (pkg.kind === 'approved' && !approvals.some((record) => record.versionId === pkg.versionId)) {
      issues.push(`版本 ${pkg.versionId} 在本地未通过审批，已审批包身份不成立。`)
    }
  }
  return issues.length ? { status: '已失效', issues } : { status: '校验通过', issues: [] }
}

/** 当前版本是否仍存在高风险（严重程度=高）冲突 */
export function highRiskConflicts(conflicts: ConflictIssue[]): ConflictIssue[] {
  return conflicts.filter((issue) => issue.severity === '高')
}

export function isResolved(comment: RightsComment): boolean {
  return comment.resolution.kind !== 'pending'
}
