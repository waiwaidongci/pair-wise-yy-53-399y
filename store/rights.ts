import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  LicenseWindow,
  RightsComment,
  VersionRecord,
  ApprovalSnapshot,
  ApprovalPackage,
  MergeFailure,
  ApprovalResult,
} from '@/lib/types'
import { initialComments, initialWindows } from '@/lib/mock-data'
import { findConflicts, shiftWindow } from '@/lib/rules'
import {
  anchorSnapshotOf,
  diffAnchor,
  approvalBlockers,
  buildPackage,
  validatePackage,
} from '@/lib/version-chain'

interface RightsState {
  windows: LicenseWindow[]
  comments: RightsComment[]
  selectedWindowId: string
  selectedTerritory: string
  version: number
  /** 版本链：任一处变动都生成新草案版本 */
  history: VersionRecord[]
  /** 只读快照：通过审批的版本冻结为只读 */
  snapshots: ApprovalSnapshot[]
  /** 导出的审批包，重新载入时按版本校验并标记失效 */
  packages: ApprovalPackage[]
  /** 拒绝合并时保留的差异明细 */
  lastMergeFailure: MergeFailure | null
  /** 最近一次审批结果（含未通过时的冲突明细） */
  lastApprovalResult: ApprovalResult | null
  updateWindow: (id: string, patch: Partial<LicenseWindow>) => void
  batchShift: (ids: string[], days: number) => void
  addComment: (input: { channel: string; content: string; author?: string; role?: string }) => void
  acceptComment: (id: string) => void
  approveDraft: () => void
  exportPackage: () => ApprovalPackage | null
  reloadPackage: (pkg: ApprovalPackage) => void
  validateAllPackages: () => void
  selectWindow: (id: string) => void
  reset: () => void
}

function commit(
  state: RightsState,
  record: Omit<VersionRecord, 'version' | 'time'>,
  bump: boolean,
): { version: number; history: VersionRecord[] } {
  const version = bump ? state.version + 1 : state.version
  return {
    version,
    history: [{ version, time: new Date().toISOString(), ...record }, ...state.history],
  }
}

