import { spawnSync } from 'node:child_process'
const logic=['test-wechat-version-gate.mjs','test-message-transport.mjs','test-native-resources.mjs','test-scheduled-messages.mjs','test-recall-capture-window.mjs','test-chat-recall-capture.mjs','test-retained-recalls.mjs','test-group-monitor.mjs','test-group-monitor-persistence.mjs']
const ui=['test-scheduled-messages-ui.cjs','test-chat-recall-ui.cjs','test-group-monitor-ui.cjs']
for(const args of [...logic.map(file=>['--experimental-strip-types',`scripts/${file}`]),...ui.map(file=>['scripts/run-electron.mjs','exec',`scripts/${file}`])]){
 const result=spawnSync(process.execPath,args,{stdio:'inherit'})
 if(result.error)throw result.error
 if(result.status!==0)process.exit(result.status??1)
}
console.log('P1模拟回归通过；不包含Windows真机、更多微信版本或真实消息送达验收')
