import { windowsNativeResources } from '../src/main/native-resources.ts'
try { windowsNativeResources(); console.log('Windows原生资源清单与SHA-256校验通过；此检查不代表真机ABI验收') }
catch (error) { console.error(error.message); process.exitCode=1 }
