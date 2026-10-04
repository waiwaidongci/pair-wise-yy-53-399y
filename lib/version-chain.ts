import type {
  LicenseWindow,
  RightsComment,
  AnchorSnapshot,
  AnchorDiff,
  ApprovalBlocker,
  ApprovalSnapshot,
  ApprovalPackage,
  PackageCommentResult,
} from './types'
import type { ConflictIssue } from './rules'

/** 截取窗口的关键条款快照：日期、地区、独占 */
export function anchorSnapshotOf(win: LicenseWindow): AnchorSnapshot {
  return { start: win.start, end: win.end, territory: win.territory, exclusive: win.exclusive }
}

function fmtTerritory(value: string): string {
  return value
}

/**
 * 核对意见锚点与当前窗口的差异。
 * 日期（开始/结束）、地区、独占任一变动即视为锚点过期；窗口被删除同样失效。
 */
export function diffAnchor(comment: RightsComment, win: LicenseWindow | undefined): AnchorDiff[] {
  if (!win) return [{ field: 'window', label: '锚定窗口', before: comment.anchorWindowId, after: '已删除' }]
  const snap = comment.anchorSnapshot
  const diffs: AnchorDiff[] = []
  if (snap.start !== win.start) diffs.push({ field: 'start', label: '开始日期', before: snap.start, after: win.start })
  if (snap.end !== win.end) diffs.push({ field: 'end', label: '结束日期', before: snap.end, after: win.end })
  if (snap.territory !== win.territory) diffs.push({ field: 'territory', label: '地区', before: fmtTerritory(snap.territory), after: fmtTerritory(win.territory) })
  if (snap.exclusive !== win.exclusive) diffs.push({ field: 'exclusive', label: '独占', before: snap.exclusive ? '是' : '否', after: win.exclusive ? '是' : '否' })
  return diffs
}

/** 意见锚点是否已过期：锚定窗口的日期、地区或独占发生变动 */
export function isStale(comment: RightsComment, windows: LicenseWindow[]): boolean {
  return diffAnchor(comment, windows.find((w) => w.id === comment.anchorWindowId)).length > 0
}

/** 审批阻塞项：高风险冲突 + 待处理意见，任一存在即拒绝审批 */
export function approvalBlockers(
  _windows: LicenseWindow[],
  comments: RightsComment[],
  conflicts: ConflictIssue[],
): ApprovalBlocker[] {
  const blockers: ApprovalBlocker[] = []
  for (const c of conflicts.filter((item) => item.severity === '高')) {
    blockers.push({ kind: '冲突', id: c.id, title: `${c.type}：${c.title}`, detail: c.explanation })
  }
  for (const cm of comments.filter((item) => !item.resolved)) {
    blockers.push({ kind: '意见', id: cm.id, title: `待处理意见：${cm.role} · ${cm.author}`, detail: cm.content })
  }
  return blockers
}

function checksumOf(data: unknown): string {
  const json = JSON.stringify(data)
  let hash = 0
  for (let i = 0; i < json.length; i += 1) {
    hash = (hash * 31 + json.charCodeAt(i)) >>> 0
  }
  return `v${json.length}-${hash.toString(16).padStart(8, '0')}`
}

/** 依据只读快照生成审批包：带版本号、意见处理结果和窗口数据 */
export function buildPackage(snapshot: ApprovalSnapshot, conflicts: ConflictIssue[]): ApprovalPackage {
  const commentResults: PackageCommentResult[] = snapshot.comments.map((c) => ({
    id: c.id,
    anchor: c.anchor,
    author: c.author,
    role: c.role,
    content: c.content,
    resolution: c.resolved ? 'accepted' : 'pending',
    anchoredVersion: c.anchorVersion,
  }))
  const highRiskConflictCount = conflicts.filter((c) => c.severity === '高').length
  const body = {
    version: snapshot.version,
    approvedAt: snapshot.approvedAt,
    windows: snapshot.windows,
    commentResults,
    highRiskConflictCount,
  }
  return {
    packageId: `AP-v${snapshot.version}-${Date.now().toString(36)}`,
    ...body,
    generatedAt: new Date().toISOString(),
    checksum: checksumOf(body),
    status: 'valid',
    invalidReasons: [],
  }
}

/**
 * 重新载入时按版本校验审批包：
 * - 锚定快照不存在
 * - 草案已推进到更新版本
 * - 校验和不匹配（数据被篡改）
 * 任一命中即标记为已失效。
 */
export function validatePackage(
  pkg: ApprovalPackage,
  currentVersion: number,
  snapshots: ApprovalSnapshot[],
): ApprovalPackage {
  const reasons: string[] = []
  const snap = snapshots.find((s) => s.version === pkg.version)
  if (!snap) reasons.push(`审批包锚定的 v${pkg.version} 只读快照已不存在`)
  if (pkg.version < currentVersion) reasons.push(`草案已推进到 v${currentVersion}，审批包 v${pkg.version} 已过期`)
  const expected = checksumOf({
    version: pkg.version,
    approvedAt: pkg.approvedAt,
    windows: pkg.windows,
    commentResults: pkg.commentResults,
    highRiskConflictCount: pkg.highRiskConflictCount,
  })
  if (expected !== pkg.checksum) reasons.push('审批包内容校验失败，窗口或意见数据可能被篡改')
  return { ...pkg, status: reasons.length > 0 ? 'expired' : 'valid', invalidReasons: reasons }
}
