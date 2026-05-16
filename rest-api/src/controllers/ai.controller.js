const aiChatService = require('../services/ai-chat.service');
const { buildSuccess } = require('../utils/response-builder');

async function providers(req, res, next) {
  try {
    res.json(buildSuccess(aiChatService.listProviders()));
  } catch (error) {
    next(error);
  }
}

async function listConversations(req, res, next) {
  try {
    const conversations = await aiChatService.listConversations();
    res.json(buildSuccess(conversations));
  } catch (error) {
    next(error);
  }
}

async function createConversation(req, res, next) {
  try {
    const conversation = await aiChatService.createConversation(req.body || {});
    res.status(201).json(buildSuccess(conversation));
  } catch (error) {
    next(error);
  }
}

async function getConversation(req, res, next) {
  try {
    const conversation = await aiChatService.readConversation(req.params.id);
    res.json(buildSuccess(conversation));
  } catch (error) {
    next(error);
  }
}

async function sendMessage(req, res, next) {
  try {
    const result = await aiChatService.sendMessage(req.params.id, req.body || {});
    res.json(buildSuccess(result));
  } catch (error) {
    next(error);
  }
}

async function exportMarkdown(req, res, next) {
  try {
    const markdown = await aiChatService.exportMarkdown(req.params.id);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.send(markdown);
  } catch (error) {
    next(error);
  }
}

async function deleteConversation(req, res, next) {
  try {
    const result = await aiChatService.deleteConversation(req.params.id);
    res.json(buildSuccess(result));
  } catch (error) {
    next(error);
  }
}

module.exports = {
  providers,
  listConversations,
  createConversation,
  getConversation,
  sendMessage,
  exportMarkdown,
  deleteConversation,
};
