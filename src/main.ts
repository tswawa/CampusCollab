import { createApp, type Plugin } from 'vue'
import { createPinia } from 'pinia'
import { initializeSessionLifecycle } from './mobile/api/bootstrap'
import {
  ActionSheet,
  Badge,
  Button,
  Cell,
  CellGroup,
  Checkbox,
  CheckboxGroup,
  Divider,
  Empty,
  Field,
  Form,
  Icon,
  NavBar,
  NoticeBar,
  Popup,
  Progress,
  Radio,
  RadioGroup,
  Search,
  Skeleton,
  Stepper,
  Switch,
  Tab,
  Tabbar,
  TabbarItem,
  Tabs,
  Tag,
  Uploader
} from 'vant'
import 'vant/lib/index.css'
import App from './App.vue'
import router from './router'
import './mobile/styles/mobile.css'
import './mobile/styles/workflow.css'
import { initializeLocale } from './mobile/i18n/browser'

const app = createApp(App)
const pinia = createPinia()

const components: Plugin[] = [
  ActionSheet,
  Badge,
  Button,
  Cell,
  CellGroup,
  Checkbox,
  CheckboxGroup,
  Divider,
  Empty,
  Field,
  Form,
  Icon,
  NavBar,
  NoticeBar,
  Popup,
  Progress,
  Radio,
  RadioGroup,
  Search,
  Skeleton,
  Stepper,
  Switch,
  Tab,
  Tabbar,
  TabbarItem,
  Tabs,
  Tag,
  Uploader
]

components.forEach(component => app.use(component))
app.use(pinia)
initializeLocale()
initializeSessionLifecycle()
app.use(router)
app.mount('#app')
