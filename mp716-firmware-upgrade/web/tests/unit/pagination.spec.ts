import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { usePaginatedRows } from '@/composables/usePaginatedRows'

describe('usePaginatedRows', () => {
  it('filters and paginates rows', () => {
    const rows = ref([
      { name: 'router-a', ip: '192.168.1.2' },
      { name: 'phone-b', ip: '192.168.1.3' },
      { name: 'pc-c', ip: '192.168.1.4' },
    ])
    const { setQuery, pageRows, pageCount, goTo } = usePaginatedRows({
      rows,
      pageSize: 2,
      searchKeys: ['name', 'ip'],
    })
    expect(pageRows.value).toHaveLength(2)
    setQuery('phone')
    expect(pageCount.value).toBe(1)
    expect(pageRows.value[0]?.name).toBe('phone-b')
    goTo(99)
    expect(pageRows.value).toHaveLength(1)
  })
})
