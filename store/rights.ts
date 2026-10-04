import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  ApprovalBlocker,
  ApprovalPackage,
  ApprovalRecord,
  ApprovalResult,
  DraftVersion,
  ImportedPackageRecord,
  LicenseWindow,
  RightsComment,
} from '@/lib/types'
import { initialComments, initialWindows, seedChain } from '@/lib/mock-data'
import { findConflicts, shiftWindow } from '@/lib/rules'
import {
  commentAnchorDiffs,
  diffWindows,
  formatDiffLine,
  highRiskConflicts,
  isCommentStale,
  isResolved,
  signPackage,
  touchesAnchoredFields,
  verifyPackage,
} from '@/lib/versioning'

const CURRENT_USER = '章宁'
const APPROVER = '沈策（发行负责人）'

export interface AcceptCommentResult {
  ok: boolean
  message: string
  diffs: { label: string; anchored: string; current: string }[]
  versionId?: string
}

interface RightsState {
  chain: DraftVersion[]
  /** 版本链头部：最新草案，所有改动与审批都落在这一版 */
  currentId: string
  /** 正在查看的历史/快照版本；非空时页面只读 */
  viewId: string | null
  /** 已通过审批的版本（只读快照）id */
  approvedIds: string[]
  approvalRecords: ApprovalRecord[]
  /** 最近一次审批尝试的失败明细（失败时保留原草案与冲突明细） */
  lastApproval: (ApprovalResult & { attemptedAt: string }) | null
  importedPackages: ImportedPackageRecord[]
  selectedWindowId: string
  selectedTerritory: string

  headVersion: () => DraftVersion
  currentVersion: () => DraftVersion
  windows: () => LicenseWindow[]
  comments: () => RightsComment[]
  inspectVersion: (id: string) => void
  backToLatest: () => void
  updateWindow: (id: string, patch: Partial<LicenseWindow>) => void
  batchShift: (ids: string[], days: number) => void
  addComment: (input: { windowId: string; content: string; author?: string; role?: string }) => string
  acceptComment: (id: string, by?: string) => AcceptCommentResult
  closeStaleComment: (id: string, reason?: string) => void
  approveDraft: () => ApprovalResult
  exportPackage: () => ApprovalPackage
  importPackage: (pkg: ApprovalPackage, fileName: string) => ImportedPackageRecord
  selectWindow: (id: string) => void
  reset: () => void
}

let localSeq = 100
function nextVersionId(chain: DraftVersion[]): string {
  const maxNo = chain.reduce((max, version) => Math.max(max, version.no), 18)
  // 从现有版本链里回收最大的本地序号，避免持久化重载后撞号
  const maxSeq = chain.reduce((max, version) => {
    const matched = /-(\d+)$/.exec(version.id)
    return matched ? Math.max(max, Number(matched[1])) : max
  }, localSeq)
  localSeq = maxSeq + 1
  return `v${maxNo + 1}-${localSeq}`
}

function nowTime() {
  return new Date().toISOString()
}

/** 窗口快照（深拷贝，保证旧版本不可变） */
function snapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * 提交新版本：窗口或意见任一处变动都生成新草案版本，
 * 与上一版串成 parent 链。
 */
function commitVersion(
  state: RightsState,
  input: {
    windows: LicenseWindow[]
    comments: RightsComment[]
    reason: DraftVersion['reason']
    summary: string
    changes: string[]
  },
): Partial<RightsState> {
  const parent = state.chain.find((version) => version.id === state.currentId) ?? state.chain[state.chain.length - 1]!
  const id = nextVersionId(state.chain)
  const version: DraftVersion = {
    id,
    no: parent.no + 1,
    parentId: parent.id,
    author: CURRENT_USER,
    time: nowTime(),
    reason: input.reason,
    summary: input.summary,
    changes: input.changes,
    windows: snapshot(input.windows),
    comments: snapshot(input.comments),
  }
  return { chain: [...state.chain, version], currentId: id }
}

