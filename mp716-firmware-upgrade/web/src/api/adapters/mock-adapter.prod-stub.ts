/** 生产构建占位。开发 mock 不进入发布包。 */
export class MockRouterAdapter {
  constructor() {
    throw new Error('生产构建不包含 Mock 适配器')
  }
}
