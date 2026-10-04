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

/** 意见锚定窗口时的关键条款快照：日期、地区、独占 */
export interface AnchorSnapshot {
  start: string
  end: string
  territory: Territory
  exclusive: boolean
}

export interface RightsComment {
  id: string
  channel: string
  anchor: string
  /** 锚定的窗口 id */
  anchorWindowId: string
  /** 锚定时的草案版本号 */
  anchorVersion: number
  /** 锚定时的窗口条款快照，用于接受意见前核对 */
  anchorSnapshot: AnchorSnapshot
  author: string
  role: string
  content: string
  resolved: boolean
  resolvedAtVersion?: number
}

export interface DraftVersion {
  id: string
  author: string
  time: string
  summary: string
  changes: string[]
}

/** 版本链记录：任一处变动都生成新草案版本 */
export interface VersionRecord {
  version: number
  time: string
  kind: '窗口变更' | '批量调窗' | '意见新增' | '意见接受' | '意见拒绝' | '审批快照'
  summary: string
}

/** 锚点差异：日期、地区或独占变动即判定过期 */
export interface AnchorDiff {
  field: 'start' | 'end' | 'territory' | 'exclusive' | 'window'
  label: string
  before: string
  after: string
}

/** 拒绝合并时保留的差异明细 */
export interface MergeFailure {
  commentId: string
  commentAuthor: string
  anchor: string
  atVersion: number
  diffs: AnchorDiff[]
}

/** 审批未通过时的阻塞项 */
export interface ApprovalBlocker {
  kind: '冲突' | '意见'
  id: string
  title: string
  detail: string
}

export interface ApprovalResult {
  ok: boolean
  version: number
  at: string
  blockers: ApprovalBlocker[]
}

/** 只读快照：通过审批的版本冻结为只读 */
export interface ApprovalSnapshot {
  version: number
  approvedAt: string
  windows: LicenseWindow[]
  comments: RightsComment[]
  conflictCount: { high: number; medium: number }
}

export interface PackageCommentResult {
  id: string
  anchor: string
  author: string
  role: string
  content: string
  resolution: 'accepted' | 'pending'
  anchoredVersion: number
}

/** 审批包：带版本号、意见处理结果和窗口数据，重新载入时按版本校验 */
export interface ApprovalPackage {
  packageId: string
  version: number
  generatedAt: string
  approvedAt: string
  windows: LicenseWindow[]
  commentResults: PackageCommentResult[]
  highRiskConflictCount: number
  checksum: string
  status: 'valid' | 'expired'
  invalidReasons: string[]
}
