'use client'

import { useMemo, useState } from 'react'
import { Box, Flex, Grid, Heading, Text, Badge, Button, Textarea, Tabs, TabList, Tab, TabPanels, TabPanel, useToast, HStack, VStack } from '@chakra-ui/react'
import { useRightsStore } from '@/store/rights'
import type { ApprovalPackage } from '@/lib/types'
import { findConflicts } from '@/lib/rules'
import { commentAnchorDiffs, diffWindows, isCommentStale } from '@/lib/versioning'

const reasonLabel: Record<string, string> = {
  窗口调整: '窗口调整',
  条款意见: '条款意见',
  接受意见: '接受意见',
  关闭过期意见: '意见失效',
  审批快照: '审批快照',
  初始化: '初始化',
}

export default function ReviewsPage() {
  const chain = useRightsStore((state) => state.chain)
  const currentId = useRightsStore((state) => state.currentId)
  const viewId = useRightsStore((state) => state.viewId)
  const inspectVersion = useRightsStore((state) => state.inspectVersion)
  const backToLatest = useRightsStore((state) => state.backToLatest)
  const version = useRightsStore((state) => state.chain.find((item) => item.id === (state.viewId ?? state.currentId)) ?? state.chain[state.chain.length - 1]!)
  const head = useRightsStore((state) => state.chain.find((item) => item.id === state.currentId) ?? state.chain[state.chain.length - 1]!)
  const comments = version.comments
  const approvedIds = useRightsStore((state) => state.approvedIds)
  const approvalRecords = useRightsStore((state) => state.approvalRecords)
  const lastApproval = useRightsStore((state) => state.lastApproval)
  const importedPackages = useRightsStore((state) => state.importedPackages)
  const acceptComment = useRightsStore((state) => state.acceptComment)
  const closeStaleComment = useRightsStore((state) => state.closeStaleComment)
  const addComment = useRightsStore((state) => state.addComment)
  const approveDraft = useRightsStore((state) => state.approveDraft)
  const exportPackage = useRightsStore((state) => state.exportPackage)
  const importPackage = useRightsStore((state) => state.importPackage)
  const selectedWindowId = useRightsStore((state) => state.selectedWindowId)
  const [draft, setDraft] = useState('流媒体若改为非独占，必须同步补充东南亚区域的独占例外说明。')
  const [staleDiffs, setStaleDiffs] = useState<{ id: string; diffs: { label: string; anchored: string; current: string }[] } | null>(null)
  const toast = useToast()
  const readOnly = approvedIds.includes(version.id)
  const viewingHistory = viewId !== null && viewId !== currentId

  const staleMap = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const comment of comments) {
      if (comment.resolution.kind === 'pending') map.set(comment.id, isCommentStale(comment, version, chain))
    }
    return map
  }, [comments, version, chain])

  function handleAccept(id: string) {
    const result = acceptComment(id)
    if (result.ok) { toast({ title: '意见已接受并合并', description: result.message, status: 'success' }); return }
    if (result.diffs.length) { setStaleDiffs({ id, diffs: result.diffs }); return }
    toast({ title: '无法接受', description: result.message, status: 'warning' })
  }

  function handleExport() {
    const pkg = exportPackage()
    const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `发行权审批包-${pkg.versionId}.json`
    link.click()
    URL.revokeObjectURL(link.href)
    toast({ title: '审批包已导出', description: `${pkg.versionId} · ${pkg.kind === 'approved' ? '只读审批快照' : '草案'}，含版本号、意见处理结果与窗口数据。`, status: 'success' })
  }

  function handleImport(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const pkg = JSON.parse(String(reader.result)) as ApprovalPackage
        if (pkg.packageFormat !== 'rights-approval-package/v2') throw new Error('format')
        const record = importPackage(pkg, file.name)
        toast({
          title: `审批包校验：${record.status}`,
          description: record.issues[0] ?? `版本 ${record.versionId} 与本地版本链一致。`,
          status: record.status === '校验通过' ? 'success' : record.status === '已失效' ? 'warning' : 'error',
          duration: 6000,
        })
      } catch {
        toast({ title: '审批包格式不受支持', description: '请导入本台导出的 rights-approval-package/v2 文件。', status: 'error' })
      }
    }
    reader.readAsText(file)
  }

  function handleApprove() {
    const result = approveDraft()
    if (result.ok) toast({ title: `版本 ${result.versionId} 审批通过`, description: '已固化为只读快照，可导出带版本号的审批包。', status: 'success' })
    else toast({ title: `版本 ${result.versionId} 审批被拒绝`, description: `共 ${result.blockers.length} 项阻塞，原草案保留，明细见「审批时间线」。`, status: 'error', duration: 7000 })
  }

  return (
    <Box>
      <Flex justify="space-between" mb={5} gap={4} direction={{ base: 'column', md: 'row' }}>
        <Box><Text color="brand.600" fontSize="xs" fontWeight="bold">VERSION & APPROVAL</Text><Heading fontSize="3xl" my={1}>版本链与条款合并</Heading><Text color="gray.600">窗口、条款意见与审批包串成一条链；接受意见先核对锚定窗口版本，过期即拒绝合并并列出差异。</Text></Box>
        <HStack>
          {viewingHistory ? <Button variant="outline" onClick={backToLatest}>返回最新草案 {currentId}</Button> : <Badge colorScheme={readOnly ? 'gray' : 'blue'} fontSize="sm" px={3} py={1}>{readOnly ? `${version.id} 只读快照` : `当前草案 ${version.id}`}</Badge>}
          <Button variant="outline" as="label" cursor="pointer">重新载入审批包<input type="file" accept="application/json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) handleImport(file); event.target.value = '' }} /></Button>
          <Button colorScheme="blue" onClick={handleExport}>导出审批包</Button>
        </HStack>
      </Flex>
      {viewingHistory && <Box mb={4} p={3} bg="blue.50" borderLeft="3px solid" borderLeftColor="blue.500" borderRadius="6px" fontSize="sm">正在查看历史版本 {version.id}（v{version.no}），页面为只读；接受意见、提交意见与审批只在最新草案 {currentId} 上进行。</Box>}
      <Tabs colorScheme="blue" variant="enclosed">
        <TabList><Tab>条款意见</Tab><Tab>版本链与差异</Tab><Tab>审批与审批包</Tab></TabList>
        <TabPanels>
          <TabPanel px={0} pt={4}>
            <Grid templateColumns={{ base: '1fr', lg: '1.3fr .8fr' }} gap={4}>
              <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px">
                {comments.map((comment) => {
                  const stale = staleMap.get(comment.id) ?? false
                  const diffs = comment.resolution.kind === 'pending' ? commentAnchorDiffs(comment, version, chain) : []
                  return (
                    <Box key={comment.id} p={4} borderBottom="1px solid" borderColor="gray.100">
                      <Flex justify="space-between">
                        <Box><Text fontWeight="700">{comment.role} · {comment.author}</Text><Text color="gray.500" fontSize="xs">{comment.anchor} · 锚定版本 {comment.windowVersionId}</Text></Box>
                        {comment.resolution.kind === 'accepted' && <Badge colorScheme="green">已接受于 {comment.resolution.versionId}</Badge>}
                        {comment.resolution.kind === 'closed' && <Badge colorScheme="red">版本过期已关闭</Badge>}
                        {comment.resolution.kind === 'rejected' && <Badge colorScheme="red">已驳回</Badge>}
                        {comment.resolution.kind === 'pending' && (stale ? <Badge colorScheme="red">锚点已过期</Badge> : <Badge colorScheme="orange">待处理</Badge>)}
                      </Flex>
                      <Text color="gray.600" mt={3}>{comment.content}</Text>
                      {stale && diffs.length > 0 && <Box mt={3} p={3} bg="red.50" borderLeft="3px solid" borderLeftColor="red.500" borderRadius="6px"><Text fontWeight="700" fontSize="sm" color="red.700">窗口已从 {comment.windowVersionId} 变动，拒绝合并：</Text>{diffs.map((diff) => <Text key={diff.field} fontSize="sm" color="red.800">· {diff.label}：锚定 {diff.anchored} → 当前 {diff.current}</Text>)}</Box>}
                      {comment.resolution.kind === 'closed' && <Text fontSize="xs" color="gray.500" mt={2}>{comment.resolution.reason}</Text>}
                      {comment.resolution.kind === 'pending' && !viewingHistory && (
                        <HStack mt={3}>
                          <Button size="sm" colorScheme={stale ? 'red' : 'blue'} variant={stale ? 'solid' : 'outline'} onClick={() => handleAccept(comment.id)}>{stale ? '尝试接受（将被拒绝）' : '接受并合并条款'}</Button>
                          {stale && <Button size="sm" variant="ghost" onClick={() => closeStaleComment(comment.id)}>关闭过期意见</Button>}
                        </HStack>
                      )}
                    </Box>
                  )
                })}
              </Box>
              <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={4}>
                <Heading size="md" mb={3}>发表条款意见</Heading>
                <Badge mb={3}>{selectedWindowId} · 锚定 {head.id}</Badge>
                <Textarea value={draft} isDisabled={viewingHistory} onChange={(event) => setDraft(event.target.value)} rows={7} />
                <Button mt={3} colorScheme="blue" isDisabled={!draft.trim() || viewingHistory} onClick={() => { addComment({ windowId: selectedWindowId, content: draft }); setDraft(''); toast({ title: '意见已提交并生成新版本', description: `意见锚定窗口版本 ${head.id}。`, status: 'success' }) }}>提交意见（生成新版本）</Button>
                <Text fontSize="xs" color="gray.500" mt={2}>意见锚定提交时的窗口版本；之后日期、地区或独占一旦变动，该意见立即过期。</Text>
              </Box>
            </Grid>
          </TabPanel>

          <TabPanel px={0} pt={4}>
            <Grid templateColumns={{ base: '1fr', lg: '.9fr 1.1fr' }} gap={4}>
              <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={3}>
                <Heading size="sm" mb={3}>版本链（旧 → 新）</Heading>
                <VStack align="stretch" spacing={2}>
                  {chain.map((item) => {
                    const approved = approvedIds.includes(item.id)
                    const isView = version.id === item.id
                    return (
                      <Flex key={item.id} p={3} borderRadius="6px" cursor="pointer" bg={isView ? 'blue.50' : 'gray.50'} border="1px solid" borderColor={isView ? 'blue.300' : 'gray.200'} onClick={() => inspectVersion(item.id)} justify="space-between" align="center">
                        <Box><HStack><Text fontWeight="700">{item.id}</Text>{approved && <Badge colorScheme="green">只读快照</Badge>}{item.id === currentId && <Badge colorScheme="blue">当前草案</Badge>}</HStack><Text fontSize="xs" color="gray.500">{item.author} · {item.time.slice(0, 16).replace('T', ' ')} · {reasonLabel[item.reason] ?? item.reason}</Text></Box>
                        <Badge>{item.changes.length} 项变更</Badge>
                      </Flex>
                    )
                  })}
                </VStack>
              </Box>
              <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={4}>
                <HStack mb={3}><Heading size="sm">{version.id} 的版本差异</Heading>{approvedIds.includes(version.id) ? <Badge colorScheme="green">已审批 · 只读</Badge> : <Badge>草案</Badge>}</HStack>
                <Text fontSize="sm" color="gray.600" mb={3}>{version.summary}</Text>
                {version.parentId ? <VersionDiff chain={chain} versionId={version.id} parentId={version.parentId} /> : <Text fontSize="sm" color="gray.500">初始版本，无父版本可比较。</Text>}
              </Box>
            </Grid>
          </TabPanel>

          <TabPanel px={0} pt={4}>
            <Grid templateColumns={{ base: '1fr', lg: '1.1fr .9fr' }} gap={4}>
              <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={5}>
                <Flex justify="space-between" align="center" mb={4}><Heading size="md">审批闸门</Heading><Button colorScheme="blue" isDisabled={viewingHistory || approvedIds.includes(head.id)} onClick={handleApprove}>审批当前草案 {head.id}</Button></Flex>
                <ApprovalChecklist />
                {lastApproval && (
                  <Box mt={4} p={3} bg={lastApproval.ok ? 'green.50' : 'red.50'} borderLeft="3px solid" borderLeftColor={lastApproval.ok ? 'green.500' : 'red.500'} borderRadius="6px">
                    <Text fontWeight="700" fontSize="sm">最近一次审批：{lastApproval.versionId} · {lastApproval.ok ? '通过（已固化为只读快照）' : '被拒绝，原草案保留'}</Text>
                    {!lastApproval.ok && lastApproval.blockers.map((blocker, index) => <Text key={index} fontSize="sm" color="red.800">· [{blocker.type}] {blocker.detail}</Text>)}
                    <Text fontSize="xs" color="gray.500" mt={1}>尝试时间 {lastApproval.attemptedAt.slice(0, 19).replace('T', ' ')}</Text>
                  </Box>
                )}
                <Heading size="sm" mt={6} mb={3}>审批时间线</Heading>
                {approvalRecords.map((record) => (
                  <HStack key={record.versionId} align="flex-start" mb={4}>
                    <Badge colorScheme="green">{record.time.slice(11, 16)}</Badge>
                    <Box><Text fontWeight="700">{record.approver} 通过 {record.versionId}</Text><Text color="gray.500" fontSize="sm">共 {record.commentResults.length} 条意见处理结果随审批包导出；窗口数据已固化为只读快照。</Text></Box>
                  </HStack>
                ))}
                <HStack align="flex-start"><Badge colorScheme="gray">待处理</Badge><Box><Text fontWeight="700">发行负责人审批 {head.id}</Text><Text color="gray.500" fontSize="sm">仅当当前版本无高风险冲突且无待处理意见时通过。</Text></Box></HStack>
              </Box>
              <Box>
                <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={4} mb={4}>
                  <Heading size="sm" mb={3}>重新载入的审批包</Heading>
                  {importedPackages.length === 0 && <Text fontSize="sm" color="gray.500">尚未载入外部审批包。导出后再重新载入可做版本校验；改动窗口后旧包会被标记为「已失效」。</Text>}
                  <VStack align="stretch" spacing={3}>
                    {importedPackages.map((item, index) => (
                      <Box key={`${item.fileName}-${index}`} p={3} borderRadius="6px" bg={item.status === '校验通过' ? 'green.50' : item.status === '已失效' ? 'red.50' : 'orange.50'}>
                        <Flex justify="space-between"><Text fontWeight="700" fontSize="sm">{item.fileName}</Text><Badge colorScheme={item.status === '校验通过' ? 'green' : item.status === '已失效' ? 'red' : 'orange'}>{item.status}</Badge></Flex>
                        <Text fontSize="xs" color="gray.500">{item.versionId}（v{item.versionNo}）· 载入于 {item.importedAt.slice(0, 16).replace('T', ' ')}</Text>
                        {item.issues.map((issue, i) => <Text key={i} fontSize="xs" color="red.700">· {issue}</Text>)}
                      </Box>
                    ))}
                  </VStack>
                </Box>
                <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={4}>
                  <Heading size="sm" mb={3}>导出包内容</Heading>
                  <Text fontSize="sm" color="gray.600">版本号与父版本、意见处理结果（接受/待处理/关闭）、窗口数据与冲突明细、变更清单、校验和。重新载入时逐项按版本校验。</Text>
                </Box>
              </Box>
            </Grid>
          </TabPanel>
        </TabPanels>
      </Tabs>
      {staleDiffs && (
        <Box position="fixed" inset={0} bg="blackAlpha.400" display="flex" alignItems="center" justifyContent="center" zIndex={100} onClick={() => setStaleDiffs(null)}>
          <Box bg="white" borderRadius="10px" p={6} maxW="520px" onClick={(event) => event.stopPropagation()}>
            <Heading size="md" color="red.600" mb={3}>拒绝合并：意见锚定的窗口版本已过期</Heading>
            {staleDiffs.diffs.map((diff) => <Flex key={diff.label} justify="space-between" py={2} borderBottom="1px solid" borderColor="gray.100"><Text fontSize="sm">{diff.label}</Text><HStack><Badge colorScheme="gray">锚定 {diff.anchored}</Badge><Text>→</Text><Badge colorScheme="red">当前 {diff.current}</Badge></HStack></Flex>)}
            <Text fontSize="sm" color="gray.600" mt={3}>请在当前窗口版本上重新提出意见，或关闭这条过期意见后再审批。</Text>
            <Button mt={4} w="100%" colorScheme="red" onClick={() => { closeStaleComment(staleDiffs.id); setStaleDiffs(null); toast({ title: '过期意见已关闭，已生成新版本', status: 'info' }) }}>关闭该过期意见</Button>
            <Button mt={2} w="100%" variant="ghost" onClick={() => setStaleDiffs(null)}>返回</Button>
          </Box>
        </Box>
      )}
    </Box>
  )
}

