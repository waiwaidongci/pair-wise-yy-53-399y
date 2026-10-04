import type { DraftVersion, LicenseWindow, RightsComment } from './types'

export const initialWindows: LicenseWindow[] = [
  { id: 'RW-101', workId: 'W-001', work: '《远山回声》', channel: '星海影院', rights: '院线', territory: '中国大陆', start: '2026-10-18', end: '2026-12-05', exclusive: true, sublicense: false, priority: 1, status: '冲突' },
  { id: 'RW-102', workId: 'W-001', work: '《远山回声》', channel: '云帆视频', rights: '流媒体', territory: '中国大陆', start: '2026-11-20', end: '2027-11-19', exclusive: true, sublicense: false, priority: 2, status: '冲突' },
  { id: 'RW-103', workId: 'W-001', work: '《远山回声》', channel: '南华卫视', rights: '电视', territory: '中国大陆', start: '2027-01-08', end: '2027-03-31', exclusive: false, sublicense: true, priority: 4, status: '草案' },
  { id: 'RW-104', workId: 'W-002', work: '《深港口岸》', channel: '云帆视频', rights: '流媒体', territory: '新加坡', start: '2026-12-01', end: '2027-05-31', exclusive: true, sublicense: false, priority: 1, status: '已确认' },
  { id: 'RW-105', workId: 'W-002', work: '《深港口岸》', channel: '海岛航空', rights: '航空', territory: '东南亚区域', start: '2027-01-15', end: '2027-07-14', exclusive: false, sublicense: true, priority: 3, status: '草案' },
]

/** v17 已通过审批的只读快照：RW-102 流媒体开窗在院线独占结束之后，无高风险冲突 */
export const v17Windows: LicenseWindow[] = [
  { id: 'RW-101', workId: 'W-001', work: '《远山回声》', channel: '星海影院', rights: '院线', territory: '中国大陆', start: '2026-10-18', end: '2026-12-05', exclusive: true, sublicense: false, priority: 1, status: '已确认' },
  { id: 'RW-102', workId: 'W-001', work: '《远山回声》', channel: '云帆视频', rights: '流媒体', territory: '中国大陆', start: '2026-12-06', end: '2027-12-05', exclusive: true, sublicense: false, priority: 2, status: '已确认' },
  { id: 'RW-103', workId: 'W-001', work: '《远山回声》', channel: '南华卫视', rights: '电视', territory: '中国大陆', start: '2027-01-08', end: '2027-03-31', exclusive: false, sublicense: true, priority: 4, status: '草案' },
  { id: 'RW-104', workId: 'W-002', work: '《深港口岸》', channel: '云帆视频', rights: '流媒体', territory: '新加坡', start: '2026-12-01', end: '2027-05-31', exclusive: true, sublicense: false, priority: 1, status: '已确认' },
  { id: 'RW-105', workId: 'W-002', work: '《深港口岸》', channel: '海岛航空', rights: '航空', territory: '东南亚区域', start: '2027-01-15', end: '2027-07-14', exclusive: false, sublicense: true, priority: 3, status: '草案' },
]

const accepted = (time: string): RightsComment['resolution'] => ({ kind: 'accepted', versionId: 'v17', time, by: '章宁' })

export const v17Comments: RightsComment[] = [
  { id: 'CM-31', windowVersionId: 'v17', windowId: 'RW-102', channel: '星海影院', anchor: 'RW-102 · 流媒体开窗', author: '黎清', role: '法务', content: '流媒体开窗不得早于院线独占结束日，请至少顺延至 2026-12-06。', resolution: accepted('2026-10-04T13:50:00') },
  { id: 'CM-32', windowVersionId: 'v17', windowId: 'RW-102', channel: '云帆视频', anchor: 'RW-102 · 地区范围', author: '章宁', role: '发行', content: '中国大陆独占与港澳台授权不冲突，但宣传物料的地区标识必须拆分为两个物料包。', resolution: { kind: 'pending' } },
  { id: 'CM-33', windowVersionId: 'v17', windowId: 'RW-103', channel: '南华卫视', anchor: 'RW-103 · 次级授权', author: '黎清', role: '法务', content: '允许转授权，但须禁止向短视频平台分发超过 3 分钟的连续片段。', resolution: accepted('2026-10-04T14:00:00') },
]

/** v18 当前草案：流媒体开窗提前到 11-20，与院线独占尾部重叠（高风险），并产生两条新意见 */
export const initialComments: RightsComment[] = [
  ...v17Comments.map((item) => ({ ...item, resolution: item.resolution.kind === 'accepted' ? { ...item.resolution } : item.resolution })),
  { id: 'CM-34', windowVersionId: 'v18', windowId: 'RW-101', channel: '星海影院', anchor: 'RW-101 · 院线独占尾部', author: '黎清', role: '法务', content: '流媒体开窗提前到 11-20，再次与院线独占尾部重叠 15 天，违反独占约束，必须恢复到 12-06 之后。', resolution: { kind: 'pending' } },
  { id: 'CM-35', windowVersionId: 'v18', windowId: 'RW-102', channel: '云帆视频', anchor: 'RW-102 · 独占范围', author: '何屿', role: '渠道', content: '云帆要求将独占改为非独占，以便同步向东南亚区域平台分发。', resolution: { kind: 'pending' } },
]

export const seedChain: DraftVersion[] = [
  {
    id: 'v17', no: 17, parentId: null, author: '章宁', time: '2026-10-04T14:08:00',
    reason: '审批快照', summary: '补充院线优先权和次级授权限制，经审批通过为只读快照',
    changes: ['院线窗口优先级提升为 1', '流媒体开窗顺延至 2026-12-06', '转授权增加地区与时长限制'],
    windows: v17Windows, comments: v17Comments,
  },
  {
    id: 'v18', no: 18, parentId: 'v17', author: '章宁', time: '2026-10-04T16:35:00',
    reason: '窗口调整', summary: '调整《远山回声》流媒体窗口，开窗提前并缩短授权期',
    changes: ['RW-102 开始日期：2026-12-06 → 2026-11-20', 'RW-102 结束日期：2027-12-05 → 2027-11-19'],
    windows: initialWindows, comments: initialComments,
  },
]