/** 汇总窗口变动；触及日期/地区/独占的差异行用于版本说明 */
function windowChangeLines(diff: Record<string, ReturnType<typeof diffWindows>[string]>): string[] {
  const lines: string[] = []
  for (const [windowId, diffs] of Object.entries(diff)) {
    for (const item of diffs) {
      lines.push(item.field === '__new__' || item.field === '__removed__' ? `${windowId} ${item.to}` : `${windowId} ${formatDiffLine(item)}`)
    }
  }
  return lines
}

export const useRightsStore = create<RightsState>()(
  persist(
    (set, get) => {
      /** 日期/地区/独占变动后，把锚定旧窗口版本的待处理意见标记为过期，拒绝继续合并 */
      const expireStaleComments = (comments: RightsComment[], nextWindows: LicenseWindow[], chain: DraftVersion[], nextVersionId: string): { comments: RightsComment[]; expired: RightsComment[]; diffLines: string[] } => {
        const probe: DraftVersion = { id: nextVersionId, no: 0, parentId: null, author: '', time: '', reason: '窗口调整', summary: '', changes: [], windows: nextWindows, comments }
        const expired: RightsComment[] = []
        const diffLines: string[] = []
        const next = comments.map((comment) => {
          if (isResolved(comment) || comment.windowVersionId === nextVersionId) return comment
          const diffs = commentAnchorDiffs(comment, probe, chain)
          if (!diffs.length) return comment
          expired.push(comment)
          diffLines.push(`${comment.id}（${comment.anchor}）锚定 ${comment.windowVersionId}：${diffs.map((d) => `${d.label} ${d.anchored} → ${d.current}`).join('、')}`)
          return {
            ...comment,
            resolution: {
              kind: 'closed' as const,
              time: nowTime(),
              by: CURRENT_USER,
              reason: `窗口版本已由 ${comment.windowVersionId} 变动，旧意见自动失效：${diffs.map((d) => `${d.label} ${d.anchored} → ${d.current}`).join('；')}`,
            },
          }
        })
        return { comments: next, expired, diffLines }
      }

      const applyWindowChange = (nextWindows: LicenseWindow[], summary: string): void => {
        const state = get()
        const current = state.headVersion()
        const diff = diffWindows(current.windows, nextWindows)
        if (!Object.keys(diff).length) return
        const lines = windowChangeLines(diff)
        // 现有意见只可能锚定已提交版本；用哨兵表示「即将提交的新版本」
        const { comments: nextComments, diffLines } = expireStaleComments(current.comments, nextWindows, state.chain, '__pending__')
        set(commitVersion(state, {
          windows: nextWindows,
          comments: nextComments,
          reason: '窗口调整',
          summary: touchesAnchoredFields(Object.values(diff).flat()) ? `${summary}（触及日期/地区/独占，锚定旧版本的意见已失效）` : summary,
          changes: [...lines, ...diffLines.map((line) => `意见失效：${line}`)],
        }))
      }

      return {
        chain: seedChain,
        currentId: 'v18',
        viewId: null,
        approvedIds: ['v17'],
        approvalRecords: [{
          versionId: 'v17',
          approver: APPROVER,
          time: '2026-10-04T14:20:00',
          commentResults: v17CommentResults(),
        }],
        lastApproval: null,
        importedPackages: [],
        selectedWindowId: 'RW-102',
        selectedTerritory: '全部地区',

        headVersion: () => {
          const state = get()
          return state.chain.find((version) => version.id === state.currentId) ?? state.chain[state.chain.length - 1]!
        },
        // 查看历史版本时返回该版本快照（只读）；否则返回版本链头部最新草案
        currentVersion: () => {
          const state = get()
          if (state.viewId) {
            const viewed = state.chain.find((version) => version.id === state.viewId)
            if (viewed) return viewed
          }
          return state.chain.find((version) => version.id === state.currentId) ?? state.chain[state.chain.length - 1]!
        },
        windows: () => get().currentVersion().windows,
        comments: () => get().currentVersion().comments,

        inspectVersion: (id) => set({ viewId: id }),
        backToLatest: () => set({ viewId: null }),

        updateWindow: (id, patch) => {
          const current = get().headVersion()
          const nextWindows = current.windows.map((item) =>
            item.id === id ? { ...item, ...patch, status: '草案' as const } : item,
          )
          applyWindowChange(nextWindows, `调整窗口 ${id} 条款`)
        },

        batchShift: (ids, days) => {
          const current = get().headVersion()
          const nextWindows = current.windows.map((item) => (ids.includes(item.id) ? shiftWindow(item, days) : item))
          applyWindowChange(nextWindows, `批量调窗 ${ids.length} 个窗口（${days > 0 ? '+' : ''}${days} 天）`)
        },

        addComment: ({ windowId, content, author = '黎清', role = '法务' }) => {
          const state = get()
          const current = state.headVersion()
          const win = current.windows.find((item) => item.id === windowId)
          const comment: RightsComment = {
            id: `CM-${Date.now().toString(36)}`,
            windowVersionId: current.id,
            windowId,
            channel: win?.channel ?? '',
            anchor: `${windowId} · 条款意见`,
            author,
            role,
            content,
            resolution: { kind: 'pending' },
          }
          set(commitVersion(state, {
            windows: current.windows,
            comments: [...current.comments, comment],
            reason: '条款意见',
            summary: `${role} ${author} 对 ${windowId} 提交条款意见`,
            changes: [`新增意见 ${comment.id}，锚定窗口版本 ${current.id}`],
          }))
          return comment.id
        },

        acceptComment: (id, by = CURRENT_USER) => {
          const state = get()
          const current = state.headVersion()
          const comment = current.comments.find((item) => item.id === id)
          if (!comment) return { ok: false, message: '意见不存在。', diffs: [] }
          if (isResolved(comment)) return { ok: false, message: '该意见已处理，无需重复接受。', diffs: [] }

          // 接受意见时核对它锚定的窗口版本
          if (comment.windowVersionId !== current.id) {
            const diffs = commentAnchorDiffs(comment, current, state.chain)
            if (diffs.length) {
              // 版本过期：拒绝合并并列出差异
              return {
                ok: false,
                message: `意见锚定 ${comment.windowVersionId}，当前为 ${current.id}，窗口已变动，拒绝合并。`,
                diffs: diffs.map((diff) => ({ label: diff.label, anchored: diff.anchored, current: diff.current })),
              }
            }
          }

          const nextComments = current.comments.map((item) =>
            item.id === id
              ? { ...item, resolution: { kind: 'accepted' as const, versionId: current.id, time: nowTime(), by } }
              : item,
          )
          const committed = commitVersion(state, {
            windows: current.windows,
            comments: nextComments,
            reason: '接受意见',
            summary: `接受 ${comment.role} ${comment.author} 的意见 ${comment.id}（锚定 ${comment.windowVersionId}）`,
            changes: [`意见 ${comment.id} 已接受并合并，核对窗口版本 ${comment.windowVersionId} 一致`],
          })
          set(committed)
          const newId = (committed.chain!.at(-1) as DraftVersion).id
          return { ok: true, message: `已核对锚定版本 ${comment.windowVersionId}，意见合并到 ${newId}。`, diffs: [], versionId: newId }
        },

        closeStaleComment: (id, reason = '旧意见与当前窗口版本不符，手动关闭。') => {
          const state = get()
          const current = state.headVersion()
          if (!current.comments.some((item) => item.id === id && item.resolution.kind === 'pending')) return
          const nextComments = current.comments.map((item) =>
            item.id === id ? { ...item, resolution: { kind: 'closed' as const, time: nowTime(), by: CURRENT_USER, reason } } : item,
          )
          set(commitVersion(state, {
            windows: current.windows,
            comments: nextComments,
            reason: '关闭过期意见',
            summary: `关闭过期意见 ${id}`,
            changes: [`意见 ${id} 关闭：${reason}`],
          }))
        },

        approveDraft: () => {
          const state = get()
          // 审批只接受当前版本（版本链头部）；查看历史快照时不允许审批
          const current = state.headVersion()
          const blockers: ApprovalBlocker[] = []

          if (state.viewId && state.viewId !== current.id) {
            blockers.push({ type: '非当前版本', detail: `正在查看历史版本 ${state.viewId}，审批只接受当前草案 ${current.id}。` })
          }
          if (state.approvedIds.includes(current.id)) {
            blockers.push({ type: '非当前版本', detail: `版本 ${current.id} 已是只读审批快照，不能重复审批。` })
          }
          // 高风险冲突
          const high = highRiskConflicts(findConflicts(current.windows))
          for (const issue of high) {
            blockers.push({ type: '高风险冲突', detail: `${issue.title}：${issue.explanation}`, windowIds: issue.windowIds })
          }
          // 待处理意见（含锚定版本过期的）
          for (const comment of current.comments.filter((item) => item.resolution.kind === 'pending')) {
            const stale = isCommentStale(comment, current, state.chain)
            blockers.push({
              type: '待处理意见',
              detail: stale
                ? `${comment.id} 锚定 ${comment.windowVersionId} 的窗口已变动，须重新提意见或关闭。`
                : `${comment.id} ${comment.role}·${comment.author}：${comment.content}`,
              commentId: comment.id,
            })
          }

          const result: ApprovalResult & { attemptedAt: string } = {
            ok: blockers.length === 0,
            versionId: current.id,
            blockers,
            attemptedAt: nowTime(),
          }

          if (!result.ok) {
            // 失败时保留原草案与冲突明细：不产生新版本
            set({ lastApproval: result })
            return result
          }

          const record: ApprovalRecord = {
            versionId: current.id,
            approver: APPROVER,
            time: nowTime(),
            commentResults: current.comments.map((comment) => ({
              commentId: comment.id,
              author: comment.author,
              content: comment.content,
              outcome: comment.resolution.kind === 'accepted' ? 'accepted' as const
                : comment.resolution.kind === 'rejected' ? 'rejected' as const
                : comment.resolution.kind === 'closed' ? 'closed' as const
                : 'pending' as const,
              note: comment.resolution.kind === 'accepted'
                ? `已于 ${comment.resolution.versionId} 核对锚定窗口后接受`
                : comment.resolution.kind === 'closed'
                  ? comment.resolution.reason
                  : '',
            })),
          }
          // 通过的版本变成只读快照：生成快照版本并固化
          const snapshotVersion: DraftVersion = {
            ...current,
            reason: '审批快照',
            windows: current.windows.map((win) => ({ ...win, status: win.status === '冲突' ? '已确认' : win.status })),
          }
          set({
            approvedIds: [...state.approvedIds, current.id],
            approvalRecords: [...state.approvalRecords, record],
            chain: state.chain.map((version) => (version.id === snapshotVersion.id ? snapshotVersion : version)),
            lastApproval: { ...result, record, attemptedAt: nowTime() },
          })
          return { ok: true, versionId: current.id, blockers: [], record }
        },

        exportPackage: () => {
          const state = get()
          const current = state.currentVersion()
          const approved = state.approvedIds.includes(current.id)
          const record = state.approvalRecords.find((item) => item.versionId === current.id)
          const conflicts = findConflicts(current.windows)
          const pkg: ApprovalPackage = {
            packageFormat: 'rights-approval-package/v2',
            versionId: current.id,
            versionNo: current.no,
            parentId: current.parentId,
            generatedAt: nowTime(),
            kind: approved ? 'approved' : 'draft',
            approvedAt: record?.time,
            approver: record?.approver,
            windows: snapshot(current.windows),
            conflicts: conflicts.map((issue) => ({ id: issue.id, type: issue.type, severity: issue.severity, title: issue.title, windowIds: issue.windowIds })),
            commentResults: current.comments.map((comment) => ({
              commentId: comment.id,
              author: comment.author,
              content: comment.content,
              outcome: comment.resolution.kind === 'accepted' ? 'accepted' as const
                : comment.resolution.kind === 'rejected' ? 'rejected' as const
                : comment.resolution.kind === 'closed' ? 'closed' as const
                : 'pending' as const,
              note: comment.resolution.kind === 'accepted'
                ? `已于 ${comment.resolution.versionId} 核对锚定窗口后接受`
                : comment.resolution.kind === 'closed'
                  ? comment.resolution.reason
                  : '',
            })),
            changes: current.changes,
            checksum: '',
          }
          return signPackage(pkg)
        },

        importPackage: (pkg, fileName) => {
          const state = get()
          // 重新载入时按版本校验；与本地版本链头部不一致（含后续窗口变动）即标出已失效
          const verification = verifyPackage(pkg, state.chain, state.approvalRecords, state.currentId)
          const record: ImportedPackageRecord = {
            fileName,
            importedAt: nowTime(),
            versionId: pkg.versionId,
            versionNo: pkg.versionNo,
            checksum: pkg.checksum,
            status: verification.status,
            issues: verification.issues,
            approvedAt: pkg.approvedAt,
          }
          set({ importedPackages: [record, ...state.importedPackages] })
          return record
        },

        selectWindow: (id) => set({ selectedWindowId: id }),
        reset: () => set({
          chain: snapshot(seedChain),
          currentId: 'v18',
          viewId: null,
          approvedIds: ['v17'],
          approvalRecords: [{
            versionId: 'v17',
            approver: APPROVER,
            time: '2026-10-04T14:20:00',
            commentResults: v17CommentResults(),
          }],
          lastApproval: null,
          importedPackages: [],
          selectedWindowId: 'RW-102',
          selectedTerritory: '全部地区',
        }),
      }
    },
    {
      name: 'yy53-rights-draft-v2',
      version: 2,
      partialize: (state) => ({
        chain: state.chain,
        currentId: state.currentId,
        viewId: state.viewId,
        approvedIds: state.approvedIds,
        approvalRecords: state.approvalRecords,
        lastApproval: state.lastApproval,
        importedPackages: state.importedPackages,
        selectedWindowId: state.selectedWindowId,
        selectedTerritory: state.selectedTerritory,
      }),
    },
  ),
)

function v17CommentResults() {
  return [
    { commentId: 'CM-31', author: '黎清', content: '流媒体开窗不得早于院线独占结束日，请至少顺延至 2026-12-06。', outcome: 'accepted' as const, note: '已于 v17 核对锚定窗口后接受' },
    { commentId: 'CM-32', author: '章宁', content: '中国大陆独占与港澳台授权不冲突，但宣传物料的地区标识必须拆分为两个物料包。', outcome: 'pending' as const, note: '' },
    { commentId: 'CM-33', author: '黎清', content: '允许转授权，但须禁止向短视频平台分发超过 3 分钟的连续片段。', outcome: 'accepted' as const, note: '已于 v17 核对锚定窗口后接受' },
  ]
}

/** 供页面响应式读取冲突（查看历史版本时反映该快照的冲突） */
export function useConflicts() {
  const currentId = useRightsStore((state) => state.currentId)
  const viewId = useRightsStore((state) => state.viewId)
  const version = useRightsStore((state) => state.chain.find((v) => v.id === (viewId ?? currentId)))
  return findConflicts(version?.windows ?? initialWindows)
}

export { initialComments, initialWindows }