function VersionDiff({ chain, versionId, parentId }: { chain: ReturnType<typeof useRightsStore.getState>['chain']; versionId: string; parentId: string }) {
  const current = chain.find((item) => item.id === versionId)
  const parent = chain.find((item) => item.id === parentId)
  if (!current || !parent) return <Text fontSize="sm" color="gray.500">找不到父版本 {parentId}。</Text>
  const windowDiff = diffWindows(parent.windows, current.windows)
  const entries = Object.entries(windowDiff)
  return (
    <VStack align="stretch" spacing={3}>
      {entries.length === 0 && <Text fontSize="sm" color="gray.500">窗口数据无变化（仅意见/审批状态变动）。</Text>}
      {entries.map(([windowId, diffs]) => (
        <Box key={windowId} p={3} bg="gray.50" borderRadius="6px">
          <Text fontWeight="700" fontSize="sm" mb={1}>{windowId}</Text>
          {diffs.map((diff) => {
            const anchored = ['开始日期', '结束日期', '地区', '独占'].includes(diff.label)
            return <HStack key={diff.field} fontSize="sm" mb={1}><Badge colorScheme={anchored ? 'red' : 'gray'}>{diff.label}{anchored ? ' · 锚点' : ''}</Badge><Text textDecoration="line-through" color="gray.500">{diff.from}</Text><Text>→</Text><Text fontWeight="600">{diff.to}</Text></HStack>
          })}
        </Box>
      ))}
      {current.comments.length !== parent.comments.length && <Text fontSize="sm" color="blue.700">条款意见 {parent.comments.length} 条 → {current.comments.length} 条</Text>}
    </VStack>
  )
}

