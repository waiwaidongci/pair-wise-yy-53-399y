export type RightsType = '院线' | '电视' | '流媒体' | '航空' | '非院线'
export type Territory = '中国大陆' | '中国香港' | '中国台湾' | '新加坡' | '马来西亚' | '东南亚区域' | '北美'

export interface LicenseWindow {
  id: string
  workId: string
  work: string
  channel: string
  rights: RightsType
  territory: Territory
  start: string
  end: string
  exclusive: boolean
  sublicense: boolean
  priority: number
  status: '草案' | '冲突' | '已确认'
}

/** 条款意见锚定的窗口版本字段；只跟踪会让旧意见失效的维度 */
export interface WindowAnchor {
  start: string
  end: string
  territory: Territory
  exclusive: boolean
}

export type CommentResolution =
  | { kind: 'pending' }
  | { kind: 'accepted'; versionId: string; time: string; by: string }
  | { kind: 'rejected'; versionId: string; time: string; by: string; reason: string }
  | { kind: 'closed'; time: string; by: string; reason: string }

export interface RightsComment {
  id: string
  /** 锚定的窗口版本（草案版本 id） */
  windowVersionId: string
  /** 锚定的窗口 id */
  windowId: string
  channel: string
  anchor: string
  author: string
  role: string
  content: string
  resolution: CommentResolution
}

/** 单个字段的锚定差异 */
export interface AnchorFieldDiff {
  field: 'start' | 'end' | 'territory' | 'exclusive'
  label: string
  anchored: string
  current: string
}

/** 两个窗口版本之间的完整差异 */
export interface WindowFieldDiff {
  field: string
  label: string
  from: string
  to: string
}

/** 草案版本：窗口、意见、审批包共享同一条版本链 */
export interface DraftVersion {
  id: string
  no: number
  parentId: string | null
  author: string
  time: string
  reason: '窗口调整' | '条款意见' | '接受意见' | '关闭过期意见' | '审批快照' | '初始化'
  summary: string
  changes: string[]
  windows: LicenseWindow[]
  comments: RightsComment[]
}

export interface ApprovalRecord {
  versionId: string
  approver: string
  time: string
  commentResults: {
    commentId: string
    author: string
    content: string
    outcome: 'accepted' | 'pending' | 'rejected' | 'closed'
    note: string
  }[]
}

export interface ApprovalBlocker {
  type: '高风险冲突' | '待处理意见' | '非当前版本'
  detail: string
  windowIds?: string[]
  commentId?: string
}

export interface ApprovalResult {
  ok: boolean
  versionId: string
  blockers: ApprovalBlocker[]
  record?: ApprovalRecord
}

/** 导出的可追溯审批包 */
export interface ApprovalPackage {
  packageFormat: 'rights-approval-package/v2'
  versionId: string
  versionNo: number
  parentId: string | null
  generatedAt: string
  kind: 'approved' | 'draft'
  approvedAt?: string
  approver?: string
  windows: LicenseWindow[]
  conflicts: { id: string; type: string; severity: string; title: string; windowIds: string[] }[]
  commentResults: ApprovalRecord['commentResults']
  changes: string[]
  checksum: string
}

export interface ImportedPackageRecord {
  fileName: string
  importedAt: string
  versionId: string
  versionNo: number
  checksum: string
  status: '校验通过' | '已失效' | '校验失败'
  issues: string[]
  approvedAt?: string
}
