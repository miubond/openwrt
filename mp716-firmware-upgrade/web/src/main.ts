import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { i18n } from '@/i18n'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useLocaleStore } from '@/stores/locale'
import './styles/tailwind.css'
import './styles/base.css'
import './styles/settings-form.css'

function bootstrap() {
  const app = createApp(App)
  const pinia = createPinia()
  app.use(pinia)
  app.use(i18n)
  useThemeStore(pinia).init()

  void useLocaleStore(pinia).init()

  const auth = useAuthStore(pinia)
  app.use(router)
  app.mount('#app')

  if (auth.authenticated && !auth.isSessionTrusted()) {
    void auth.refreshSession().then((ok) => {
      if (!ok) auth.setSession(null)
    })
  }
}

bootstrap()