function ApprovalChecklist() {
  const head = useRightsStore((state) => state.chain.find((v) => v.id === state.currentId) ?? state.chain[state.chain.length - 1]!)
  const chain = useRightsStore((state) => state.chain)
  const approvedIds = useRightsStore((state) => state.approvedIds)
  const pending = head.comments.filter((item) => item.resolution.kind === 'pending')
  const stale = pending.filter((comment) => isCommentStale(comment, head, chain))
  const high = findConflicts(head.windows).filter((issue) => issue.severity === '高')
  return (
    <VStack align="stretch" spacing={2}>
      <CheckRow ok={!approvedIds.includes(head.id)} label={`审批对象为当前版本（${head.id}，非历史快照）`} />
      <CheckRow ok={high.length === 0} label="无高风险冲突" detail={high.length ? high.map((item) => item.title).join('；') : '独占/倒挂规则检测通过'} />
      <CheckRow ok={pending.length === 0} label={`待处理意见 ${pending.length} 条${stale.length ? `（其中 ${stale.length} 条锚点已过期，须重新提或关闭）` : ''}`} />
    </VStack>
  )
}

function CheckRow({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <Flex p={3} bg={ok ? 'green.50' : 'red.50'} borderRadius="6px" justify="space-between" align="center">
      <Box><Text fontSize="sm" fontWeight="600">{label}</Text>{detail && <Text fontSize="xs" color={ok ? 'green.700' : 'red.700'}>{detail}</Text>}</Box>
      <Badge colorScheme={ok ? 'green' : 'red'}>{ok ? '满足' : '阻塞'}</Badge>
    </Flex>
  )
}
