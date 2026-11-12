import { Modal, Tabs } from 'antd'
import type { SyncConversation } from '../../../shared/types'
import { ChatPatterns } from './ChatPatterns'
import { SpeechAnalysis } from './SpeechAnalysis'
import { SafeText } from './SafeText'

export function ChatAnalysis({ conversation, root, onClose }: { conversation: SyncConversation; root?: string; onClose: () => void }) {
  return <Modal open title={<>聊天分析 · <SafeText>{conversation.name}</SafeText></>} onCancel={onClose} footer={null} width={880} className="chat-analysis-modal" styles={{ body: { maxHeight: '75vh', overflowY: 'auto' } }}>
    <Tabs defaultActiveKey="patterns" items={[
      { key: 'patterns', label: '聊天脉络', children: <ChatPatterns conversation={conversation} root={root} /> },
      ...(conversation.type === 'group' ? [{ key: 'speech', label: '发言分析', children: <SpeechAnalysis conversation={conversation} root={root} /> }] : []),
    ]} />
  </Modal>
}
