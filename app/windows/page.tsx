'use client'

import { useEffect, useMemo, useState } from 'react'
import { Box, Flex, Grid, Heading, Text, Badge, Button, Input, Select, Checkbox, Table, Thead, Tbody, Tr, Th, Td, useToast, HStack } from '@chakra-ui/react'
import { useRightsStore, useConflicts } from '@/store/rights'
import type { LicenseWindow, Territory } from '@/lib/types'

const territories: (Territory | '全部地区')[] = ['全部地区', '中国大陆', '中国香港', '中国台湾', '新加坡', '马来西亚', '东南亚区域', '北美']

export default function WindowsPage() {
  const updateWindow = useRightsStore((state) => state.updateWindow)
  const version = useRightsStore((state) => state.chain.find((item) => item.id === (state.viewId ?? state.currentId)) ?? state.chain[state.chain.length - 1]!)
  const windows = version.windows
  const batchShift = useRightsStore((state) => state.batchShift)
  const selectedWindowId = useRightsStore((state) => state.selectedWindowId)
  const selectWindow = useRightsStore((state) => state.selectWindow)
  const selectedTerritory = useRightsStore((state) => state.selectedTerritory)
  const approvedIds = useRightsStore((state) => state.approvedIds)
  const readOnly = approvedIds.includes(version.id)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [shiftDays, setShiftDays] = useState(7)
  const [form, setForm] = useState<LicenseWindow | null>(null)
  const toast = useToast()
  const conflicts = useConflicts()
  const filtered = useMemo(() => selectedTerritory === '全部地区' ? windows : windows.filter((item) => item.territory === selectedTerritory), [windows, selectedTerritory])
  const selected = windows.find((item) => item.id === selectedWindowId)

  // 切换窗口或版本（产生新版本）时，用版本快照重置编辑表单
  useEffect(() => { setForm(selected ? { ...selected } : null) }, [selectedWindowId, version.id, selected])

  const dirty = useMemo(() => {
    if (!form || !selected) return false
    return (Object.keys(form) as (keyof LicenseWindow)[]).some((key) => String(form[key]) !== String(selected[key]))
  }, [form, selected])

  function commitForm() {
    if (!form || !selected) return
    if (new Date(form.end) < new Date(form.start)) { toast({ title: '窗口无效', description: '结束日期不能早于开始日期。', status: 'error' }); return }
    const patch: Partial<LicenseWindow> = {}
    ;(Object.keys(form) as (keyof LicenseWindow)[]).forEach((key) => {
      if (String(form[key]) !== String(selected[key])) (patch as Record<string, unknown>)[key] = form[key]
    })
    if (!Object.keys(patch).length) return
    updateWindow(selected.id, patch)
    const anchored = ['start', 'end', 'territory', 'exclusive'].some((key) => key in patch)
    toast({
      title: '已生成新草案版本',
      description: anchored ? '日期、地区或独占发生变动，锚定旧窗口版本的意见已自动失效。' : '窗口条款已并入新版本。',
      status: anchored ? 'warning' : 'success',
    })
  }

  return (
    <Box>
      <Flex justify="space-between" mb={5} gap={4} direction={{ base: 'column', md: 'row' }}><Box><Text color="brand.600" fontSize="xs" fontWeight="bold">TIME × TERRITORY</Text><Heading fontSize="3xl" my={1}>授权窗口与地区矩阵</Heading><Text color="gray.600">窗口、条款意见与审批包共用版本链；日期、地区或独占变动后，旧意见立即失效。</Text></Box><Flex gap={2} alignItems="center"><Select maxW="150px" value={selectedTerritory} onChange={(event) => useRightsStore.setState({ selectedTerritory: event.target.value })}>{territories.map((territory) => <option key={territory}>{territory}</option>)}</Select><Badge colorScheme={readOnly ? 'gray' : 'blue'} fontSize="sm" px={3} py={1}>{readOnly ? `${version.id} 只读快照` : `编辑中的版本 ${version.id}`}</Badge></Flex></Flex>
      {readOnly && <Box mb={4} p={3} bg="gray.100" borderLeft="3px solid" borderLeftColor="gray.400" borderRadius="6px" fontSize="sm">版本 {version.id} 已通过审批成为只读快照，窗口不可修改；任意改动都会从该快照派生新的草案版本。</Box>}
      <Grid templateColumns={{ base: '1fr', xl: 'minmax(0,1.1fr) minmax(360px,.8fr)' }} gap={4}>
        <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" overflow="hidden">
          <Flex p={4} justify="space-between" align="center"><Heading size="md">授权窗口清单</Heading><HStack><Select size="sm" w="110px" value={shiftDays} onChange={(event) => setShiftDays(Number(event.target.value))}><option value={7}>+7 天</option><option value={14}>+14 天</option><option value={-7}>-7 天</option><option value={-14}>-14 天</option></Select><Button size="sm" isDisabled={readOnly} onClick={() => { if (!selectedIds.length) return toast({ title: '请选择窗口', status: 'warning' }); batchShift(selectedIds, shiftDays); toast({ title: '批量调窗已生成新版本', description: '日期变动会使锚定旧版本的意见失效。', status: 'warning' }) }}>批量调窗</Button></HStack></Flex>
          <Table size="sm"><Thead><Tr><Th w="36px"></Th><Th>作品 / 渠道</Th><Th>地区</Th><Th>开始</Th><Th>结束</Th><Th>独占</Th></Tr></Thead><Tbody>{filtered.map((item) => <Tr key={item.id} bg={selectedWindowId === item.id ? 'blue.50' : undefined} cursor="pointer" onClick={() => selectWindow(item.id)}><Td onClick={(event) => event.stopPropagation()}><Checkbox isChecked={selectedIds.includes(item.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /></Td><Td><Text fontWeight="600">{item.work}</Text><Text color="gray.500" fontSize="xs">{item.channel} · {item.id}</Text></Td><Td>{item.territory}</Td><Td>{item.start}</Td><Td>{item.end}</Td><Td><Badge colorScheme={item.exclusive ? 'purple' : 'gray'}>{item.exclusive ? '独占' : '普通'}</Badge></Td></Tr>)}</Tbody></Table>
        </Box>
        <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={5}>
          <Heading size="md" mb={1}>窗口条款</Heading><Text color="gray.500" fontSize="sm" mb={4}>{selected?.id ?? '请选择窗口'} · 锚定版本 {version.id}</Text>
          {form && <Grid templateColumns="1fr 1fr" gap={4}>
            <Box gridColumn="span 2"><Text fontSize="sm" mb={1}>渠道</Text><Input value={form.channel} isDisabled={readOnly} onChange={(event) => setForm({ ...form, channel: event.target.value })} /></Box>
            <Box><Text fontSize="sm" mb={1}>开始日期</Text><Input type="date" value={form.start} isDisabled={readOnly} onChange={(event) => setForm({ ...form, start: event.target.value })} /></Box>
            <Box><Text fontSize="sm" mb={1}>结束日期</Text><Input type="date" value={form.end} isDisabled={readOnly} onChange={(event) => setForm({ ...form, end: event.target.value })} /></Box>
            <Box><Text fontSize="sm" mb={1}>优先顺序</Text><Input type="number" value={form.priority} isDisabled={readOnly} onChange={(event) => setForm({ ...form, priority: Number(event.target.value) })} /></Box>
            <Box><Text fontSize="sm" mb={1}>地区</Text><Select value={form.territory} isDisabled={readOnly} onChange={(event) => setForm({ ...form, territory: event.target.value as Territory })}>{territories.filter((item) => item !== '全部地区').map((territory) => <option key={territory}>{territory}</option>)}</Select></Box>
            <Checkbox isChecked={form.exclusive} isDisabled={readOnly} onChange={(event) => setForm({ ...form, exclusive: event.target.checked })}>独占窗口</Checkbox><Checkbox isChecked={form.sublicense} isDisabled={readOnly} onChange={(event) => setForm({ ...form, sublicense: event.target.checked })}>允许次级授权</Checkbox>
          </Grid>}
          {selected && conflicts.filter((issue) => issue.windowIds.includes(selected.id)).map((issue) => <Box key={issue.id} mt={4} p={3} bg={issue.severity === '高' ? 'red.50' : 'orange.50'} borderLeft="3px solid" borderLeftColor={issue.severity === '高' ? 'red.500' : 'orange.400'}><Text fontWeight="700" fontSize="sm">{issue.type}</Text><Text fontSize="sm" color="gray.600" mt={1}>{issue.explanation}</Text></Box>)}
          <Button w="100%" mt={5} colorScheme="blue" isDisabled={!dirty || readOnly} onClick={commitForm}>保存为新草案版本</Button>
          {dirty && <Text fontSize="xs" color="orange.600" mt={2}>有未提交改动；保存后才会生成新版本号，保存前意见仍锚定 {version.id}。</Text>}
        </Box>
      </Grid>
    </Box>
  )
}
