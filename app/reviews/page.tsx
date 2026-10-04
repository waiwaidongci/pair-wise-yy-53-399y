'use client'

import { useMemo, useRef, useState } from 'react'
import {
  Box, Flex, Grid, Heading, Text, Badge, Button, Textarea, Tabs, TabList, Tab, TabPanels, TabPanel,
  useToast, HStack, Alert, AlertIcon, AlertTitle, AlertDescription, Divider,
} from '@chakra-ui/react'
import { useRightsStore, useConflicts, useFrozen } from '@/store/rights'
import { isStale, diffAnchor } from '@/lib/version-chain'
import type { ApprovalPackage } from '@/lib/types'

const kindColor: Record<string, string> = {
  窗口变更: 'blue',
  批量调窗: 'cyan',
  意见新增: 'purple',
  意见接受: 'green',
  意见拒绝: 'red',
  审批快照: 'teal',
}

export default function ReviewsPage() {
  const comments = useRightsStore((state) => state.comments)
  const windows = useRightsStore((state) => state.windows)
  const version = useRightsStore((state) => state.version)
  const history = useRightsStore((state) => state.history)
  const snapshots = useRightsStore((state) => state.snapshots)
  const packages = useRightsStore((state) => state.packages)
  const selectedWindowId = useRightsStore((state) => state.selectedWindowId)
  const lastMergeFailure = useRightsStore((state) => state.lastMergeFailure)
  const lastApprovalResult = useRightsStore((state) => state.lastApprovalResult)
  const acceptComment = useRightsStore((state) => state.acceptComment)
  const addComment = useRightsStore((state) => state.addComment)
  const approveDraft = useRightsStore((state) => state.approveDraft)
  const exportPackage = useRightsStore((state) => state.exportPackage)
  const reloadPackage = useRightsStore((state) => state.reloadPackage)
  const conflicts = useConflicts()
  const frozen = useFrozen()
  const toast = useToast()

  const [draft, setDraft] = useState('流媒体开窗日期以院线独占结束次日为准，并单独拆分港澳台物料。')
  const fileRef = useRef<HTMLInputElement>(null)

  const staleIds = useMemo(() => new Set(comments.filter((c) => isStale(c, windows)).map((c) => c.id)), [comments, windows])
  const highCount = conflicts.filter((c) => c.severity === '高').length
  const pendingCount = comments.filter((c) => !c.resolved).length
  const approved = snapshots.some((s) => s.version === version)

  function handleAccept(id: string) {
    const comment = comments.find((c) => c.id === id)
    if (!comment) return
    const diffs = diffAnchor(comment, windows.find((w) => w.id === comment.anchorWindowId))
    if (diffs.length > 0) {
      toast({ title: '锚定版本已过期，拒绝合并', description: diffs.map((d) => `${d.label}：${d.before} → ${d.after}`).join('；'), status: 'error', duration: 6000 })
      return
    }
    acceptComment(id)
    toast({ title: '意见已合并', description: `草案版本推进到 v${version + 1}。`, status: 'success' })
  }

  function handleAddComment() {
    if (!draft.trim()) return
    addComment({ channel: '', content: draft.trim(), author: '当前用户', role: '发行' })
    setDraft('')
    toast({ title: '意见已锚定当前窗口版本', description: `锚定 v${version}，窗口变动后需重新核对。`, status: 'success' })
  }

  function handleApprove() {
    approveDraft()
    const result = useRightsStore.getState().lastApprovalResult
    if (result?.ok) toast({ title: `审批通过 · v${result.version} 已冻结为只读快照`, status: 'success' })
    else toast({ title: '审批未通过，原草案保留', description: result?.blockers.map((b) => b.title).join('；'), status: 'error', duration: 7000 })
  }

  function handleExport() {
    const pkg = exportPackage()
    if (!pkg) {
      toast({ title: '暂无已审批快照', description: '请先通过审批生成只读快照，再导出审批包。', status: 'warning' })
      return
    }
    const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `发行权审批包-v${pkg.version}.json`
    link.click()
    URL.revokeObjectURL(link.href)
    toast({ title: '审批包已导出', description: `v${pkg.version} · 含意见处理结果与窗口数据。`, status: 'success' })
  }

  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const pkg = JSON.parse(String(reader.result)) as ApprovalPackage
        if (!pkg.packageId || typeof pkg.version !== 'number') throw new Error('缺少版本号')
        reloadPackage(pkg)
        const reloaded = useRightsStore.getState().packages.find((p) => p.packageId === pkg.packageId)
        if (reloaded?.status === 'expired') toast({ title: '审批包已失效', description: reloaded.invalidReasons.join('；'), status: 'warning', duration: 7000 })
        else toast({ title: '审批包版本校验通过', description: `v${pkg.version} 与当前版本一致。`, status: 'success' })
      } catch {
        toast({ title: '审批包无法识别', description: '请选择由本平台导出的审批包 JSON 文件。', status: 'error' })
      }
    }
    reader.readAsText(file)
    event.target.value = ''
  }

  return (
    <Box>
      <Flex justify="space-between" mb={5} gap={4} direction={{ base: 'column', md: 'row' }}>
        <Box>
          <Text color="brand.600" fontSize="xs" fontWeight="bold">VERSION CHAIN & APPROVAL</Text>
          <Heading fontSize="3xl" my={1}>版本链与审批</Heading>
          <Text color="gray.600">窗口、意见与审批包共用一条版本链：任一变动生成新草案，接受意见核对锚定版本，过期拒绝合并并列出差异。</Text>
        </Box>
        <HStack>
          <Badge colorScheme={frozen ? 'teal' : 'blue'} variant="subtle" px={3} py={1} borderRadius="full">当前 v{version} · {frozen ? '只读快照' : '草案可编辑'}</Badge>
          <Button colorScheme="blue" onClick={handleExport}>导出审批包</Button>
        </HStack>
      </Flex>

      {frozen && (
        <Alert status="success" mb={4} borderRadius="8px">
          <AlertIcon />
          <Box>
            <AlertTitle>v{version} 已审批通过并冻结为只读快照</AlertTitle>
            <AlertDescription>窗口数据已保留在快照中。任何修改将生成新的草案版本，审批包按版本号校验。</AlertDescription>
          </Box>
        </Alert>
      )}

      <Tabs colorScheme="blue" variant="enclosed">
        <TabList>
          <Tab>条款意见 {pendingCount > 0 && <Badge ml={2} colorScheme="orange">{pendingCount} 待处理</Badge>}</Tab>
          <Tab>版本差异 {history.length > 0 && <Badge ml={2}>{history.length}</Badge>}</Tab>
          <Tab>审批与快照 {highCount > 0 && <Badge ml={2} colorScheme="red">{highCount} 高风险</Badge>}</Tab>
        </TabList>
        <TabPanels>
          {/* 条款意见 */}
          <TabPanel px={0} pt={4}>
            <Grid templateColumns={{ base: '1fr', lg: '1.3fr .8fr' }} gap={4}>
              <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px">
                {comments.map((comment) => {
                  const stale = staleIds.has(comment.id)
                  const win = windows.find((w) => w.id === comment.anchorWindowId)
                  const diffs = stale ? diffAnchor(comment, win) : []
                  return (
                    <Box key={comment.id} p={4} borderBottom="1px solid" borderColor="gray.100">
                      <Flex justify="space-between" align="flex-start">
                        <Box>
                          <Text fontWeight="700">{comment.role} · {comment.author}</Text>
                          <Text color="gray.500" fontSize="xs">{comment.anchor}</Text>
                          <HStack mt={1} spacing={2}>
                            <Badge size="sm" variant="outline">锚定 v{comment.anchorVersion}</Badge>
                            <Badge size="sm" variant="outline" colorScheme="blue">当前 v{version}</Badge>
                            {stale && <Badge size="sm" colorScheme="red">已过期</Badge>}
                          </HStack>
                        </Box>
                        <Badge colorScheme={comment.resolved ? 'green' : 'orange'}>{comment.resolved ? '已解决' : '待处理'}</Badge>
                      </Flex>
                      <Text color="gray.600" mt={3}>{comment.content}</Text>
                      {stale && (
                        <Alert status="error" mt={3} borderRadius="6px" py={2}>
                          <AlertIcon />
                          <Box fontSize="sm">
                            <AlertTitle fontSize="sm">锚定版本已过期，拒绝合并</AlertTitle>
                            <AlertDescription>
                              {diffs.map((d) => `${d.label}：${d.before} → ${d.after}`).join('；')}
                            </AlertDescription>
                          </Box>
                        </Alert>
                      )}
                      {!comment.resolved && (
                        <Button
                          mt={3}
                          size="sm"
                          colorScheme={stale ? 'gray' : 'blue'}
                          variant={stale ? 'outline' : 'solid'}
                          isDisabled={stale}
                          onClick={() => handleAccept(comment.id)}
                        >
                          {stale ? '版本过期 · 拒绝合并' : '接受并合并条款'}
                        </Button>
                      )}
                    </Box>
                  )
                })}
              </Box>

              <Box>
                <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={4} mb={4}>
                  <Heading size="md" mb={3}>发表评论锚点</Heading>
                  <Text color="gray.500" fontSize="sm" mb={2}>锚定当前选中窗口，记录其日期、地区与独占快照。</Text>
                  <Badge mb={3}>{windows.find((w) => w.id === selectedWindowId)?.id ?? '未选窗口'} · 当前 v{version}</Badge>
                  <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={5} />
                  <Button mt={3} colorScheme="blue" isDisabled={!draft.trim()} onClick={handleAddComment}>提交意见并锚定版本</Button>
                </Box>

                {lastMergeFailure && (
                  <Alert status="error" borderRadius="8px">
                    <AlertIcon />
                    <Box>
                      <AlertTitle fontSize="sm">已拒绝合并 {lastMergeFailure.commentAuthor} 的意见</AlertTitle>
                      <AlertDescription fontSize="sm">
                        <Text>锚点：{lastMergeFailure.anchor}（v{lastMergeFailure.atVersion}）</Text>
                        <Text mt={1}>差异：{lastMergeFailure.diffs.map((d) => `${d.label} ${d.before} → ${d.after}`).join('；')}</Text>
                        <Text mt={1} color="gray.500">原意见保留为待处理，未并入草案。</Text>
                      </AlertDescription>
                    </Box>
                  </Alert>
                )}
              </Box>
            </Grid>
          </TabPanel>

          {/* 版本差异 */}
          <TabPanel px={0} pt={4}>
            <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={4}>
              <Heading size="md" mb={1}>版本链</Heading>
              <Text color="gray.500" fontSize="sm" mb={4}>窗口、意见与审批共用同一版本号，任一变动生成新草案。</Text>
              {history.length === 0 && <Text color="gray.400" fontSize="sm">暂无版本变动记录。</Text>}
              {history.map((record, index) => (
                <HStack key={`${record.version}-${index}`} align="flex-start" mb={3} spacing={3}>
                  <Badge colorScheme={kindColor[record.kind] ?? 'gray'} minW="64px" textAlign="center">v{record.version}</Badge>
                  <Box>
                    <Text fontWeight="600" fontSize="sm">{record.summary}</Text>
                    <Text color="gray.500" fontSize="xs">{record.kind} · {new Date(record.time).toLocaleString('zh-CN')}</Text>
                  </Box>
                </HStack>
              ))}
            </Box>
          </TabPanel>

          {/* 审批与快照 */}
          <TabPanel px={0} pt={4}>
            <Grid templateColumns={{ base: '1fr', lg: '1.2fr .8fr' }} gap={4}>
              <Box>
                <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={4} mb={4}>
                  <Flex justify="space-between" align="center" mb={3}>
                    <Box>
                      <Heading size="md">发行负责人审批</Heading>
                      <Text color="gray.500" fontSize="sm">仅接受当前版本：无高风险冲突且无待处理意见。</Text>
                    </Box>
                    <Badge colorScheme={approved ? 'teal' : 'blue'} fontSize="sm" px={3} py={1}>v{version} · {approved ? '已快照' : '待审批'}</Badge>
                  </Flex>
                  <HStack mb={3} spacing={4}>
                    <Text fontSize="sm">高风险冲突 <Badge colorScheme={highCount ? 'red' : 'green'}>{highCount}</Badge></Text>
                    <Text fontSize="sm">待处理意见 <Badge colorScheme={pendingCount ? 'orange' : 'green'}>{pendingCount}</Badge></Text>
                  </HStack>
                  <Button colorScheme="blue" w="100%" onClick={handleApprove} isDisabled={approved}>
                    {approved ? '当前版本已通过审批' : '发起审批'}
                  </Button>
                </Box>

                {lastApprovalResult && !lastApprovalResult.ok && (
                  <Alert status="error" borderRadius="8px" mb={4}>
                    <AlertIcon />
                    <Box>
                      <AlertTitle>审批未通过 · v{lastApprovalResult.version} 原草案保留</AlertTitle>
                      <AlertDescription>
                        {lastApprovalResult.blockers.map((b) => (
                          <Text key={b.id} mt={1} fontSize="sm">· [{b.kind}] {b.title} — {b.detail}</Text>
                        ))}
                      </AlertDescription>
                    </Box>
                  </Alert>
                )}

                {lastApprovalResult?.ok && (
                  <Alert status="success" borderRadius="8px" mb={4}>
                    <AlertIcon />
                    <Box>
                      <AlertTitle>审批通过 · v{lastApprovalResult.version} 已冻结为只读快照</AlertTitle>
                      <AlertDescription>窗口数据已冻结，可导出带版本号的审批包。</AlertDescription>
                    </Box>
                  </Alert>
                )}

                <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={4}>
                  <Heading size="md" mb={3}>只读快照</Heading>
                  {snapshots.length === 0 && <Text color="gray.400" fontSize="sm">暂无通过审批的版本。</Text>}
                  {snapshots.map((s) => (
                    <Box key={s.version} p={3} border="1px solid" borderColor="gray.100" borderRadius="6px" mb={2}>
                      <Flex justify="space-between">
                        <Text fontWeight="700">v{s.version}</Text>
                        <Badge colorScheme="teal">只读</Badge>
                      </Flex>
                      <Text color="gray.500" fontSize="xs">{new Date(s.approvedAt).toLocaleString('zh-CN')} · {s.windows.length} 个窗口 · {s.comments.filter((c) => c.resolved).length}/{s.comments.length} 意见已处理</Text>
                    </Box>
                  ))}
                </Box>
              </Box>

              <Box>
                <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={4} mb={4}>
                  <Heading size="md" mb={1}>审批包</Heading>
                  <Text color="gray.500" fontSize="sm" mb={3}>导出带版本号、意见处理结果与窗口数据；重新载入按版本校验。</Text>
                  <HStack>
                    <Button colorScheme="blue" size="sm" onClick={handleExport}>导出审批包</Button>
                    <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>载入审批包校验</Button>
                    <input ref={fileRef} type="file" accept="application/json" hidden onChange={handleFile} />
                  </HStack>
                </Box>

                {packages.length === 0 && (
                  <Box bg="white" border="1px dashed" borderColor="gray.300" borderRadius="8px" p={4}><Text color="gray.400" fontSize="sm">尚未导出审批包。</Text></Box>
                )}
                {packages.map((pkg) => (
                  <Box key={pkg.packageId} bg="white" border="1px solid" borderColor={pkg.status === 'expired' ? 'red.200' : 'gray.200'} borderRadius="8px" p={4} mb={3}>
                    <Flex justify="space-between" align="flex-start">
                      <Box>
                        <Text fontWeight="700">审批包 v{pkg.version}</Text>
                        <Text color="gray.500" fontSize="xs">{pkg.packageId} · {new Date(pkg.generatedAt).toLocaleString('zh-CN')}</Text>
                      </Box>
                      <Badge colorScheme={pkg.status === 'expired' ? 'red' : 'green'}>{pkg.status === 'expired' ? '已失效' : '有效'}</Badge>
                    </Flex>
                    <Divider my={2} />
                    <Text fontSize="xs" color="gray.600">{pkg.windows.length} 个窗口 · {pkg.commentResults.filter((c) => c.resolution === 'accepted').length}/{pkg.commentResults.length} 意见已接受 · 高风险冲突 {pkg.highRiskConflictCount}</Text>
                    {pkg.status === 'expired' && (
                      <Alert status="error" mt={2} borderRadius="6px" py={2}>
                        <AlertIcon />
                        <AlertDescription fontSize="xs">{pkg.invalidReasons.join('；')}</AlertDescription>
                      </Alert>
                    )}
                    <HStack mt={2}>
                      <Button size="xs" variant="outline" onClick={() => { reloadPackage(pkg); toast({ title: '已按当前版本重新校验', status: 'info' }) }}>重新校验</Button>
                      <Button size="xs" variant="ghost" onClick={() => { navigator.clipboard?.writeText(JSON.stringify(pkg, null, 2)); toast({ title: '审批包 JSON 已复制', status: 'success' }) }}>复制 JSON</Button>
                    </HStack>
                  </Box>
                ))}
              </Box>
            </Grid>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </Box>
  )
}