export const useRightsStore = create<RightsState>()(
  persist(
    (set, get) => ({
      windows: initialWindows,
      comments: initialComments,
      selectedWindowId: 'RW-102',
      selectedTerritory: '全部地区',
      version: 18,
      history: [],
      snapshots: [],
      packages: [],
      lastMergeFailure: null,
      lastApprovalResult: null,

      updateWindow: (id, patch) => set((state) => {
        const target = state.windows.find((item) => item.id === id)
        if (!target) return state
        const { version, history } = commit(state, { kind: '窗口变更', summary: `调整《${target.work}》${target.channel} 窗口条款` }, true)
        return {
          windows: state.windows.map((item) => item.id === id ? { ...item, ...patch, status: '草案' } : item),
          version,
          history,
          lastMergeFailure: null,
        }
      }),

      batchShift: (ids, days) => set((state) => {
        if (!ids.length) return state
        const { version, history } = commit(state, { kind: '批量调窗', summary: `批量调整 ${ids.length} 个窗口，${days > 0 ? '顺延' : '提前'} ${Math.abs(days)} 天` }, true)
        return {
          windows: state.windows.map((item) => ids.includes(item.id) ? shiftWindow(item, days) : item),
          version,
          history,
        }
      }),

      addComment: (input) => set((state) => {
        const target = state.windows.find((item) => item.id === state.selectedWindowId) ?? state.windows[0]
        if (!target) return state
        const id = `CM-${Math.floor(100 + Math.random() * 900)}`
        const comment: RightsComment = {
          id,
          channel: target.channel,
          anchor: `${target.id} · ${target.channel}`,
          anchorWindowId: target.id,
          anchorVersion: state.version,
          anchorSnapshot: anchorSnapshotOf(target),
          author: input.author ?? '当前用户',
          role: input.role ?? '发行',
          content: input.content,
          resolved: false,
        }
        const { version, history } = commit(state, { kind: '意见新增', summary: `新增意见：${comment.anchor}` }, true)
        return { comments: [comment, ...state.comments], version, history }
      }),

      acceptComment: (id) => set((state) => {
        const comment = state.comments.find((item) => item.id === id)
        if (!comment || comment.resolved) return state
        const win = state.windows.find((item) => item.id === comment.anchorWindowId)
        const diffs = diffAnchor(comment, win)
        if (diffs.length > 0) {
          // 版本过期：拒绝合并并列出差异，原意见保持待处理
          return {
            lastMergeFailure: {
              commentId: comment.id,
              commentAuthor: `${comment.role} · ${comment.author}`,
              anchor: comment.anchor,
              atVersion: state.version,
              diffs,
            },
          }
        }
        const { version, history } = commit(state, { kind: '意见接受', summary: `接受并合并意见 ${comment.id}：${comment.anchor}` }, true)
        return {
          comments: state.comments.map((item) => item.id === id ? { ...item, resolved: true, resolvedAtVersion: version } : item),
          version,
          history,
          lastMergeFailure: null,
        }
      }),

      approveDraft: () => set((state) => {
        const conflicts = findConflicts(state.windows)
        const blockers = approvalBlockers(state.windows, state.comments, conflicts)
        const at = new Date().toISOString()
        if (blockers.length > 0) {
          // 审批失败：保留原草案与冲突明细，不生成快照
          return { lastApprovalResult: { ok: false, version: state.version, at, blockers } }
        }
        const snapshot: ApprovalSnapshot = {
          version: state.version,
          approvedAt: at,
          windows: state.windows.map((item) => ({ ...item })),
          comments: state.comments.map((item) => ({ ...item })),
          conflictCount: { high: 0, medium: conflicts.filter((item) => item.severity === '中').length },
        }
        const { history } = commit(state, { kind: '审批快照', summary: `v${state.version} 审批通过，生成只读快照` }, false)
        return {
          snapshots: [snapshot, ...state.snapshots.filter((item) => item.version !== snapshot.version)],
          history,
          lastApprovalResult: { ok: true, version: state.version, at, blockers: [] },
          lastMergeFailure: null,
        }
      }),

      exportPackage: () => {
        const state = get()
        const snapshot = state.snapshots.find((item) => item.version === state.version) ?? state.snapshots[0]
        if (!snapshot) return null
        const conflicts = findConflicts(snapshot.windows)
        const pkg = buildPackage(snapshot, conflicts)
        set((s) => ({ packages: [pkg, ...s.packages] }))
        return pkg
      },

      reloadPackage: (pkg) => set((state) => {
        const validated = validatePackage(pkg, state.version, state.snapshots)
        return { packages: state.packages.map((item) => item.packageId === pkg.packageId ? validated : item) }
      }),

      validateAllPackages: () => set((state) => ({
        packages: state.packages.map((item) => validatePackage(item, state.version, state.snapshots)),
      })),

      selectWindow: (id) => set({ selectedWindowId: id }),
      reset: () => set({
        windows: initialWindows,
        comments: initialComments,
        selectedWindowId: 'RW-102',
        selectedTerritory: '全部地区',
        version: 18,
        history: [],
        snapshots: [],
        packages: [],
        lastMergeFailure: null,
        lastApprovalResult: null,
      }),
    }),
    {
      name: 'yy53-rights-draft-v2',
      version: 1,
      onRehydrateStorage: () => (_state, error) => {
        if (!error) {
          // 重新载入时按版本校验所有审批包，已失效的标记出来
          useRightsStore.getState().validateAllPackages()
        }
      },
    },
  ),
)

export function useConflicts() {
  const windows = useRightsStore((state) => state.windows)
  return findConflicts(windows)
}

/** 当前版本是否已冻结为只读快照 */
export function useFrozen() {
  const version = useRightsStore((state) => state.version)
  const snapshots = useRightsStore((state) => state.snapshots)
  return snapshots.some((item) => item.version === version)
}
