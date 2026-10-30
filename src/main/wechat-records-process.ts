import { join } from 'node:path'
import { configureWcdbPaths, testDatabaseConnection } from './wcdb4-client'
import { loadReportParticipantProfiles, searchWechatChatIndex, readIndexedConversation, controlWechatChatIndex, prepareWechatReportMedia, queryWechatConversationSummary, queryWechatSpeechStats, queryWechatReportMessages, syncWechatRecords } from './wechat-records'
import { onImagePreview, readImagePreview } from './image-preview-cache'
import type { RecordsCommand, RecordsEvent } from '../shared/records-process'

let statsPath = ''
const chatDirectory = () => join(statsPath, '..', 'chat-index')
const port = process.parentPort
if (!port) throw new Error('聊天读取进程缺少通信端口')
const send = (event: RecordsEvent): void => port.postMessage(event)
onImagePreview((id, data, mime) => send({ type: 'preview', preview: { id, data, mime } }))
port.on('message', ({ data }: { data: RecordsCommand }) => {
  if (data.type === 'init') { configureWcdbPaths(data.paths); statsPath = data.paths.statsPath; return }
  try {
    if (data.type === 'validate') {
      testDatabaseConnection(data.key, data.root)
      send({ type: 'result', id: data.id })
    } else if (data.type === 'index-search') {
      send({ type: 'result', id: data.id, result: searchWechatChatIndex(chatDirectory(), data.account, data.key, data.keyword) })
    } else if (data.type === 'index-conversation') {
      send({ type: 'result', id: data.id, result: readIndexedConversation(chatDirectory(), data.account, data.key, data.conversationId, data.at, data.limit, data.refresh) })
    } else if (data.type === 'chat-index') {
      send({ type: 'result', id: data.id, result: controlWechatChatIndex(chatDirectory(), data.account, data.key, data.action) })
    } else if (data.type === 'sync') {
      send({ type: 'result', id: data.id, result: syncWechatRecords(data.account, data.key, chatDirectory()) })
    } else if (data.type === 'conversation-summary') {
      send({ type: 'result', id: data.id, result: queryWechatConversationSummary(chatDirectory(), data.account, data.key, data.query.conversationId) })
    } else if (data.type === 'speech') {
      send({ type: 'result', id: data.id, result: queryWechatSpeechStats(chatDirectory(), data.account, data.key, data.query) })
    } else if (data.type === 'report-participants') {
      send({ type: 'result', id: data.id, result: loadReportParticipantProfiles(data.account, data.key, data.participants) })
    } else if (data.type === 'report-media') {
      send({ type: 'result', id: data.id, result: prepareWechatReportMedia(data.account, data.key, data.conversationId, data.message) })
    } else if (data.type === 'report') {
      send({ type: 'result', id: data.id, result: queryWechatReportMessages(data.account, data.key, data.query, join(statsPath, '..', 'cache', 'report-index'), chatDirectory()) })
    } else {
      const preview = readImagePreview(data.imageId)
      send({ type: 'result', id: data.id, result: preview ? { id: data.imageId, ...preview } : null })
    }
  } catch (error) {
    send({ type: 'result', id: data.id, error: error instanceof Error ? error.message : '读取聊天记录失败' })
  }
})
