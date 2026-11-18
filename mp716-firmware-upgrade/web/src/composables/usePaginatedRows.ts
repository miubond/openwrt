import { computed, ref, type Ref } from 'vue'

export interface PaginationOptions<T> {
  rows: Ref<T[]>
  pageSize?: number
  /** 在整行字段中模糊匹配 */
  searchKeys?: (keyof T & string)[]
}

export function usePaginatedRows<T extends Record<string, unknown>>(opts: PaginationOptions<T>) {
  const pageSize = opts.pageSize ?? 10
  const query = ref('')
  const page = ref(1)

  const filtered = computed(() => {
    const q = query.value.trim().toLowerCase()
    if (!q) return opts.rows.value
    const keys =
      opts.searchKeys ??
      (Object.keys(opts.rows.value[0] ?? {}) as (keyof T & string)[])
    return opts.rows.value.filter((row) =>
      keys.some((k) => String(row[k] ?? '').toLowerCase().includes(q)),
    )
  })

  const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)))

  const pageRows = computed(() => {
    const p = Math.min(Math.max(1, page.value), pageCount.value)
    const start = (p - 1) * pageSize
    return filtered.value.slice(start, start + pageSize)
  })

  function setQuery(v: string) {
    query.value = v
    page.value = 1
  }

  function goTo(p: number) {
    page.value = Math.min(Math.max(1, p), pageCount.value)
  }

  return { query, page, pageCount, pageRows, filtered, setQuery, goTo }
}
