const express = require('express');
const router = express.Router({ caseSensitive: false });
const aiController = require('../controllers/ai.controller');

router.get('/ai/providers', aiController.providers);
router.get('/ai/conversations', aiController.listConversations);
router.post('/ai/conversations', aiController.createConversation);
router.get('/ai/conversations/:id', aiController.getConversation);
router.post('/ai/conversations/:id/messages', aiController.sendMessage);
router.get('/ai/conversations/:id/markdown', aiController.exportMarkdown);
router.delete('/ai/conversations/:id', aiController.deleteConversation);

module.exports = router;
