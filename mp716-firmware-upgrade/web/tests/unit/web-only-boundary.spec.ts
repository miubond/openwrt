import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')

describe('web-only production boundary', () => {
  it('npm and CI do not build through mp716-rpc or OpenWrt 25.12', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts['build:device']).toBeUndefined()
    expect(pkg.scripts['build:web']).toContain('stage-web-overlay.mjs')
    expect(pkg.scripts.build).not.toContain('httpd.uc')

    const workflow = readFileSync(resolve(root, '.gitea/workflows/deploy-frontend.yml'), 'utf8')
    expect(workflow).not.toContain('packages/mp716-rpc')
    expect(workflow).not.toContain('VITE_ROUTER_ADAPTER=device')
    expect(workflow).not.toContain('/cgi-bin/mp716')
    expect(workflow).toContain('VITE_ROUTER_ADAPTER=factory')

    const index = readFileSync(resolve(root, 'src/api/index.ts'), 'utf8')
    expect(index).not.toContain('httpd.uc')
    expect(index).not.toContain('DeviceRouterAdapter')

    const indexProd = readFileSync(resolve(root, 'src/api/index.prod.ts'), 'utf8')
    expect(indexProd).toContain('create-router-api.prod')
    expect(indexProd).not.toContain('createMockRouterApi')

    const createProd = readFileSync(resolve(root, 'src/api/create-router-api.prod.ts'), 'utf8')
    expect(createProd).toContain('FactoryCgiAdapter')
    expect(createProd).not.toContain('DeviceRouterAdapter')

    expect(pkg.scripts['build:mp716-test']).toContain('mp716-test')
    expect(pkg.scripts['build:mp716-test']).toContain('verify-production-bundle.mjs')
  })
})
